"""Rutas de administración y gestión de roles del sistema."""

import uuid
from datetime import datetime, timedelta, timezone

from flask import current_app, jsonify, request, g
from sqlalchemy import asc, desc, func, or_, delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from . import api
from ..extensions import db
from ..models import (
    Users,
    Roles,
    UserSessions,
    RoleRequest,
    PlotHistory,
    StudentGroup,
    GroupMember,
    AdminTeacherAssignment,
    AdminTeacherGroup,
    AdminTeacherGroupMember,
    AuditLog,
    user_roles_table,
)
from ..auth import require_session
from ..event_stream import events as event_bus
from ..services.audit import (
    serialize_audit_entry as _serialize_audit_entry,
    queue_ops_event as _queue_ops_event,
    record_audit as _record_audit_base,
)

# Acciones de auditoría que generan notificaciones para ops
OPS_AUDIT_ACTIONS = {
    "role.admin.assigned",
    "role.admin.removed",
    "auth.login.failed",
    "auth.login.succeeded",
    "auth.account.locked",
    "security.2fa.enabled",
    "security.2fa.disabled",
    "security.2fa.backup_regenerated",
    "ops.backup.created",
}


def _current_user_roles():
    """Obtiene los roles del usuario actual."""
    roles = {
        (role.name or '').lower()
        for role in getattr(g.current_user, 'roles', []) or []
    }
    primary_role = getattr(getattr(g.current_user, 'role', None), 'name', None)
    if primary_role:
        roles.add(primary_role.lower())
    return roles


def _current_user_has_role(role_name: str) -> bool:
    """Verifica si el usuario actual tiene un rol específico."""
    return role_name.lower() in _current_user_roles()


def _require_roles(allowed):
    """Verifica que el usuario tenga alguno de los roles permitidos."""
    allowed_norm = {r.lower() for r in allowed}
    if _current_user_roles().intersection(allowed_norm):
        return None
    return jsonify(error="No tienes permisos para realizar esta acción."), 403


def _require_admin():
    """Verifica que el usuario sea administrador."""
    return _require_roles({'admin'})


def _require_development():
    """Verifica que el usuario sea development."""
    return _require_roles({'development'})


def _get_role_by_name(name):
    """Obtiene un rol por nombre."""
    return db.session.execute(
        db.select(Roles).where(Roles.name == name)
    ).scalar_one_or_none()


def _development_endpoint_guard():
    """Bloquea endpoints de development en producción."""
    runtime_env = (current_app.config.get("APP_ENV") or "production").lower()
    if runtime_env == "production":
        return "", 404
    return None


def _find_user_by_identifier(identifier):
    """Busca un usuario por ID o public_id."""
    if not identifier:
        return None
    user = None
    try:
        user = db.session.get(Users, identifier)
    except Exception:
        user = None
    if user:
        return user
    return db.session.execute(
        db.select(Users).where(Users.public_id == identifier)
    ).scalar_one_or_none()


def _assign_role_to_user(user, role_name):
    """Asigna un rol a un usuario."""
    role = _get_role_by_name(role_name)
    if not role:
        raise ValueError(f"Rol '{role_name}' no existe.")
    if role not in user.roles:
        user.roles.append(role)
    user.role_id = role.id
    return role


def _remove_role_from_user(user, role_name, *, fallback_role="user"):
    """Remueve un rol de un usuario."""
    role = _get_role_by_name(role_name)
    if not role:
        raise ValueError(f"Rol '{role_name}' no existe.")

    removed = False
    
    current_roles = list(user.roles or [])
    for assigned in current_roles:
        if assigned.id == role.id:
            user.roles.remove(assigned)
            removed = True

    if not removed:
        result = db.session.execute(
            delete(user_roles_table).where(
                user_roles_table.c.user_id == user.id,
                user_roles_table.c.role_id == role.id,
            )
        )
        if (result.rowcount or 0) > 0:
            removed = True

    primary_needs_replacement = (user.role_id == role.id)
    
    if primary_needs_replacement:
        removed = True

    if not removed:
        return False

    if primary_needs_replacement:
        replacement = next((r for r in user.roles if r.id != role.id), None)
        
        if not replacement and fallback_role:
            replacement = _get_role_by_name(fallback_role)
            if not replacement:
                raise ValueError(f"Rol de respaldo '{fallback_role}' no existe.")
            if replacement not in user.roles:
                user.roles.append(replacement)
        
        if not replacement:
            raise ValueError("No hay un rol alternativo para el usuario.")
        
        user.role_id = replacement.id
        user.role = replacement

    return True


