"""Sistema de notificaciones en tiempo real."""

from flask import jsonify, g, request

import math

from flask import current_app, jsonify, request, g
from sqlalchemy import desc

from . import api
from ..extensions import db
from ..models import UserNotification
from ..auth import require_session
from ..notifications import (
    NOTIFICATION_CATEGORIES,
    serialize_notification,
    mark_notifications_read,
    mark_all_read,
    update_preferences,
    get_preferences,
    count_unread,
)


# ============================================================================
# Constantes
# ============================================================================

NOTIFICATION_DEFAULT_PAGE_SIZE = 15
NOTIFICATION_MIN_PAGE_SIZE = 5
NOTIFICATION_MAX_PAGE_SIZE = 50


# ============================================================================
# Funciones helper privadas
# ============================================================================

def _notification_query_params():
    """Extrae y valida parámetros de query para listar notificaciones."""
    args = request.args

    def _read_int(name, default):
        try:
            return int(args.get(name, default))
        except (TypeError, ValueError):
            return default

    page = max(1, _read_int('page', 1))
    page_size = _read_int('page_size', NOTIFICATION_DEFAULT_PAGE_SIZE)
    page_size = max(NOTIFICATION_MIN_PAGE_SIZE, min(page_size, NOTIFICATION_MAX_PAGE_SIZE))
    include_read = str(args.get('include_read', '')).strip().lower() in {'1', 'true', 'yes'}
    category = (args.get('category') or '').strip().lower()
    if category and category not in NOTIFICATION_CATEGORIES:
        category = ''

    return {
        'page': page,
        'page_size': page_size,
        'offset': (page - 1) * page_size,
        'include_read': include_read,
        'category': category,
    }


# ============================================================================
# Rutas de notificaciones
# ============================================================================

@api.get("/account/notifications")
@require_session
def account_notifications():
    """Lista las notificaciones del usuario con paginación y filtros."""
    params = _notification_query_params()
    query = db.session.query(UserNotification).filter(UserNotification.user_id == g.current_user.id)
    if params['category']:
        query = query.filter(UserNotification.category == params['category'])
    if not params['include_read']:
        query = query.filter(UserNotification.read_at.is_(None))

    total = query.count()
    rows = (
        query.order_by(desc(UserNotification.created_at))
        .offset(params['offset'])
        .limit(params['page_size'])
        .all()
    )

    payload = [serialize_notification(row) for row in rows]
    total_pages = math.ceil(total / params['page_size']) if total else 0
    categories = {key: meta.get("label", key.title()) for key, meta in NOTIFICATION_CATEGORIES.items()}

    return jsonify(
        data=payload,
        meta={
            "page": params['page'],
            "page_size": params['page_size'],
            "total": total,
            "total_pages": total_pages,
            "include_read": params['include_read'],
            "category": params['category'] or None,
            "unread": count_unread(g.current_user.id),
        },
        categories=categories,
        preferences=get_preferences(g.current_user.id),
    )


@api.post("/account/notifications/<uuid:notification_id>/read")
@require_session
def account_notification_read(notification_id):
    """Marca una notificación específica como leída."""
    notification = db.session.get(UserNotification, notification_id)
    if not notification or notification.user_id != g.current_user.id:
        return jsonify(error="Notificación no encontrada."), 404

    if notification.read_at is None:
        mark_notifications_read(g.current_user.id, [notification_id])

    try:
        db.session.commit()
        db.session.refresh(notification)
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("No se pudo marcar notificación %s: %s", notification_id, exc)
        return jsonify(error="No se pudo actualizar la notificación."), 500

    return jsonify(
        message="Notificación marcada como leída.",
        notification=serialize_notification(notification),
        unread=count_unread(g.current_user.id),
    )


@api.post("/account/notifications/read-all")
@require_session
def account_notifications_read_all():
    """Marca todas las notificaciones del usuario como leídas."""
    data = request.get_json(silent=True) or {}
    category = (data.get('category') or '').strip().lower()
    if category and category not in NOTIFICATION_CATEGORIES:
        return jsonify(error="Categoría inválida."), 400

    mark_all_read(g.current_user.id, category=category or None)
    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("No se pudieron marcar notificaciones: %s", exc)
        return jsonify(error="No se pudieron marcar las notificaciones."), 500

    return jsonify(
        message="Notificaciones marcadas como leídas.",
        unread=count_unread(g.current_user.id),
    )


@api.get("/account/notifications/preferences")
@require_session
def account_notification_preferences():
    """Obtiene las preferencias de notificaciones del usuario."""
    categories = {key: meta.get("label", key.title()) for key, meta in NOTIFICATION_CATEGORIES.items()}
    return jsonify(
        preferences=get_preferences(g.current_user.id),
        categories=categories,
    )


@api.put("/account/notifications/preferences")
@require_session
def account_notification_preferences_update():
    """Actualiza las preferencias de notificaciones del usuario."""
    data = request.get_json(silent=True)
    if data is None or not isinstance(data, dict):
        return jsonify(error="Datos inválidos. Envía un objeto con las preferencias."), 400

    prefs = update_preferences(g.current_user.id, data)
    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("No se pudieron actualizar las preferencias de notificaciones: %s", exc)
        return jsonify(error="No se pudieron actualizar las preferencias."), 500

    return jsonify(
        message="Preferencias actualizadas.",
        preferences=prefs,
    )
