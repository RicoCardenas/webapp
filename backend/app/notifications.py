"""Notification utilities for user-facing events."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Optional

from sqlalchemy import func, select

from .event_stream import events as event_bus
from .extensions import db
from .models import NotificationPreference, UserNotification

NOTIFICATION_CATEGORIES: Dict[str, Dict[str, str]] = {
    "role_request": {"label": "Solicitudes"},
    "ticket": {"label": "Tickets"},
    "reminder": {"label": "Recordatorios"},
    "security": {"label": "Seguridad"},
}


def _now():
    return datetime.now(timezone.utc)


def serialize_notification(notification: UserNotification) -> Dict[str, Any]:
    return {
        "id": str(notification.id),
        "category": notification.category,
        "title": notification.title,
        "body": notification.body,
        "payload": dict(notification.payload or {}),
        "created_at": notification.created_at.isoformat() if notification.created_at else None,
        "read_at": notification.read_at.isoformat() if notification.read_at else None,
    }


def _preferences_map(user_id, *, session=None) -> Dict[str, bool]:
    session = session or db.session
    rows = session.execute(
        select(NotificationPreference.category, NotificationPreference.enabled).where(
            NotificationPreference.user_id == user_id
        )
    ).all()
    prefs = {category: bool(enabled) for category, enabled in rows}
    for category in NOTIFICATION_CATEGORIES:
        prefs.setdefault(category, True)
    return prefs


def is_category_enabled(user_id, category: str, *, session=None) -> bool:
    category = (category or "").strip().lower()
    if not category:
        return True
    session = session or db.session
    pref = session.execute(
        select(NotificationPreference.enabled).where(
            NotificationPreference.user_id == user_id,
            NotificationPreference.category == category,
        )
    ).scalar_one_or_none()
    if pref is None:
        return True
    return bool(pref)


def count_unread(user_id, *, session=None) -> int:
    session = session or db.session
    value = session.execute(
        select(func.count()).select_from(UserNotification).where(
            UserNotification.user_id == user_id,
            UserNotification.read_at.is_(None),
        )
    ).scalar()
    return int(value or 0)


def count_unread_by_category(user_id, category: str, *, session=None) -> int:
    session = session or db.session
    category = (category or "").strip().lower()
    if not category:
        return count_unread(user_id, session=session)
    value = session.execute(
        select(func.count()).select_from(UserNotification).where(
            UserNotification.user_id == user_id,
            UserNotification.category == category,
            UserNotification.read_at.is_(None),
        )
    ).scalar()
    return int(value or 0)


def publish_event(user_id, *, event_type: str, data: Dict[str, Any]) -> None:
    if not user_id:
        return
    event_bus.publish(
        user_id,
        channel="notifications",
        event_type=event_type,
        data=data,
    )


def create_notification(
    user_id,
    *,
    category: str,
    title: str,
    body: Optional[str] = None,
    payload: Optional[Dict[str, Any]] = None,
    session=None,
) -> Optional[UserNotification]:
    session = session or db.session
    category = (category or "").strip().lower()
    if not category or not title:
        return None

    if not is_category_enabled(user_id, category, session=session):
        return None

    notification = UserNotification(
        user_id=user_id,
        category=category,
        title=title,
        body=body,
        payload=payload or {},
    )
    session.add(notification)
    session.flush([notification])

    unread = count_unread(user_id, session=session)
    publish_event(
        user_id,
        event_type="notifications:new",
        data={
            "notification": serialize_notification(notification),
            "unread": unread,
        },
    )
    return notification


def mark_notifications_read(user_id, notification_ids: Iterable, *, session=None) -> int:
    session = session or db.session
    ids = [str(nid) for nid in notification_ids if nid]
    if not ids:
        return 0
    updated = (
        session.query(UserNotification)
        .filter(
            UserNotification.user_id == user_id,
            UserNotification.id.in_(ids),
            UserNotification.read_at.is_(None),
        )
        .update({"read_at": _now()}, synchronize_session=False)
    )
    if updated:
        session.flush()
        unread = count_unread(user_id, session=session)
        publish_event(
            user_id,
            event_type="notifications:update",
            data={"unread": unread},
        )
    return int(updated or 0)


def mark_all_read(user_id, *, category: Optional[str] = None, session=None) -> int:
    session = session or db.session
    query = session.query(UserNotification).filter(
        UserNotification.user_id == user_id,
        UserNotification.read_at.is_(None),
    )
    if category:
        query = query.filter(UserNotification.category == category)
    updated = query.update({"read_at": _now()}, synchronize_session=False)
    if updated:
        session.flush()
        publish_event(
            user_id,
            event_type="notifications:update",
            data={"unread": count_unread(user_id, session=session)},
        )
    return int(updated or 0)


def update_preferences(user_id, preferences: Dict[str, bool], *, session=None) -> Dict[str, bool]:
    session = session or db.session
    cleaned = {}
    for category, enabled in (preferences or {}).items():
        key = (category or "").strip().lower()
        if not key or key not in NOTIFICATION_CATEGORIES:
            continue
        cleaned[key] = bool(enabled)

    if not cleaned:
        return _preferences_map(user_id, session=session)

    existing = {
        pref.category: pref
        for pref in session.execute(
            select(NotificationPreference).where(NotificationPreference.user_id == user_id)
        ).scalars()
    }

    for category, enabled in cleaned.items():
        pref = existing.get(category)
        if pref:
            pref.enabled = enabled
            pref.updated_at = _now()
        else:
            session.add(
                NotificationPreference(
                    user_id=user_id,
                    category=category,
                    enabled=enabled,
                )
            )
    session.flush()
    return _preferences_map(user_id, session=session)


def get_preferences(user_id, *, session=None) -> Dict[str, bool]:
    return _preferences_map(user_id, session=session)