def _count_active_role_members(role_id):
    """Cuenta miembros activos de un rol."""
    if not role_id:
        return 0

    users_tbl = Users.__table__
    join_src = users_tbl.outerjoin(
        user_roles_table,
        user_roles_table.c.user_id == users_tbl.c.id,
    )
    stmt = (
        db.select(func.count(func.distinct(users_tbl.c.id)))
        .select_from(join_src)
        .where(
            users_tbl.c.deleted_at.is_(None),
            or_(
                user_roles_table.c.role_id == role_id,
                users_tbl.c.role_id == role_id,
            ),
        )
    )
    return db.session.execute(stmt).scalar_one()


def _get_ops_audience():
    """Obtiene la audiencia de eventos ops (admin y development)."""
    cached = getattr(g, "_ops_audience", None)
    if cached is not None:
        return cached

    stmt = (
        db.select(user_roles_table.c.user_id)
        .select_from(user_roles_table.join(Roles, user_roles_table.c.role_id == Roles.id))
        .where(Roles.name.in_({"admin", "development"}))
    )
    user_ids = {
        str(user_id)
        for user_id in db.session.execute(stmt).scalars()
        if user_id is not None
    }
    g._ops_audience = user_ids
    return user_ids


def _broadcast_ops_events(events):
    """Envía eventos de auditoría a la audiencia ops."""
    if not events:
        return
    audience = _get_ops_audience()
    if not audience:
        return
    for payload in events:
        try:
            event_bus.broadcast(
                audience,
                channel="ops",
                event_type="ops:audit",
                data={"event": payload},
            )
        except Exception as exc: 
            current_app.logger.warning("No se pudo emitir evento de auditoría: %s", exc)


def _flush_ops_events(response):
    """Flush de eventos de auditoría al finalizar la petición."""
    events = getattr(g, "_ops_audit_events", None)
    status_code = getattr(response, "status_code", 200)
    if events and status_code < 400:
        _broadcast_ops_events(events)
    for attr in ("_ops_audit_events", "_ops_audience"):
        try:
            g.pop(attr, None)
        except AttributeError:
            if hasattr(g, attr):
                delattr(g, attr)
    return response


# Registrar after_request handler
api.after_app_request(_flush_ops_events)


def _record_audit(action, *, target_entity_type=None, target_entity_id=None, details=None):
    """Registra una entrada en el log de auditoría."""
    return _record_audit_base(
        action,
        target_entity_type=target_entity_type,
        target_entity_id=target_entity_id,
        details=details,
        audit_actions=OPS_AUDIT_ACTIONS,
    )


def _assign_teacher_role(user):
    """Asigna el rol de docente a un usuario."""
    teacher_role = _get_role_by_name('teacher')
    if not teacher_role:
        current_app.logger.error("Rol 'teacher' no encontrado al intentar asignar desde admin.")
        return jsonify(error="Rol 'teacher' no configurado en el sistema."), 500

    if teacher_role not in user.roles:
        user.roles.append(teacher_role)
    user.role_id = teacher_role.id

    assignment = db.session.query(AdminTeacherAssignment).filter(
        AdminTeacherAssignment.teacher_id == user.id
    ).first()

    assigner = getattr(g, 'current_user', None)
    assigner_is_admin = bool(assigner and _current_user_has_role('admin'))

    if assigner_is_admin:
        if assignment and assignment.admin_id and assignment.admin_id != assigner.id:
            return jsonify(error="El docente ya está administrado por otro usuario."), 409
        if not assignment:
            assignment = AdminTeacherAssignment(admin_id=assigner.id, teacher_id=user.id)
            db.session.add(assignment)
        elif assignment.admin_id is None:
            assignment.admin_id = assigner.id

    try:
        db.session.commit()
    except IntegrityError as exc:
        db.session.rollback()
        current_app.logger.warning("Conflicto asignando rol teacher: %s", exc)
        return jsonify(error="El docente ya está administrado por otro usuario."), 409
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("Error al asignar rol teacher: %s", exc)
        return jsonify(error="No se pudo asignar el rol."), 500

    managed_by = None
    if assignment and assignment.admin_id:
        manager = assignment.admin if hasattr(assignment, 'admin') else None
        managed_by = {
            "id": str(assignment.admin_id),
            "name": getattr(manager, 'name', None),
        }

    return jsonify(
        message="Rol 'teacher' asignado.",
        user={
            "id": str(user.id),
            "name": user.name,
            "roles": [r.name for r in user.roles],
            "primary_role": user.role.name if user.role else None,
            "public_id": user.public_id,
            "managed_by": managed_by,
        },
    )


