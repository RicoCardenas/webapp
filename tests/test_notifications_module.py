"""
Tests para backend/app/notifications.py
Sistema de notificaciones de usuario.
"""
import pytest
from datetime import datetime, timezone
from backend.app.notifications import (
    serialize_notification,
    is_category_enabled,
    count_unread,
    count_unread_by_category,
    publish_event,
    NOTIFICATION_CATEGORIES
)
from backend.app.models import UserNotification, NotificationPreference


class TestSerializeNotification:
    """Tests para serialize_notification."""
    
    def test_serialize_basic_notification(self, app, user_factory, _db):
        """Debe serializar notificación básica correctamente."""
        with app.app_context():
            user = user_factory()
            
            notif = UserNotification(
                user_id=user.id,
                category="ticket",
                title="Test Notification",
                body="This is a test body",
                created_at=datetime(2025, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
            )
            _db.session.add(notif)
            _db.session.commit()
            
            result = serialize_notification(notif)
            
            assert result['category'] == "ticket"
            assert result['title'] == "Test Notification"
            assert result['body'] == "This is a test body"
            assert result['created_at'] == "2025-01-01T12:00:00+00:00"
            assert result['read_at'] is None
    
    def test_serialize_with_payload(self, app, user_factory, _db):
        """Debe serializar payload como dict."""
        with app.app_context():
            user = user_factory()
            
            notif = UserNotification(
                user_id=user.id,
                category="ticket",
                title="Test",
                body="Body",
                payload={"ticket_id": 123, "status": "open"}
            )
            _db.session.add(notif)
            _db.session.commit()
            
            result = serialize_notification(notif)
            
            assert result['payload'] == {"ticket_id": 123, "status": "open"}
    
    def test_serialize_read_notification(self, app, user_factory, _db):
        """Debe incluir read_at si está marcada como leída."""
        with app.app_context():
            user = user_factory()
            
            read_time = datetime(2025, 1, 2, 10, 0, 0, tzinfo=timezone.utc)
            notif = UserNotification(
                user_id=user.id,
                category="reminder",
                title="Read Notif",
                body="Already read",
                read_at=read_time
            )
            _db.session.add(notif)
            _db.session.commit()
            
            result = serialize_notification(notif)
            
            assert result['read_at'] == "2025-01-02T10:00:00+00:00"


class TestIsCategoryEnabled:
    """Tests para is_category_enabled."""
    
    def test_category_enabled_by_default(self, app, user_factory, _db):
        """Categorías sin preferencia deben estar habilitadas por defecto."""
        with app.app_context():
            user = user_factory()
            
            result = is_category_enabled(user.id, "ticket", session=_db.session)
            assert result is True
    
    def test_explicitly_enabled_category(self, app, user_factory, _db):
        """Categoría habilitada explícitamente debe retornar True."""
        with app.app_context():
            user = user_factory()
            
            pref = NotificationPreference(
                user_id=user.id,
                category="reminder",
                enabled=True
            )
            _db.session.add(pref)
            _db.session.commit()
            
            result = is_category_enabled(user.id, "reminder", session=_db.session)
            assert result is True
    
    def test_explicitly_disabled_category(self, app, user_factory, _db):
        """Categoría deshabilitada explícitamente debe retornar False."""
        with app.app_context():
            user = user_factory()
            
            pref = NotificationPreference(
                user_id=user.id,
                category="security",
                enabled=False
            )
            _db.session.add(pref)
            _db.session.commit()
            
            result = is_category_enabled(user.id, "security", session=_db.session)
            assert result is False
    
    def test_empty_category_returns_true(self, app, user_factory, _db):
        """Categoría vacía debe retornar True."""
        with app.app_context():
            user = user_factory()
            
            result = is_category_enabled(user.id, "", session=_db.session)
            assert result is True
    
    def test_none_category_returns_true(self, app, user_factory, _db):
        """Categoría None debe retornar True."""
        with app.app_context():
            user = user_factory()
            
            result = is_category_enabled(user.id, None, session=_db.session)
            assert result is True
    
    def test_case_insensitive_category(self, app, user_factory, _db):
        """Categoría debe ser case-insensitive."""
        with app.app_context():
            user = user_factory()
            
            pref = NotificationPreference(
                user_id=user.id,
                category="ticket",
                enabled=False
            )
            _db.session.add(pref)
            _db.session.commit()
            
            result = is_category_enabled(user.id, "TICKET", session=_db.session)
            assert result is False


class TestCountUnread:
    """Tests para count_unread."""
    
    def test_count_unread_no_notifications(self, app, user_factory, _db):
        """Usuario sin notificaciones debe tener count 0."""
        with app.app_context():
            user = user_factory()
            
            count = count_unread(user.id, session=_db.session)
            assert count == 0
    
    def test_count_unread_only_read_notifications(self, app, user_factory, _db):
        """Usuario con solo notificaciones leídas debe tener count 0."""
        with app.app_context():
            user = user_factory()
            
            notif = UserNotification(
                user_id=user.id,
                category="ticket",
                title="Read",
                body="Body",
                read_at=datetime.now(timezone.utc)
            )
            _db.session.add(notif)
            _db.session.commit()
            
            count = count_unread(user.id, session=_db.session)
            assert count == 0
    
    def test_count_unread_mixed_notifications(self, app, user_factory, _db):
        """Debe contar solo las no leídas."""
        with app.app_context():
            user = user_factory()
            
            # 2 no leídas
            unread1 = UserNotification(
                user_id=user.id, category="ticket", title="1", body="B"
            )
            unread2 = UserNotification(
                user_id=user.id, category="reminder", title="2", body="B"
            )
            # 1 leída
            read1 = UserNotification(
                user_id=user.id,
                category="security",
                title="3",
                body="B",
                read_at=datetime.now(timezone.utc)
            )
            
            _db.session.add_all([unread1, unread2, read1])
            _db.session.commit()
            
            count = count_unread(user.id, session=_db.session)
            assert count == 2
    
    def test_count_unread_multiple_users(self, app, user_factory, _db):
        """Debe contar solo las del usuario específico."""
        with app.app_context():
            user1 = user_factory(email="user1@example.com")
            user2 = user_factory(email="user2@example.com")
            
            notif1 = UserNotification(
                user_id=user1.id, category="ticket", title="U1", body="B"
            )
            notif2 = UserNotification(
                user_id=user2.id, category="ticket", title="U2", body="B"
            )
            
            _db.session.add_all([notif1, notif2])
            _db.session.commit()
            
            count1 = count_unread(user1.id, session=_db.session)
            count2 = count_unread(user2.id, session=_db.session)
            
            assert count1 == 1
            assert count2 == 1


class TestCountUnreadByCategory:
    """Tests para count_unread_by_category."""
    
    def test_count_by_category_specific(self, app, user_factory, _db):
        """Debe contar solo las de la categoría específica."""
        with app.app_context():
            user = user_factory()
            
            ticket1 = UserNotification(
                user_id=user.id, category="ticket", title="T1", body="B"
            )
            ticket2 = UserNotification(
                user_id=user.id, category="ticket", title="T2", body="B"
            )
            reminder = UserNotification(
                user_id=user.id, category="reminder", title="R1", body="B"
            )
            
            _db.session.add_all([ticket1, ticket2, reminder])
            _db.session.commit()
            
            ticket_count = count_unread_by_category(
                user.id, "ticket", session=_db.session
            )
            reminder_count = count_unread_by_category(
                user.id, "reminder", session=_db.session
            )
            
            assert ticket_count == 2
            assert reminder_count == 1
    
    def test_count_by_category_empty_category(self, app, user_factory, _db):
        """Categoría vacía debe contar todas."""
        with app.app_context():
            user = user_factory()
            
            notif1 = UserNotification(
                user_id=user.id, category="ticket", title="1", body="B"
            )
            notif2 = UserNotification(
                user_id=user.id, category="reminder", title="2", body="B"
            )
            
            _db.session.add_all([notif1, notif2])
            _db.session.commit()
            
            total_count = count_unread_by_category(
                user.id, "", session=_db.session
            )
            assert total_count == 2
    
    def test_count_by_category_nonexistent(self, app, user_factory, _db):
        """Categoría inexistente debe retornar 0."""
        with app.app_context():
            user = user_factory()
            
            notif = UserNotification(
                user_id=user.id, category="ticket", title="1", body="B"
            )
            _db.session.add(notif)
            _db.session.commit()
            
            count = count_unread_by_category(
                user.id, "nonexistent", session=_db.session
            )
            assert count == 0
    
    def test_count_by_category_case_insensitive(self, app, user_factory, _db):
        """Categoría debe ser case-insensitive."""
        with app.app_context():
            user = user_factory()
            
            notif = UserNotification(
                user_id=user.id, category="ticket", title="1", body="B"
            )
            _db.session.add(notif)
            _db.session.commit()
            
            count = count_unread_by_category(
                user.id, "TICKET", session=_db.session
            )
            assert count == 1


class TestPublishEvent:
    """Tests para publish_event."""
    
    def test_publish_event_with_valid_user(self, app, user_factory, monkeypatch):
        """Debe publicar evento para usuario válido."""
        with app.app_context():
            user = user_factory()
            
            published_events = []
            
            def mock_publish(user_id, *, channel, event_type, data):
                published_events.append({
                    'user_id': user_id,
                    'channel': channel,
                    'event_type': event_type,
                    'data': data
                })
            
            from backend.app import event_stream
            monkeypatch.setattr(event_stream.events, "publish", mock_publish)
            
            publish_event(
                user.id,
                event_type="notification:created",
                data={"title": "Test"}
            )
            
            assert len(published_events) == 1
            assert published_events[0]['user_id'] == user.id
            assert published_events[0]['channel'] == "notifications"
            assert published_events[0]['event_type'] == "notification:created"
            assert published_events[0]['data'] == {"title": "Test"}
    
    def test_publish_event_with_none_user_id(self, app, monkeypatch):
        """Debe ignorar si user_id es None."""
        with app.app_context():
            published_events = []
            
            def mock_publish(*args, **kwargs):
                published_events.append(True)
            
            from backend.app import event_stream
            monkeypatch.setattr(event_stream.events, "publish", mock_publish)
            
            publish_event(
                None,
                event_type="test",
                data={}
            )
            
            assert len(published_events) == 0
    
    def test_publish_event_with_zero_user_id(self, app, monkeypatch):
        """Debe ignorar si user_id es 0 (falsy)."""
        with app.app_context():
            published_events = []
            
            def mock_publish(*args, **kwargs):
                published_events.append(True)
            
            from backend.app import event_stream
            monkeypatch.setattr(event_stream.events, "publish", mock_publish)
            
            publish_event(
                0,
                event_type="test",
                data={}
            )
            
            assert len(published_events) == 0


class TestCreateNotification:
    """Tests para create_notification."""
    
    def test_create_notification_basic(self, app, user_factory, _db, monkeypatch):
        """Debe crear notificación correctamente."""
        with app.app_context():
            user = user_factory()
            
            published_events = []
            def mock_publish(user_id, *, channel, event_type, data):
                published_events.append({'event_type': event_type})
            
            from backend.app import event_stream
            monkeypatch.setattr(event_stream.events, "publish", mock_publish)
            
            from backend.app.notifications import create_notification
            
            notif = create_notification(
                user.id,
                category="ticket",
                title="Test Notification",
                body="Test body",
                payload={"ticket_id": 123},
                session=_db.session
            )
            
            assert notif is not None
            assert notif.category == "ticket"
            assert notif.title == "Test Notification"
            assert notif.body == "Test body"
            assert notif.payload == {"ticket_id": 123}
            assert len(published_events) == 1
            assert published_events[0]['event_type'] == "notifications:new"
    
    def test_create_notification_disabled_category(self, app, user_factory, _db):
        """No debe crear notificación si categoría está deshabilitada."""
        with app.app_context():
            user = user_factory()
            
            pref = NotificationPreference(
                user_id=user.id,
                category="reminder",
                enabled=False
            )
            _db.session.add(pref)
            _db.session.commit()
            
            from backend.app.notifications import create_notification
            
            notif = create_notification(
                user.id,
                category="reminder",
                title="Should not be created",
                session=_db.session
            )
            
            assert notif is None
    
    def test_create_notification_empty_category(self, app, user_factory, _db):
        """No debe crear notificación con categoría vacía."""
        with app.app_context():
            user = user_factory()
            
            from backend.app.notifications import create_notification
            
            notif = create_notification(
                user.id,
                category="",
                title="Test",
                session=_db.session
            )
            
            assert notif is None
    
    def test_create_notification_empty_title(self, app, user_factory, _db):
        """No debe crear notificación sin título."""
        with app.app_context():
            user = user_factory()
            
            from backend.app.notifications import create_notification
            
            notif = create_notification(
                user.id,
                category="ticket",
                title="",
                session=_db.session
            )
            
            assert notif is None


class TestMarkNotificationsRead:
    """Tests para mark_notifications_read."""
    
    def test_mark_single_notification_read(self, app, user_factory, _db, monkeypatch):
        """Debe marcar una notificación como leída."""
        with app.app_context():
            user = user_factory()
            
            notif = UserNotification(
                user_id=user.id,
                category="ticket",
                title="Test",
                body="Body"
            )
            _db.session.add(notif)
            _db.session.commit()
            
            published_events = []
            def mock_publish(*args, **kwargs):
                published_events.append(True)
            
            from backend.app import event_stream
            monkeypatch.setattr(event_stream.events, "publish", mock_publish)
            
            from backend.app.notifications import mark_notifications_read
            
            updated = mark_notifications_read(
                user.id,
                [notif.id],
                session=_db.session
            )
            
            assert updated == 1
            _db.session.expire_all()
            assert notif.read_at is not None
            assert len(published_events) == 1
    
    def test_mark_multiple_notifications_read(self, app, user_factory, _db, monkeypatch):
        """Debe marcar múltiples notificaciones como leídas."""
        with app.app_context():
            user = user_factory()
            
            notif1 = UserNotification(
                user_id=user.id, category="ticket", title="1", body="B"
            )
            notif2 = UserNotification(
                user_id=user.id, category="reminder", title="2", body="B"
            )
            _db.session.add_all([notif1, notif2])
            _db.session.commit()
            
            published_events = []
            def mock_publish(*args, **kwargs):
                published_events.append(True)
            
            from backend.app import event_stream
            monkeypatch.setattr(event_stream.events, "publish", mock_publish)
            
            from backend.app.notifications import mark_notifications_read
            
            updated = mark_notifications_read(
                user.id,
                [notif1.id, notif2.id],
                session=_db.session
            )
            
            assert updated == 2
    
    def test_mark_empty_list(self, app, user_factory, _db):
        """No debe actualizar nada con lista vacía."""
        with app.app_context():
            user = user_factory()
            
            from backend.app.notifications import mark_notifications_read
            
            updated = mark_notifications_read(
                user.id,
                [],
                session=_db.session
            )
            
            assert updated == 0
    
    def test_mark_only_unread_notifications(self, app, user_factory, _db, monkeypatch):
        """Solo debe marcar las no leídas."""
        with app.app_context():
            user = user_factory()
            
            already_read = UserNotification(
                user_id=user.id,
                category="ticket",
                title="Already read",
                body="B",
                read_at=datetime.now(timezone.utc)
            )
            unread = UserNotification(
                user_id=user.id,
                category="ticket",
                title="Unread",
                body="B"
            )
            _db.session.add_all([already_read, unread])
            _db.session.commit()
            
            published_events = []
            def mock_publish(*args, **kwargs):
                published_events.append(True)
            
            from backend.app import event_stream
            monkeypatch.setattr(event_stream.events, "publish", mock_publish)
            
            from backend.app.notifications import mark_notifications_read
            
            updated = mark_notifications_read(
                user.id,
                [already_read.id, unread.id],
                session=_db.session
            )
            
            assert updated == 1


class TestMarkAllRead:
    """Tests para mark_all_read."""
    
    def test_mark_all_read_no_category(self, app, user_factory, _db, monkeypatch):
        """Debe marcar todas las notificaciones como leídas."""
        with app.app_context():
            user = user_factory()
            
            notif1 = UserNotification(
                user_id=user.id, category="ticket", title="1", body="B"
            )
            notif2 = UserNotification(
                user_id=user.id, category="reminder", title="2", body="B"
            )
            _db.session.add_all([notif1, notif2])
            _db.session.commit()
            
            published_events = []
            def mock_publish(*args, **kwargs):
                published_events.append(True)
            
            from backend.app import event_stream
            monkeypatch.setattr(event_stream.events, "publish", mock_publish)
            
            from backend.app.notifications import mark_all_read
            
            updated = mark_all_read(user.id, session=_db.session)
            
            assert updated == 2
            assert len(published_events) == 1
    
    def test_mark_all_read_by_category(self, app, user_factory, _db, monkeypatch):
        """Debe marcar solo las de una categoría."""
        with app.app_context():
            user = user_factory()
            
            ticket = UserNotification(
                user_id=user.id, category="ticket", title="T", body="B"
            )
            reminder = UserNotification(
                user_id=user.id, category="reminder", title="R", body="B"
            )
            _db.session.add_all([ticket, reminder])
            _db.session.commit()
            
            published_events = []
            def mock_publish(*args, **kwargs):
                published_events.append(True)
            
            from backend.app import event_stream
            monkeypatch.setattr(event_stream.events, "publish", mock_publish)
            
            from backend.app.notifications import mark_all_read
            
            updated = mark_all_read(
                user.id,
                category="ticket",
                session=_db.session
            )
            
            assert updated == 1
    
    def test_mark_all_read_no_unread(self, app, user_factory, _db, monkeypatch):
        """No debe publicar evento si no hay actualizaciones."""
        with app.app_context():
            user = user_factory()
            
            published_events = []
            def mock_publish(*args, **kwargs):
                published_events.append(True)
            
            from backend.app import event_stream
            monkeypatch.setattr(event_stream.events, "publish", mock_publish)
            
            from backend.app.notifications import mark_all_read
            
            updated = mark_all_read(user.id, session=_db.session)
            
            assert updated == 0
            assert len(published_events) == 0


class TestUpdatePreferences:
    """Tests para update_preferences."""
    
    def test_update_preferences_new(self, app, user_factory, _db):
        """Debe crear nuevas preferencias."""
        with app.app_context():
            user = user_factory()
            
            from backend.app.notifications import update_preferences
            
            result = update_preferences(
                user.id,
                {"ticket": False, "reminder": True},
                session=_db.session
            )
            
            assert result["ticket"] is False
            assert result["reminder"] is True
            assert result["security"] is True  # default
            assert result["role_request"] is True  # default
    
    def test_update_existing_preferences(self, app, user_factory, _db):
        """Debe actualizar preferencias existentes."""
        with app.app_context():
            user = user_factory()
            
            pref = NotificationPreference(
                user_id=user.id,
                category="ticket",
                enabled=True
            )
            _db.session.add(pref)
            _db.session.commit()
            
            from backend.app.notifications import update_preferences
            
            result = update_preferences(
                user.id,
                {"ticket": False},
                session=_db.session
            )
            
            assert result["ticket"] is False
            _db.session.expire_all()
            assert pref.enabled is False
    
    def test_update_preferences_ignore_invalid_categories(self, app, user_factory, _db):
        """Debe ignorar categorías inválidas."""
        with app.app_context():
            user = user_factory()
            
            from backend.app.notifications import update_preferences
            
            result = update_preferences(
                user.id,
                {"invalid_category": False, "ticket": False},
                session=_db.session
            )
            
            assert "invalid_category" not in result
            assert result["ticket"] is False
    
    def test_update_preferences_empty_dict(self, app, user_factory, _db):
        """Debe retornar preferencias actuales con dict vacío."""
        with app.app_context():
            user = user_factory()
            
            from backend.app.notifications import update_preferences
            
            result = update_preferences(
                user.id,
                {},
                session=_db.session
            )
            
            assert result["ticket"] is True
            assert result["reminder"] is True


class TestGetPreferences:
    """Tests para get_preferences."""
    
    def test_get_preferences_defaults(self, app, user_factory, _db):
        """Debe retornar preferencias por defecto."""
        with app.app_context():
            user = user_factory()
            
            from backend.app.notifications import get_preferences
            
            result = get_preferences(user.id, session=_db.session)
            
            assert result["ticket"] is True
            assert result["reminder"] is True
            assert result["security"] is True
            assert result["role_request"] is True
    
    def test_get_preferences_custom(self, app, user_factory, _db):
        """Debe retornar preferencias personalizadas."""
        with app.app_context():
            user = user_factory()
            
            pref = NotificationPreference(
                user_id=user.id,
                category="ticket",
                enabled=False
            )
            _db.session.add(pref)
            _db.session.commit()
            
            from backend.app.notifications import get_preferences
            
            result = get_preferences(user.id, session=_db.session)
            
            assert result["ticket"] is False
            assert result["reminder"] is True
