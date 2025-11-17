"""Shared helpers for audit logging and ops events."""
from flask import current_app, g, request

from ..extensions import db
from ..models import AuditLog, Users
from .request_utils import get_client_ip


def serialize_audit_entry(entry):
    """Serializa una entrada de auditoría para eventos."""
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


def queue_ops_event(payload):
    """Encola un evento de auditoría para broadcast."""
    if not payload:
        return
    events = getattr(g, "_ops_audit_events", None)
    if events is None:
        events = []
        g._ops_audit_events = events
    events.append(payload)


def record_audit(action, *, target_entity_type=None, target_entity_id=None, details=None, audit_actions=None):
    """Registra una entrada de auditoría y opcionalmente la encola como evento ops."""
    try:
        actor = getattr(getattr(g, "current_user", None), "id", None)
        payload = dict(details or {})
        entry = AuditLog(
            user_id=actor,
            action=action,
            target_entity_type=target_entity_type,
            target_entity_id=target_entity_id,
            details=payload,
            ip_address=get_client_ip(request),
        )
        db.session.add(entry)
        db.session.flush([entry])
        try:
            db.session.refresh(entry)
        except Exception:
            pass
        if audit_actions and action in audit_actions:
            serialized = serialize_audit_entry(entry)
            if serialized:
                queue_ops_event(serialized)
        return entry
    except Exception as exc:
        current_app.logger.warning("No se pudo registrar auditoría (%s): %s", action, exc)
        return None