def _collect_teacher_stats(teacher_ids):
    """Recopila estadísticas de grupos y estudiantes por docente."""
    teacher_ids = [tid for tid in teacher_ids if tid]
    if not teacher_ids:
        return {}

    rows = (
        db.session.query(
            StudentGroup.teacher_id.label('teacher_id'),
            func.count(func.distinct(StudentGroup.id)).label('class_count'),
            func.count(func.distinct(GroupMember.student_user_id)).label('student_count'),
        )
        .outerjoin(GroupMember, GroupMember.group_id == StudentGroup.id)
        .filter(StudentGroup.teacher_id.in_(teacher_ids))
        .group_by(StudentGroup.teacher_id)
        .all()
    )

    stats = {
        row.teacher_id: {
            "class_count": int(row.class_count or 0),
            "student_count": int(row.student_count or 0),
        }
        for row in rows
    }

    for teacher_id in teacher_ids:
        stats.setdefault(teacher_id, {"class_count": 0, "student_count": 0})

    return stats


def _serialize_managed_teacher(teacher, *, assignment=None, stats=None):
    """Serializa un docente administrado con sus estadísticas."""
    if not teacher:
        return None

    stats = stats or {}
    payload = {
        "id": str(teacher.id),
        "public_id": teacher.public_id,
        "name": teacher.name,
        "email": teacher.email,
        "class_count": int((stats or {}).get("class_count", 0) or 0),
        "student_count": int((stats or {}).get("student_count", 0) or 0),
    }

    if assignment and getattr(assignment, 'assigned_at', None):
        payload["assigned_at"] = assignment.assigned_at.isoformat()

    return payload


def _serialize_admin_teacher_group(group, stats_map):
    """Serializa un grupo de docentes con sus estadísticas."""
    if not group:
        return None

    teacher_entries = []
    student_total = 0

    for member in group.members or []:
        teacher = member.teacher
        if not teacher:
            continue
        teacher_data = _serialize_managed_teacher(teacher, stats=stats_map.get(teacher.id)) or {}
        teacher_data["added_at"] = member.added_at.isoformat() if getattr(member, 'added_at', None) else None
        teacher_entries.append(teacher_data)
        student_total += int(teacher_data.get("student_count", 0) or 0)

    return {
        "id": str(group.id),
        "name": group.name,
        "description": group.description,
        "created_at": group.created_at.isoformat() if getattr(group, 'created_at', None) else None,
        "updated_at": group.updated_at.isoformat() if getattr(group, 'updated_at', None) else None,
        "teacher_count": len(teacher_entries),
        "student_count": int(student_total),
        "teacher_ids": [entry.get("id") for entry in teacher_entries],
        "teachers": teacher_entries,
    }


