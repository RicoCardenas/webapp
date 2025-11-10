"""
Rutas de gestión de grupos de estudiantes.

Endpoints:
- POST /api/groups - Crear grupo de estudiantes
- GET /api/groups - Listar grupos del docente
- POST /api/groups/<id>/members - Agregar estudiante a grupo
- DELETE /api/groups/<id>/members/<visible_id> - Remover estudiante de grupo
- GET /api/teacher/groups/<id>/history - Ver historial del grupo
"""

from datetime import datetime, timezone

from flask import current_app, jsonify, request, g
from sqlalchemy import desc
from sqlalchemy.orm import selectinload

from . import api
from ..extensions import db
from ..models import (
    Users,
    StudentGroup,
    GroupMember,
)
from ..auth import require_session


# ============================================================================
# Funciones helper privadas
# ============================================================================

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


def _require_roles(allowed):
    """Verifica que el usuario tenga alguno de los roles permitidos."""
    allowed_norm = {r.lower() for r in allowed}
    if _current_user_roles().intersection(allowed_norm):
        return None
    return jsonify(error="No tienes permisos para realizar esta acción."), 403


def _require_teacher():
    """Verifica que el usuario sea docente."""
    return _require_roles({'teacher'})


@api.post("/groups")
@require_session
def create_group():
    """Crea un nuevo grupo de estudiantes."""
    guard = _require_teacher()
    if guard:
        return guard

    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    description = (data.get("description") or "").strip() or None

    if len(name) < 2:
        return jsonify(error="El nombre del grupo debe tener al menos 2 caracteres."), 400

    group = StudentGroup(
        teacher_id=g.current_user.id,
        name=name,
        description=description,
    )
    db.session.add(group)
    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("Error al crear grupo: %s", exc)
        return jsonify(error="No se pudo crear el grupo."), 500

    return jsonify(
        message="Grupo creado.",
        group={
            "id": str(group.id),
            "name": group.name,
            "description": group.description,
            "created_at": group.created_at.isoformat(),
        },
    ), 201


@api.get("/groups")
@require_session
def list_groups():
    """Lista los grupos del docente actual."""
    guard = _require_teacher()
    if guard:
        return guard

    groups = (
        db.session.query(StudentGroup)
        .filter(StudentGroup.teacher_id == g.current_user.id)
        .order_by(desc(StudentGroup.created_at))
        .all()
    )

    payload = []
    for group in groups:
        payload.append({
            "id": str(group.id),
            "name": group.name,
            "description": group.description,
            "created_at": group.created_at.isoformat(),
            "members": [
                {
                    "id": str(member.id),
                    "student_visible_id": member.student_visible_id,
                    "student_name": member.student.name,
                    "student_email": member.student.email,
                }
                for member in group.members
            ],
        })

    return jsonify(groups=payload)


@api.post("/groups/<uuid:group_id>/members")
@require_session
def add_group_member(group_id):
    """Agrega un estudiante a un grupo."""
    guard = _require_teacher()
    if guard:
        return guard

    group = db.session.query(StudentGroup).filter(
        StudentGroup.id == group_id,
        StudentGroup.teacher_id == g.current_user.id,
    ).first()

    if not group:
        return jsonify(error="Grupo no encontrado."), 404

    data = request.get_json() or {}
    visible_id = (data.get("visible_id") or "").strip()
    if not visible_id:
        return jsonify(error="Debes proporcionar el visible_id del estudiante."), 400

    student = db.session.query(Users).filter(Users.public_id == visible_id).first()
    if not student:
        return jsonify(error="No se encontró un usuario con ese visible_id."), 404

    student_roles = {role.name for role in student.roles}
    if student.id == g.current_user.id or student_roles.isdisjoint({"student", "user"}):
        return jsonify(error="Solo se pueden agregar estudiantes o usuarios estándar."), 400

    existing = db.session.query(GroupMember).filter(
        GroupMember.group_id == group.id,
        GroupMember.student_user_id == student.id,
    ).first()
    if existing:
        return jsonify(error="El estudiante ya forma parte de este grupo."), 409

    membership = GroupMember(
        group_id=group.id,
        student_user_id=student.id,
        student_visible_id=student.public_id,
    )
    db.session.add(membership)
    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("Error al agregar estudiante al grupo: %s", exc)
        return jsonify(error="No se pudo agregar el estudiante."), 500

    return jsonify(
        message="Estudiante agregado al grupo.",
        member={
            "id": str(membership.id),
            "student_visible_id": membership.student_visible_id,
            "student_name": student.name,
            "student_email": student.email,
        },
    ), 201


@api.delete("/groups/<uuid:group_id>/members/<string:visible_id>")
@require_session
def remove_group_member(group_id, visible_id):
    """Remueve un estudiante de un grupo."""
    guard = _require_teacher()
    if guard:
        return guard

    group = db.session.query(StudentGroup).filter(
        StudentGroup.id == group_id,
        StudentGroup.teacher_id == g.current_user.id,
    ).first()

    if not group:
        return jsonify(error="Grupo no encontrado."), 404

    membership = db.session.query(GroupMember).filter(
        GroupMember.group_id == group.id,
        GroupMember.student_visible_id == visible_id,
    ).first()

    if not membership:
        return jsonify(error="El estudiante no pertenece a este grupo."), 404

    try:
        db.session.delete(membership)
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("Error al eliminar estudiante del grupo: %s", exc)
        return jsonify(error="No se pudo eliminar al estudiante."), 500

    return jsonify(message="Estudiante eliminado del grupo.")


@api.get("/teacher/groups/<uuid:group_id>/history")
@require_session
def group_history(group_id):
    """Obtiene el historial de gráficos de un grupo."""
    guard = _require_roles({'teacher', 'admin', 'development'})
    if guard:
        return guard

    user_roles = {role.name for role in g.current_user.roles}

    group_query = db.session.query(StudentGroup).filter(StudentGroup.id == group_id)
    if user_roles.intersection({'admin', 'development'}):
        group = group_query.first()
    else:
        group = group_query.filter(StudentGroup.teacher_id == g.current_user.id).first()

    if not group:
        return jsonify(error="Grupo no encontrado."), 404

    members = (
        db.session.query(GroupMember)
        .options(selectinload(GroupMember.student).selectinload(Users.plot_history))
        .filter(GroupMember.group_id == group.id)
        .all()
    )

    history_payload = []
    for membership in members:
        student = membership.student
        if not student:
            continue
        history_entries = [
            {
                "id": str(entry.id),
                "expression": entry.expression,
                "created_at": entry.created_at.isoformat() if entry.created_at else None,
            }
            for entry in sorted(
                (h for h in student.plot_history if h and h.deleted_at is None),
                key=lambda item: item.created_at or datetime.min.replace(tzinfo=timezone.utc),
                reverse=True,
            )
        ]

        history_payload.append({
            "student_name": student.name,
            "student_visible_id": student.public_id,
            "entries": history_entries,
        })

    return jsonify(
        group={
            "id": str(group.id),
            "name": group.name,
            "description": group.description,
        },
        students=history_payload,
    )
