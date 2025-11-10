"""Gestión de cuenta: dashboard, tickets y preferencias."""

from datetime import datetime, timezone

import math
from datetime import datetime, timezone

from flask import current_app, jsonify, request, g
from sqlalchemy import desc

from . import api
from ..extensions import db
from ..models import RequestTicket
from ..auth import require_session
from ..notifications import create_notification


TICKET_MIN_PAGE_SIZE = 5
TICKET_MAX_PAGE_SIZE = 20
TICKET_ALLOWED_TYPES = {'soporte', 'rol', 'consulta', 'otro'}
TICKET_ALLOWED_STATUS = {'pendiente', 'atendida', 'rechazada'}

DASHBOARD_WIDGETS = {
    "stats": "account-details-box",
    "history": "account-history-box",
    "notifications": "account-notifications-box",
    "tickets": "account-tickets-box",
    "security": "account-2fa-box",
    "learning": "account-learning-box",
}


def _default_dashboard_layout():
    """Retorna el layout por defecto del dashboard."""
    return {
        "order": list(DASHBOARD_WIDGETS.keys()),
        "hidden": [],
    }


def _normalize_dashboard_layout(layout):
    """Normaliza y valida el layout del dashboard."""
    default = _default_dashboard_layout()
    if not isinstance(layout, dict):
        return default

    order = layout.get("order")
    hidden = layout.get("hidden")

    normalized_order = []
    if isinstance(order, (list, tuple)):
        for key in order:
            key_norm = str(key).strip().lower()
            if key_norm in DASHBOARD_WIDGETS and key_norm not in normalized_order:
                normalized_order.append(key_norm)
    for key in default["order"]:
        if key not in normalized_order:
            normalized_order.append(key)

    normalized_hidden = []
    if isinstance(hidden, (list, tuple)):
        for key in hidden:
            key_norm = str(key).strip().lower()
            if key_norm in DASHBOARD_WIDGETS and key_norm not in normalized_hidden:
                normalized_hidden.append(key_norm)

    normalized_hidden = [key for key in normalized_hidden if key in normalized_order]

    return {
        "order": normalized_order,
        "hidden": normalized_hidden,
    }


def _resolve_dashboard_layout(user):
    """Obtiene el layout del dashboard del usuario, normalizado."""
    stored = getattr(user, "dashboard_layout", None) or {}
    return _normalize_dashboard_layout(stored)


def _store_dashboard_layout(user, layout):
    """Guarda el layout del dashboard del usuario."""
    cleaned = _normalize_dashboard_layout(layout)
    user.dashboard_layout = cleaned
    return cleaned


# ============================================================================
# Funciones helper privadas - Tickets
# ============================================================================

def _ticket_query_params():
    """Extrae y valida parámetros de query para listar tickets."""
    args = request.args

    def _read_int(name, default):
        try:
            return int(args.get(name, default))
        except (TypeError, ValueError):
            return default

    page = _read_int('page', 1)
    if page < 1:
        page = 1

    page_size = _read_int('page_size', TICKET_MIN_PAGE_SIZE)
    page_size = max(TICKET_MIN_PAGE_SIZE, min(page_size, TICKET_MAX_PAGE_SIZE))

    status = (args.get('status') or '').strip().lower()
    if status and status not in TICKET_ALLOWED_STATUS:
        status = None

    return {
        'page': page,
        'page_size': page_size,
        'offset': (page - 1) * page_size,
        'status': status,
    }


def _serialize_ticket(ticket: RequestTicket):
    """Serializa un ticket a JSON."""
    return {
        'id': str(ticket.id),
        'type': ticket.type,
        'title': ticket.title,
        'description': ticket.description,
        'status': ticket.status,
        'created_at': ticket.created_at.isoformat() if ticket.created_at else None,
        'updated_at': ticket.updated_at.isoformat() if ticket.updated_at else None,
    }