@api.get("/admin/stats/users")
@require_session
def admin_stats_users():
    """Estadísticas de usuarios del sistema."""
    guard = _require_roles({'admin', 'development'})
    if guard:
        return guard

    total = (
        db.session.query(func.count(Users.id))
        .filter(Users.deleted_at.is_(None))
        .scalar()
        or 0
    )

    seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)
    active = (
        db.session.query(func.count(func.distinct(UserSessions.user_id)))
        .filter(UserSessions.last_seen_at.isnot(None), UserSessions.last_seen_at >= seven_days_ago)
        .scalar()
        or 0
    )

    role_rows = (
        db.session.query(Roles.name, func.count(Users.id))
        .join(Users, Roles.id == Users.role_id)
        .filter(Users.deleted_at.is_(None))
        .group_by(Roles.name)
        .all()
    )
    role_map = {str(name or 'sin_rol'): int(count or 0) for name, count in role_rows}

    return jsonify(total=int(total), activos_7d=int(active), por_rol=role_map)


@api.get("/admin/stats/requests")
@require_session
def admin_stats_requests():
    """Estadísticas de solicitudes de rol."""
    guard = _require_roles({'admin', 'development'})
    if guard:
        return guard

    total = db.session.query(func.count(RoleRequest.id)).scalar() or 0
    pending = (
        db.session.query(func.count(RoleRequest.id))
        .filter(RoleRequest.status == 'pending')
        .scalar()
        or 0
    )
    resolved = (
        db.session.query(func.count(RoleRequest.id))
        .filter(RoleRequest.status.in_(("approved", "rejected")))
        .scalar()
        or 0
    )
    open_count = max(int(total) - int(resolved), 0)

    return jsonify(abiertas=open_count, pendientes=int(pending), atendidas=int(resolved))


@api.get("/admin/stats/plots")
@require_session
def admin_stats_plots():
    """Estadísticas de gráficos creados."""
    guard = _require_roles({'admin', 'development'})
    if guard:
        return guard

    now = datetime.now(timezone.utc)
    start_today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = now - timedelta(days=7)

    total = (
        db.session.query(func.count(PlotHistory.id))
        .filter(PlotHistory.deleted_at.is_(None))
        .scalar()
        or 0
    )
    today = (
        db.session.query(func.count(PlotHistory.id))
        .filter(PlotHistory.deleted_at.is_(None), PlotHistory.created_at >= start_today)
        .scalar()
        or 0
    )
    week = (
        db.session.query(func.count(PlotHistory.id))
        .filter(PlotHistory.deleted_at.is_(None), PlotHistory.created_at >= week_ago)
        .scalar()
        or 0
    )

    return jsonify(hoy=int(today), ultimos_7d=int(week), total=int(total))


@api.get("/admin/teachers")
@require_session
def admin_list_teachers():
    """Lista todos los docentes del sistema."""
    guard = _require_development()
    if guard:
        return guard

    teachers = (
        db.session.query(Users)
        .filter(Users.roles.any(Roles.name == 'teacher'))
        .order_by(Users.name)
        .all()
    )

    payload = [
        {
            "id": str(user.id),
            "name": user.name,
            "email": user.email,
            "public_id": user.public_id,
            "primary_role": user.role.name if user.role else None,
            "roles": [r.name for r in user.roles],
        }
        for user in teachers
    ]

    return jsonify(teachers=payload)


@api.post("/admin/users/<uuid:user_id>/assign-teacher")
@require_session
def admin_assign_teacher_by_uuid(user_id):
    """Asigna rol de docente por UUID (compatibilidad)."""
    guard = _require_roles({'admin', 'development'})
    if guard:
        return guard

    user = db.session.get(Users, user_id)
    if not user:
        return jsonify(error="Usuario no encontrado."), 404

    return _assign_teacher_role(user)


@api.post("/admin/users/assign-teacher")
@require_session
def admin_assign_teacher():
    """Asigna rol de docente (flexible: user_id o visible_id)."""
    guard = _require_roles({'admin', 'development'})
    if guard:
        return guard

    data = request.get_json() or {}
    user = None

    user_id = data.get("user_id")
    visible_id = data.get("visible_id")

    if user_id:
        try:
            user = db.session.get(Users, user_id)
        except Exception:
            user = None

    if not user and visible_id:
        user = db.session.query(Users).filter(Users.public_id == visible_id).first()

    if not user:
        return jsonify(error="Usuario no encontrado."), 404

    return _assign_teacher_role(user)


