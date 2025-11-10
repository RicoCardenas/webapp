"""Herramientas de desarrollo y operaciones (solo dev environment)."""

from datetime import datetime, timedelta, timezone

import math
from dataclasses import asdict
from datetime import datetime, timezone

from flask import current_app, jsonify, request, g
from sqlalchemy import desc, func
from sqlalchemy.orm import selectinload

from . import api
from ..extensions import db
from ..models import (
    RoleRequest,
    AuditLog,
)
from ..auth import require_session
from ..backup import BackupError, RestoreError, run_backup, restore_backup, list_backups
from ..notifications import create_notification

# Constantes para paginación de operaciones
OPS_DEFAULT_PAGE_SIZE = 20
OPS_MIN_PAGE_SIZE = 5
OPS_MAX_PAGE_SIZE = 50

# Acciones críticas para auditoría
CRITICAL_AUDIT_ACTIONS = {
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


# ============================================================================
# Funciones helper privadas
# ============================================================================

def _current_user_roles():
    """Obtiene los roles del usuario actual en formato normalizado."""
    user = getattr(g, "current_user", None)
    if not user:
        return set()
    role_names = {r.name.lower() for r in user.roles if r and r.name}
    if user.role and user.role.name:
        role_names.add(user.role.name.lower())
    return role_names


def _require_roles(allowed):
    """Verifica que el usuario tenga alguno de los roles permitidos."""
    allowed_norm = {r.lower() for r in allowed}
    if _current_user_roles().intersection(allowed_norm):
        return None
    return jsonify(error="No tienes permisos para realizar esta acción."), 403


def _require_development():
    """Verifica que el usuario sea development."""
    return _require_roles({'development'})


def _development_endpoint_guard():
    """Bloquea endpoints de development en producción."""
    runtime_env = (current_app.config.get("APP_ENV") or "production").lower()
    if runtime_env == "production":
        return "", 404
    return None


def _assign_role_to_user(user, role_name):
    """Asigna un rol a un usuario. Importado desde admin.py lógicamente."""
    from ..models import Roles
    role = db.session.execute(
        db.select(Roles).where(Roles.name == role_name)
    ).scalar_one_or_none()
    if not role:
        raise ValueError(f"Rol '{role_name}' no existe.")
    if role not in user.roles:
        user.roles.append(role)
    user.role_id = role.id
    return role


def _serialize_audit_entry(entry):
    """Serializa una entrada de auditoría."""
    from ..models import Users
    if not entry:
        return {}

    user_payload = None
    if getattr(entry, "user", None) is not None:
        user_payload = {
            "id": str(entry.user.id),
            "email": entry.user.email,
            "name": entry.user.name,
        }
    elif entry.user_id:
        actor = db.session.get(Users, entry.user_id)
        if actor:
            user_payload = {
                "id": str(actor.id),
                "email": actor.email,
                "name": actor.name,
            }

    target_payload = None
    if entry.target_entity_type or entry.target_entity_id:
        target_payload = {
            "type": entry.target_entity_type,
            "id": str(entry.target_entity_id) if entry.target_entity_id else None,
        }

    return {
        "id": str(entry.id) if entry.id is not None else None,
        "action": entry.action,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
        "ip_address": entry.ip_address,
        "details": entry.details or {},
        "user": user_payload,
        "target": target_payload,
    }


# ============================================================================
# Endpoints de Development
# ============================================================================

@api.get("/development/role-requests")
@require_session
def development_list_role_requests():
    """Lista todas las solicitudes de roles (requiere rol development)."""
    env_guard = _development_endpoint_guard()
    if env_guard:
        return env_guard

    guard = _require_roles({'development'})
    if guard:
        return guard

    requests = (
        db.session.query(RoleRequest)
        .options(selectinload(RoleRequest.user), selectinload(RoleRequest.resolver))
        .order_by(desc(RoleRequest.created_at))
        .all()
    )

    payload = []
    for req in requests:
        payload.append({
            "id": str(req.id),
            "user": {
                "id": str(req.user.id),
                "name": req.user.name,
                "email": req.user.email,
                "public_id": req.user.public_id,
            } if req.user else None,
            "requested_role": req.requested_role,
            "status": req.status,
            "notes": req.notes,
            "created_at": req.created_at.isoformat() if req.created_at else None,
            "resolved_at": req.resolved_at.isoformat() if req.resolved_at else None,
            "resolver": {
                "id": str(req.resolver.id),
                "name": req.resolver.name,
            } if req.resolver else None,
        })

    return jsonify(requests=payload)


@api.post("/development/role-requests/<uuid:request_id>/resolve")
@require_session
def development_resolve_request(request_id):
    """Resuelve (aprueba/rechaza) una solicitud de rol (requiere rol development)."""
    env_guard = _development_endpoint_guard()
    if env_guard:
        return env_guard

    guard = _require_roles({'development'})
    if guard:
        return guard

    req = db.session.get(RoleRequest, request_id)
    if not req:
        return jsonify(error="Solicitud no encontrada."), 404

    data = request.get_json() or {}
    action = (data.get("action") or "").strip().lower()
    notes = (data.get("notes") or "").strip() or None
    if req.status != 'pending':
        return jsonify(error="La solicitud ya fue procesada."), 409

    if action not in {'approve', 'reject'}:
        return jsonify(error="Acción inválida. Usa 'approve' o 'reject'."), 400

    try:
        if action == 'approve':
            _assign_role_to_user(req.user, req.requested_role)
        req.status = 'approved' if action == 'approve' else 'rejected'
        req.notes = notes
        req.resolver_id = g.current_user.id
        req.resolved_at = datetime.now(timezone.utc)
        db.session.flush([req])

        payload = {
            "request_id": str(req.id),
            "status": req.status,
            "requested_role": req.requested_role,
        }
        if req.user_id:
            if req.status == 'approved':
                title = "Tu solicitud fue aprobada"
                body = f"Recibiste el rol \"{req.requested_role}\". Ya puedes usar las nuevas funciones."
            else:
                title = "Tu solicitud fue rechazada"
                body = "Tu solicitud de rol fue rechazada. Revisa los detalles en tu panel."
            create_notification(
                req.user_id,
                category="role_request",
                title=title,
                body=body,
                payload=payload,
            )

        db.session.commit()
    except ValueError as exc:
        db.session.rollback()
        return jsonify(error=str(exc)), 400
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("Error al resolver solicitud: %s", exc)
        return jsonify(error="No se pudo procesar la solicitud."), 500

    return jsonify(message=f"Solicitud {req.status}.")


@api.post("/development/backups/run")
@require_session
def development_backup():
    """Ejecuta un backup manual de la base de datos (requiere rol development)."""
    env_guard = _development_endpoint_guard()
    if env_guard:
        return env_guard

    guard = _require_roles({'development'})
    if guard:
        return guard

    data = request.get_json(silent=True) or {}
    backup_name = data.get("backup_name")

    try:
        metadata = run_backup(backup_name)
    except BackupError as exc:
        current_app.logger.error("Backup fallido: %s", exc)
        return jsonify(error=str(exc)), 500

    current_app.logger.info(
        "Backup '%s' generado por %s en %s",
        metadata.filename,
        g.current_user.email,
        metadata.path,
    )
    return jsonify(message="Backup generado con éxito.", backup=asdict(metadata)), 201


@api.post("/development/backups/restore")
@require_session
def development_restore():
    """Restaura la base de datos desde un backup (requiere rol development)."""
    env_guard = _development_endpoint_guard()
    if env_guard:
        return env_guard

    guard = _require_roles({'development'})
    if guard:
        return guard

    data = request.get_json(silent=True) or {}
    backup_name = (data.get("backup_name") or "").strip()
    if not backup_name:
        return jsonify(error="Debes indicar el nombre del backup."), 400

    try:
        metadata = restore_backup(backup_name)
    except FileNotFoundError:
        return jsonify(error="El backup solicitado no existe."), 404
    except RestoreError as exc:
        current_app.logger.error("Restore fallido: %s", exc)
        return jsonify(error=str(exc)), 500

    current_app.logger.info(
        "Backup '%s' restaurado por %s",
        metadata.filename,
        g.current_user.email,
    )
    return jsonify(message="Restauración completada.", backup=asdict(metadata))


@api.get("/admin/ops/summary")
@require_session
def admin_ops_summary():
    """Resumen de operaciones críticas: último backup y eventos de auditoría (requiere rol development)."""
    guard = _require_development()
    if guard:
        return guard

    page = request.args.get("page", default=1, type=int) or 1
    page = max(1, page)
    requested_page_size = request.args.get("page_size", type=int)
    page_size = requested_page_size or OPS_DEFAULT_PAGE_SIZE
    page_size = max(OPS_MIN_PAGE_SIZE, min(OPS_MAX_PAGE_SIZE, page_size))

    backups = list_backups(limit=1)
    latest_backup = asdict(backups[0]) if backups else None

    condition = AuditLog.action.in_(CRITICAL_AUDIT_ACTIONS)

    total = db.session.scalar(
        db.select(func.count()).select_from(AuditLog).where(condition)
    ) or 0

    total_pages = math.ceil(total / page_size) if page_size else 1
    if total_pages < 1:
        total_pages = 1
    if total == 0:
        page = 1
    elif page > total_pages:
        page = total_pages

    offset = (page - 1) * page_size

    events_stmt = (
        db.select(AuditLog)
        .options(selectinload(AuditLog.user))
        .where(condition)
        .order_by(desc(AuditLog.created_at))
        .offset(offset)
        .limit(page_size)
    )

    events = db.session.execute(events_stmt).scalars().all()
    event_payload = [_serialize_audit_entry(entry) for entry in events]

    meta = {
        "total": int(total),
        "page": int(page),
        "page_size": int(page_size),
        "total_pages": int(total_pages),
    }

    return jsonify(
        backup=latest_backup,
        events=event_payload,
        meta=meta,
    )
