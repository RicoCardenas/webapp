"""
Rutas de solicitud de roles (role requests).

Endpoints:
- POST /api/role-requests - Crear solicitud de rol
- GET /api/role-requests/me - Ver estado de mi solicitud más reciente

Nota: Los endpoints de administración de solicitudes (/development/role-requests)
están en dev.py por requerir permisos de development.
"""

from datetime import datetime, timezone

from flask import current_app, jsonify, request, g
from sqlalchemy import desc
from sqlalchemy.orm import selectinload

from . import api
from ..extensions import db, mail
from ..models import RoleRequest
from ..auth import require_session
from ..services.mail import resolve_mail_sender


# ============================================================================
# Funciones helper privadas
# ============================================================================


def _notify_role_request_created(user, role_request):
    """Notifica al equipo cuando se registra una solicitud de rol administrador."""
    configured = current_app.config.get('ROLE_REQUEST_RECIPIENTS') or current_app.config.get('CONTACT_RECIPIENTS')
    if isinstance(configured, str):
        recipients = [configured]
    else:
        recipients = list(configured or [])

    recipients = [r for r in recipients if r]
    if not recipients:
        current_app.logger.info(
            "Solicitud de rol registrada pero sin destinatarios configurados (usuario: %s).",
            user.email,
        )
        return

    sender = resolve_mail_sender()
    if not sender:
        current_app.logger.warning(
            "No se pudo notificar solicitud de rol: remitente no configurado (usuario: %s).",
            user.email,
        )
        return

    created_at = role_request.created_at
    if created_at and created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    created_label = created_at.isoformat() if created_at else datetime.now(timezone.utc).isoformat()

    roles = sorted({(r.name or '').strip() or 'sin rol' for r in getattr(user, 'roles', [])})
    role_list = ', '.join(roles) if roles else 'sin roles adicionales'

    body = (
        "Se registró una nueva solicitud para otorgar el rol 'admin'.\n\n"
        f"Usuario: {user.name} <{user.email}>\n"
        f"ID visible: {user.public_id}\n"
        f"ID interno: {user.id}\n"
        f"Roles actuales: {role_list}\n"
        f"Fecha de solicitud: {created_label}\n"
        f"Notas del solicitante: {role_request.notes or 'Sin notas adicionales.'}\n"
        f"ID solicitud: {role_request.id}\n"
    )

    try:
        from flask_mail import Message
        msg = Message(
            subject="Nueva solicitud de rol administrador",
            sender=sender,
            recipients=recipients,
            body=body,
        )
        mail.send(msg)
    except Exception as exc:
        current_app.logger.error(
            "No se pudo enviar la notificación de solicitud de rol (usuario: %s): %s",
            user.email,
            exc,
        )


@api.post("/role-requests")
@require_session
def create_role_request():
    """Crea una solicitud de rol (actualmente solo 'admin')."""
    data = request.get_json() or {}
    requested_role = (data.get("role") or "").strip().lower()

    if requested_role != "admin":
        return jsonify(error="Solo se permite solicitar el rol 'admin'."), 400

    if 'admin' in {r.name for r in g.current_user.roles}:
        return jsonify(error="Ya cuentas con privilegios de administrador."), 400

    existing = db.session.query(RoleRequest).filter(
        RoleRequest.user_id == g.current_user.id,
        RoleRequest.requested_role == 'admin',
        RoleRequest.status == 'pending'
    ).first()
    if existing:
        return jsonify(error="Ya tienes una solicitud pendiente."), 409

    notes = (data.get("notes") or "").strip() or None
    req = RoleRequest(
        user_id=g.current_user.id,
        requested_role='admin',
        status='pending',
        notes=notes,
    )
    db.session.add(req)
    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("Error al registrar solicitud de rol: %s", exc)
        return jsonify(error="No se pudo registrar la solicitud."), 500
    else:
        _notify_role_request_created(g.current_user, req)

    return jsonify(
        message="Solicitud registrada. Enviamos un aviso al equipo de desarrollo para revisar tu caso.",
        request_id=str(req.id),
    ), 201


@api.get("/role-requests/me")
@require_session
def get_my_role_request_status():
    """Obtiene el estado de la solicitud de rol más reciente del usuario actual."""
    latest = (
        db.session.query(RoleRequest)
        .options(selectinload(RoleRequest.resolver))
        .filter(RoleRequest.user_id == g.current_user.id)
        .order_by(desc(RoleRequest.created_at))
        .first()
    )

    if not latest:
        return jsonify(request=None)

    resolver = latest.resolver
    return jsonify(
        request={
            "id": str(latest.id),
            "requested_role": latest.requested_role,
            "status": latest.status,
            "created_at": latest.created_at.isoformat() if latest.created_at else None,
            "resolved_at": latest.resolved_at.isoformat() if latest.resolved_at else None,
            "resolver": {
                "id": str(resolver.id),
                "name": resolver.name,
            } if resolver else None,
            "notes": latest.notes,
        }
    )