@api.get("/admin/my-teachers")
@require_session
def admin_my_teachers():
    """Lista los docentes administrados por el admin actual."""
    guard = _require_admin()
    if guard:
        return guard

    assignments = (
        db.session.query(AdminTeacherAssignment)
        .join(Users, Users.id == AdminTeacherAssignment.teacher_id)
        .options(selectinload(AdminTeacherAssignment.teacher))
        .filter(AdminTeacherAssignment.admin_id == g.current_user.id)
        .order_by(asc(Users.name))
        .all()
    )

    teacher_ids = [assignment.teacher_id for assignment in assignments if assignment.teacher_id]
    stats_map = _collect_teacher_stats(teacher_ids)

    teachers = []
    for assignment in assignments:
        teacher = assignment.teacher
        data = _serialize_managed_teacher(teacher, assignment=assignment, stats=stats_map.get(getattr(teacher, 'id', None)))
        if data:
            teachers.append(data)

    return jsonify(teachers=teachers)


@api.post("/admin/my-teacher-groups")
@require_session
def admin_create_teacher_group():
    """Crea un nuevo grupo de docentes."""
    guard = _require_admin()
    if guard:
        return guard

    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    description = (data.get("description") or "").strip() or None

    if len(name) < 2:
        return jsonify(error="El nombre del grupo debe tener al menos 2 caracteres."), 400

    group = AdminTeacherGroup(
        admin_id=g.current_user.id,
        name=name,
        description=description,
    )
    db.session.add(group)

    try:
        db.session.commit()
    except IntegrityError as exc:
        db.session.rollback()
        current_app.logger.warning("Conflicto al crear grupo docente admin: %s", exc)
        return jsonify(error="Ya existe un grupo con ese nombre."), 409
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("Error al crear grupo docente admin: %s", exc)
        return jsonify(error="No se pudo crear el grupo."), 500

    payload = _serialize_admin_teacher_group(group, {})
    return jsonify(message="Grupo creado.", group=payload), 201


@api.get("/admin/my-teacher-groups")
@require_session
def admin_list_teacher_groups():
    """Lista los grupos de docentes del admin actual."""
    guard = _require_admin()
    if guard:
        return guard

    groups = (
        db.session.query(AdminTeacherGroup)
        .options(selectinload(AdminTeacherGroup.members).selectinload(AdminTeacherGroupMember.teacher))
        .filter(AdminTeacherGroup.admin_id == g.current_user.id)
        .order_by(asc(AdminTeacherGroup.name))
        .all()
    )

    teacher_ids = {
        member.teacher_id
        for group in groups
        for member in (group.members or [])
        if member.teacher_id
    }
    stats_map = _collect_teacher_stats(list(teacher_ids))

    payload = [
        _serialize_admin_teacher_group(group, stats_map)
        for group in groups
        if group
    ]

    return jsonify(groups=payload)


@api.get("/admin/my-teacher-groups/<uuid:group_id>")
@require_session
def admin_get_teacher_group(group_id):
    """Obtiene el detalle de un grupo de docentes."""
    guard = _require_admin()
    if guard:
        return guard

    group = (
        db.session.query(AdminTeacherGroup)
        .options(selectinload(AdminTeacherGroup.members).selectinload(AdminTeacherGroupMember.teacher))
        .filter(
            AdminTeacherGroup.id == group_id,
            AdminTeacherGroup.admin_id == g.current_user.id,
        )
        .first()
    )

    if not group:
        return jsonify(error="Grupo no encontrado."), 404

    teacher_ids = [member.teacher_id for member in group.members or [] if member.teacher_id]
    stats_map = _collect_teacher_stats(teacher_ids)
    payload = _serialize_admin_teacher_group(group, stats_map) or {}

    students_payload = []
    if teacher_ids:
        rows = (
            db.session.query(
                GroupMember.student_user_id,
                GroupMember.student_visible_id,
                Users.name.label('student_name'),
                Users.email.label('student_email'),
                StudentGroup.teacher_id,
                StudentGroup.id.label('class_id'),
                StudentGroup.name.label('class_name'),
            )
            .join(StudentGroup, GroupMember.group_id == StudentGroup.id)
            .join(Users, GroupMember.student_user_id == Users.id)
            .filter(StudentGroup.teacher_id.in_(teacher_ids))
            .all()
        )

        teacher_lookup = {
            member.teacher_id: member.teacher.name if member.teacher else None
            for member in group.members or []
        }

        student_map = {}
        for row in rows:
            key = row.student_user_id
            entry = student_map.setdefault(
                key,
                {
                    "id": str(row.student_user_id),
                    "public_id": row.student_visible_id,
                    "name": row.student_name,
                    "email": row.student_email,
                    "enrollments": [],
                },
            )
            entry['enrollments'].append({
                "class_id": str(row.class_id) if row.class_id else None,
                "class_name": row.class_name,
                "teacher_id": str(row.teacher_id) if row.teacher_id else None,
                "teacher_name": teacher_lookup.get(row.teacher_id),
            })

        students_payload = list(student_map.values())

    payload['student_count'] = len(students_payload)
    payload['students'] = students_payload

    return jsonify(group=payload)