def _notify_ticket_status_change(ticket, previous_status=None):
    """Notifica al usuario sobre cambios en el estado de un ticket."""
    try:
        current_app.logger.info(
            'Ticket %s status change: %s -> %s',
            getattr(ticket, 'id', 'unknown'),
            previous_status or 'nuevo',
            getattr(ticket, 'status', 'desconocido'),
        )
    except Exception:
        pass

    try:
        if not ticket or not getattr(ticket, 'user_id', None):
            return

        status = (getattr(ticket, 'status', '') or '').strip().lower()
        previous = (previous_status or '').strip().lower()
        payload = {
            "ticket_id": str(getattr(ticket, 'id', '')),
            "status": status,
            "title": getattr(ticket, 'title', ''),
        }

        if not previous:
            title = "Solicitud recibida"
            body = f"Hemos registrado tu solicitud \"{ticket.title}\". Te avisaremos cuando cambie de estado."
        elif previous == status:
            return
        elif status == 'atendida':
            title = "Tu solicitud fue atendida"
            body = f"La solicitud \"{ticket.title}\" fue marcada como atendida."
        elif status == 'rechazada':
            title = "Tu solicitud fue rechazada"
            body = f"La solicitud \"{ticket.title}\" fue rechazada. Revisa los detalles con el equipo de soporte."
        else:
            title = "Actualizamos tu solicitud"
            body = f"La solicitud \"{ticket.title}\" ahora está en estado \"{status or 'desconocido'}\"."

        create_notification(
            ticket.user_id,
            category="ticket",
            title=title,
            body=body,
            payload=payload,
        )
    except Exception as exc:
        current_app.logger.warning("No se pudo generar notificación de ticket %s: %s", getattr(ticket, 'id', None), exc)


# ============================================================================
# Rutas de tickets
# ============================================================================

@api.post("/account/requests")
@require_session
def create_request_ticket():
    """Crea un nuevo ticket de soporte/solicitud."""
    data = request.get_json(silent=True) or {}
    ticket_type = (data.get('type') or '').strip().lower()
    title = (data.get('title') or '').strip()
    description = (data.get('description') or '').strip()

    errors = {}
    if not ticket_type or ticket_type not in TICKET_ALLOWED_TYPES:
        errors['type'] = 'Selecciona un tipo válido.'
    if len(title) < 4:
        errors['title'] = 'El título debe tener al menos 4 caracteres.'
    if len(description) < 10:
        errors['description'] = 'Describe tu solicitud con un poco más de detalle.'

    if errors:
        return jsonify(error='Datos inválidos', fields=errors), 400

    ticket = RequestTicket(
        user_id=g.current_user.id,
        type=ticket_type,
        title=title,
        description=description,
        status='pendiente',
    )
    db.session.add(ticket)
    try:
        db.session.flush([ticket])
        _notify_ticket_status_change(ticket)
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error('No se pudo crear el ticket: %s', exc)
        return jsonify(error='No se pudo registrar tu solicitud.'), 500

    payload = _serialize_ticket(ticket)
    return jsonify(message="Ticket creado.", ticket=payload), 201


@api.get("/account/security/summary")


@api.post("/account/requests")


@api.get("/account/requests")
@require_session
def list_request_tickets():
    """Lista los tickets del usuario actual con paginación."""
    params = _ticket_query_params()

    query = db.session.query(RequestTicket).filter(RequestTicket.user_id == g.current_user.id)
    if params['status']:
        query = query.filter(RequestTicket.status == params['status'])

    total = query.count()
    rows = (
        query.order_by(desc(RequestTicket.created_at))
        .offset(params['offset'])
        .limit(params['page_size'])
        .all()
    )

    total_pages = math.ceil(total / params['page_size']) if total else 0
    data = [_serialize_ticket(row) for row in rows]

    return jsonify(
        {
            'data': data,
            'meta': {
                'page': params['page'],
                'page_size': params['page_size'],
                'total': total,
                'total_pages': total_pages,
                'status': params['status'],
            },
        }
    )


@api.get("/account/dashboard/preferences")
@require_session
def account_dashboard_preferences():
    """Obtiene las preferencias del dashboard del usuario."""
    layout = _resolve_dashboard_layout(g.current_user)
    return jsonify(
        layout=layout,
        widgets=DASHBOARD_WIDGETS,
    )


@api.put("/account/dashboard/preferences")
@require_session
def account_dashboard_preferences_update():
    """Actualiza las preferencias del dashboard del usuario."""
    data = request.get_json(silent=True)
    if data is None:
        return jsonify(error="Datos inválidos. Envía el layout a guardar."), 400

    layout_source = data.get("layout") if isinstance(data, dict) else data
    cleaned = _store_dashboard_layout(g.current_user, layout_source)
    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("No se pudo actualizar el layout del panel: %s", exc)
        return jsonify(error="No se pudo guardar la personalización."), 500

    return jsonify(message="Panel personal guardado.", layout=cleaned)