@api.post("/admin/my-teacher-groups/<uuid:group_id>/teachers")
@require_session
def admin_add_teacher_to_group(group_id):
    """Agrega un docente a un grupo."""
    guard = _require_admin()
    if guard:
        return guard

    group = (
        db.session.query(AdminTeacherGroup)
        .filter(
            AdminTeacherGroup.id == group_id,
            AdminTeacherGroup.admin_id == g.current_user.id,
        )
        .first()
    )

    if not group:
        return jsonify(error="Grupo no encontrado."), 404

    data = request.get_json(silent=True) or {}
    teacher_id = data.get("teacher_id") or data.get("user_id")
    visible_id = data.get("teacher_public_id") or data.get("visible_id")

    teacher = None
    if teacher_id:
        try:
            teacher_uuid = uuid.UUID(str(teacher_id))
            teacher = db.session.get(Users, teacher_uuid)
        except (ValueError, TypeError):
            teacher = None
    if not teacher and visible_id:
        teacher = db.session.query(Users).filter(Users.public_id == visible_id).first()

    if not teacher:
        return jsonify(error="Docente no encontrado."), 404

    assignment = db.session.query(AdminTeacherAssignment).filter(
        AdminTeacherAssignment.admin_id == g.current_user.id,
        AdminTeacherAssignment.teacher_id == teacher.id,
    ).first()

    if not assignment:
        return jsonify(error="Este docente no está bajo tu administración."), 403

    existing = db.session.query(AdminTeacherGroupMember).filter(
        AdminTeacherGroupMember.group_id == group.id,
        AdminTeacherGroupMember.teacher_id == teacher.id,
    ).first()

    if existing:
        return jsonify(error="El docente ya forma parte del grupo."), 409

    membership = AdminTeacherGroupMember(group_id=group.id, teacher_id=teacher.id)
    db.session.add(membership)

    try:
        db.session.commit()
    except IntegrityError as exc:
        db.session.rollback()
        current_app.logger.warning("Conflicto al agregar docente a grupo admin: %s", exc)
        return jsonify(error="El docente ya forma parte del grupo."), 409
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("Error al agregar docente a grupo admin: %s", exc)
        return jsonify(error="No se pudo agregar el docente al grupo."), 500

    stats = _collect_teacher_stats([teacher.id]).get(teacher.id, {"class_count": 0, "student_count": 0})
    payload = _serialize_managed_teacher(teacher, stats=stats) or {}
    payload['added_at'] = membership.added_at.isoformat() if membership.added_at else None

    return jsonify(message="Docente agregado al grupo.", teacher=payload)


@api.delete("/admin/my-teacher-groups/<uuid:group_id>/teachers/<uuid:teacher_id>")
@require_session
def admin_remove_teacher_from_group(group_id, teacher_id):
    """Remueve un docente de un grupo."""
    guard = _require_admin()
    if guard:
        return guard

    membership = (
        db.session.query(AdminTeacherGroupMember)
        .join(AdminTeacherGroup, AdminTeacherGroupMember.group_id == AdminTeacherGroup.id)
        .filter(
            AdminTeacherGroupMember.group_id == group_id,
            AdminTeacherGroupMember.teacher_id == teacher_id,
            AdminTeacherGroup.admin_id == g.current_user.id,
        )
        .first()
    )

    if not membership:
        return jsonify(error="No se encontró el docente en el grupo."), 404

    try:
        db.session.delete(membership)
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("Error al eliminar docente de grupo admin: %s", exc)
        return jsonify(error="No se pudo eliminar el docente del grupo."), 500

    return jsonify(message="Docente eliminado del grupo.")


@api.delete("/admin/my-teacher-groups/<uuid:group_id>")
@require_session
def admin_delete_teacher_group(group_id):
    """Elimina un grupo de docentes."""
    guard = _require_admin()
    if guard:
        return guard

    group = (
        db.session.query(AdminTeacherGroup)
        .filter(
            AdminTeacherGroup.id == group_id,
            AdminTeacherGroup.admin_id == g.current_user.id,
        )
        .first()
    )

    if not group:
        return jsonify(error="Grupo no encontrado."), 404

    try:
        db.session.delete(group)
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("Error al eliminar grupo docente admin: %s", exc)
        return jsonify(error="No se pudo eliminar el grupo."), 500

    return jsonify(message="Grupo eliminado.")


@api.get("/admin/teacher-groups")
@require_session
def admin_teacher_groups():
    """Lista todos los grupos de estudiantes (solo development)."""
    guard = _require_development()
    if guard:
        return guard

    groups = (
        db.session.query(StudentGroup)
        .options(
            selectinload(StudentGroup.teacher),
            selectinload(StudentGroup.members).selectinload(GroupMember.student),
        )
        .order_by(desc(StudentGroup.created_at))
        .all()
    )

    payload = []
    for group in groups:
        teacher = group.teacher
        payload.append({
            "id": str(group.id),
            "name": group.name,
            "description": group.description,
            "teacher_id": str(teacher.id) if teacher else None,
            "teacher_name": teacher.name if teacher else None,
            "teacher_email": teacher.email if teacher else None,
            "created_at": group.created_at.isoformat() if group.created_at else None,
            "member_count": len(group.members or []),
            "members": [
                {
                    "id": str(member.id),
                    "student_visible_id": member.student_visible_id,
                    "student_name": member.student.name if member.student else None,
                    "student_email": member.student.email if member.student else None,
                }
                for member in (group.members or [])
            ],
        })

    return jsonify(groups=payload)


@api.post("/development/users/assign-admin")
@require_session
def development_assign_admin():
    """Asigna rol de administrador (requiere rol development)."""
    env_guard = _development_endpoint_guard()
    if env_guard:
        return env_guard

    guard = _require_roles({'development'})
    if guard:
        return guard

    data = request.get_json() or {}
    user_id = data.get("user_id")
    visible_id = data.get("visible_id")
    request_id = data.get("request_id")

    user = None
    if user_id:
        try:
            user = db.session.get(Users, user_id)
        except Exception:
            user = None
    if not user and visible_id:
        user = db.session.query(Users).filter(Users.public_id == visible_id).first()

    if not user:
        return jsonify(error="Usuario no encontrado."), 404

    pending_request = None
    if request_id:
        pending_request = db.session.get(RoleRequest, request_id)
        if pending_request and pending_request.user_id != user.id:
            return jsonify(error="La solicitud no corresponde al usuario indicado."), 400

    try:
        _assign_role_to_user(user, 'admin')
        db.session.flush()
        if pending_request:
            pending_request.status = 'approved'
            pending_request.resolver_id = g.current_user.id
            pending_request.resolved_at = datetime.now(timezone.utc)
        audit_details = {
            "target_public_id": user.public_id,
            "request_id": str(pending_request.id) if pending_request else None,
        }
        _record_audit(
            "role.admin.assigned",
            target_entity_type="user",
            target_entity_id=user.id,
            details={k: v for k, v in audit_details.items() if v is not None},
        )
    except ValueError as exc:
        db.session.rollback()
        current_app.logger.error("Error en asignación de admin: %s", exc)
        return jsonify(error=str(exc)), 500
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("Error en asignación admin: %s", exc)
        return jsonify(error="No se pudo asignar el rol admin."), 500
    else:
        db.session.commit()

    return jsonify(
        message="Rol 'admin' asignado.",
        user={
            "id": str(user.id),
            "name": user.name,
            "public_id": user.public_id,
            "roles": [r.name for r in user.roles],
            "primary_role": user.role.name if user.role else None,
        }
    )


@api.get("/development/admins")
@require_session
def development_list_admins():
    """Lista todos los administradores (requiere rol development)."""
    env_guard = _development_endpoint_guard()
    if env_guard:
        return env_guard

    guard = _require_roles({'development'})
    if guard:
        return guard

    admin_role = _get_role_by_name('admin')
    if not admin_role:
        return jsonify(admins=[], total=0)

    stmt = (
        db.select(Users)
        .options(selectinload(Users.roles), selectinload(Users.role))
        .outerjoin(user_roles_table, user_roles_table.c.user_id == Users.id)
        .where(
            Users.deleted_at.is_(None),
            or_(
                user_roles_table.c.role_id == admin_role.id,
                Users.role_id == admin_role.id,
            ),
        )
        .order_by(func.lower(Users.name))
    )

    rows = (
        db.session.execute(stmt)
        .scalars()
        .unique()
        .all()
    )

    total = len(rows)
    current_id = getattr(getattr(g, "current_user", None), "id", None)

    payload = []
    for row in rows:
        role_names = {r.name for r in (row.roles or []) if getattr(r, "name", None)}
        if getattr(row, "role", None) and getattr(row.role, "name", None):
            role_names.add(row.role.name)
        payload.append({
            "id": str(row.id),
            "public_id": row.public_id,
            "name": row.name,
            "email": row.email,
            "roles": sorted(role_names),
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "removable": total > 1,
            "is_self": row.id == current_id,
        })

    return jsonify(admins=payload, total=total)


@api.delete("/development/users/<user_identifier>/roles/admin")
@require_session
def development_remove_admin(user_identifier):
    """Remueve rol de administrador (requiere rol development)."""
    env_guard = _development_endpoint_guard()
    if env_guard:
        return env_guard

    guard = _require_roles({'development'})
    if guard:
        return guard

    admin_role = _get_role_by_name('admin')
    if not admin_role:
        return jsonify(error="Rol 'admin' no está configurado."), 500

    user = _find_user_by_identifier(user_identifier)
    if not user or user.deleted_at:
        return jsonify(error="Usuario no encontrado."), 404

    # Verificar si el usuario tiene el rol admin (en user.roles o como role_id primario)
    has_admin = admin_role in (user.roles or []) or user.role_id == admin_role.id
    if not has_admin:
        return jsonify(error="El usuario no tiene el rol admin."), 400

    total_admins = _count_active_role_members(admin_role.id)
    if total_admins <= 1:
        return jsonify(error="Debe permanecer al menos un administrador activo."), 409

    try:
        removed = _remove_role_from_user(user, 'admin')
        if not removed:
            return jsonify(error="El usuario no tiene el rol admin."), 400

        db.session.flush()
        remaining_admins = _count_active_role_members(admin_role.id)
        audit_details = {
            "target_public_id": user.public_id,
            "target_user_id": str(user.id),
            "remaining_admins": int(remaining_admins),
        }
        _record_audit(
            "role.admin.removed",
            target_entity_type="user",
            target_entity_id=user.id,
            details=audit_details,
        )
        db.session.commit()
    except ValueError as exc:
        db.session.rollback()
        return jsonify(error=str(exc)), 400
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("Error al remover rol admin: %s", exc)
        return jsonify(error="No se pudo remover el rol admin."), 500

    return jsonify(
        message="Rol 'admin' eliminado.",
        user={
            "id": str(user.id),
            "name": user.name,
            "public_id": user.public_id,
            "roles": [r.name for r in (user.roles or [])],
            "primary_role": user.role.name if user.role else None,
        },
        remaining_admins=int(remaining_admins),
    )
