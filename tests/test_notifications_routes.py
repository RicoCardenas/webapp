"""
Tests para backend/app/routes/notifications_routes.py
Rutas de API de notificaciones de usuario.
"""
import pytest
from datetime import datetime, timezone
from backend.app.models import UserNotification, NotificationPreference
from backend.app.extensions import db


class TestAccountNotifications:
    """Tests para GET /api/account/notifications."""
    
    def test_list_notifications_basic(self, app, client, session_token_factory):
        """Debe listar notificaciones del usuario autenticado."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            notif = UserNotification(
                user_id=user.id,
                category="ticket",
                title="Test Notification",
                body="Test body"
            )
            db.session.add(notif)
            db.session.commit()
            
            response = client.get('/api/account/notifications', headers=headers)
            
            assert response.status_code == 200
            data = response.json
            assert 'data' in data
            assert len(data['data']) == 1
            assert data['data'][0]['title'] == "Test Notification"
            assert 'meta' in data
            assert data['meta']['total'] == 1
    
    def test_list_notifications_pagination(self, app, client, session_token_factory):
        """Debe paginar notificaciones correctamente."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            # Crear 20 notificaciones
            for i in range(20):
                notif = UserNotification(
                    user_id=user.id,
                    category="ticket",
                    title=f"Notification {i}",
                    body="Body"
                )
                db.session.add(notif)
            db.session.commit()
            
            # Primera página
            response = client.get('/api/account/notifications?page=1&page_size=10', headers=headers)
            assert response.status_code == 200
            data = response.json
            assert len(data['data']) == 10
            assert data['meta']['page'] == 1
            assert data['meta']['total'] == 20
            assert data['meta']['total_pages'] == 2
            
            # Segunda página
            response = client.get('/api/account/notifications?page=2&page_size=10', headers=headers)
            assert response.status_code == 200
            data = response.json
            assert len(data['data']) == 10
            assert data['meta']['page'] == 2
    
    def test_list_notifications_filter_by_category(self, app, client, session_token_factory):
        """Debe filtrar por categoría."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            ticket = UserNotification(
                user_id=user.id, category="ticket", title="Ticket", body="B"
            )
            reminder = UserNotification(
                user_id=user.id, category="reminder", title="Reminder", body="B"
            )
            db.session.add_all([ticket, reminder])
            db.session.commit()
            
            response = client.get('/api/account/notifications?category=ticket', headers=headers)
            
            assert response.status_code == 200
            data = response.json
            assert len(data['data']) == 1
            assert data['data'][0]['category'] == "ticket"
            assert data['meta']['category'] == "ticket"
    
    def test_list_notifications_exclude_read(self, app, client, session_token_factory):
        """Por defecto debe excluir notificaciones leídas."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            unread = UserNotification(
                user_id=user.id, category="ticket", title="Unread", body="B"
            )
            read = UserNotification(
                user_id=user.id,
                category="ticket",
                title="Read",
                body="B",
                read_at=datetime.now(timezone.utc)
            )
            db.session.add_all([unread, read])
            db.session.commit()
            
            response = client.get('/api/account/notifications', headers=headers)
            
            assert response.status_code == 200
            data = response.json
            assert len(data['data']) == 1
            assert data['data'][0]['title'] == "Unread"
            assert data['meta']['include_read'] is False
    
    def test_list_notifications_include_read(self, app, client, session_token_factory):
        """Debe incluir notificaciones leídas si se solicita."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            unread = UserNotification(
                user_id=user.id, category="ticket", title="Unread", body="B"
            )
            read = UserNotification(
                user_id=user.id,
                category="ticket",
                title="Read",
                body="B",
                read_at=datetime.now(timezone.utc)
            )
            db.session.add_all([unread, read])
            db.session.commit()
            
            response = client.get('/api/account/notifications?include_read=true', headers=headers)
            
            assert response.status_code == 200
            data = response.json
            assert len(data['data']) == 2
            assert data['meta']['include_read'] is True
    
    def test_list_notifications_requires_auth(self, client):
        """Debe requerir autenticación."""
        response = client.get('/api/account/notifications')
        assert response.status_code == 401


class TestAccountNotificationRead:
    """Tests para POST /api/account/notifications/<id>/read."""
    
    def test_mark_notification_read(self, app, client, session_token_factory):
        """Debe marcar notificación como leída."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            notif = UserNotification(
                user_id=user.id,
                category="ticket",
                title="Test",
                body="Body"
            )
            db.session.add(notif)
            db.session.commit()
            
            response = client.post(
                f'/api/account/notifications/{notif.id}/read',
                headers=headers
            )
            
            assert response.status_code == 200
            data = response.json
            assert data['message'] == "Notificación marcada como leída."
            assert data['notification']['read_at'] is not None
    
    def test_mark_nonexistent_notification(self, app, client, session_token_factory):
        """Debe retornar 404 con notificación inexistente."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            fake_uuid = "00000000-0000-0000-0000-000000000000"
            response = client.post(
                f'/api/account/notifications/{fake_uuid}/read',
                headers=headers
            )
            
            assert response.status_code == 404
            assert 'error' in response.json
    
    def test_mark_other_user_notification(self, app, client, user_factory, session_token_factory):
        """No debe poder marcar notificación de otro usuario."""
        with app.app_context():
            token, user1 = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            user2 = user_factory(email="user2@example.com")
            
            notif = UserNotification(
                user_id=user2.id,
                category="ticket",
                title="User2 Notification",
                body="Body"
            )
            db.session.add(notif)
            db.session.commit()
            
            response = client.post(
                f'/api/account/notifications/{notif.id}/read',
                headers=headers
            )
            
            assert response.status_code == 404
    
    def test_mark_notification_requires_auth(self, client):
        """Debe requerir autenticación."""
        fake_uuid = "00000000-0000-0000-0000-000000000000"
        response = client.post(f'/api/account/notifications/{fake_uuid}/read')
        assert response.status_code == 401


class TestAccountNotificationsReadAll:
    """Tests para POST /api/account/notifications/read-all."""
    
    def test_read_all_notifications(self, app, client, session_token_factory):
        """Debe marcar todas las notificaciones como leídas."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            for i in range(3):
                db.session.add(UserNotification(
                    user_id=user.id, category="ticket", title=f"N{i}", body="B"
                ))
            db.session.commit()
            
            response = client.post('/api/account/notifications/read-all', headers=headers, json={})
            
            assert response.status_code == 200
            data = response.json
            assert data['message'] == "Notificaciones marcadas como leídas."
            assert data['unread'] == 0
    
    def test_read_all_by_category(self, app, client, session_token_factory):
        """Debe marcar solo las de una categoría."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            ticket = UserNotification(
                user_id=user.id, category="ticket", title="Ticket", body="B"
            )
            reminder = UserNotification(
                user_id=user.id, category="reminder", title="Reminder", body="B"
            )
            db.session.add_all([ticket, reminder])
            db.session.commit()
            
            response = client.post(
                '/api/account/notifications/read-all',
                headers=headers,
                json={"category": "ticket"}
            )
            
            assert response.status_code == 200
            data = response.json
            assert data['unread'] == 1  # Solo la de reminder queda sin leer
    
    def test_read_all_invalid_category(self, app, client, session_token_factory):
        """Debe rechazar categorías inválidas."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            response = client.post(
                '/api/account/notifications/read-all',
                headers=headers,
                json={"category": "invalid_category"}
            )
            
            assert response.status_code == 400
            assert 'error' in response.json
    
    def test_read_all_requires_auth(self, client):
        """Debe requerir autenticación."""
        response = client.post('/api/account/notifications/read-all', json={})
        assert response.status_code == 401


class TestAccountNotificationPreferences:
    """Tests para GET /api/account/notifications/preferences."""
    
    def test_get_default_preferences(self, app, client, session_token_factory):
        """Debe retornar preferencias por defecto."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            response = client.get('/api/account/notifications/preferences', headers=headers)
            
            assert response.status_code == 200
            data = response.json
            assert 'preferences' in data
            assert 'categories' in data
            assert data['preferences']['ticket'] is True
            assert data['preferences']['reminder'] is True
    
    def test_get_custom_preferences(self, app, client, session_token_factory):
        """Debe retornar preferencias personalizadas."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            pref = NotificationPreference(
                user_id=user.id,
                category="ticket",
                enabled=False
            )
            db.session.add(pref)
            db.session.commit()
            
            response = client.get('/api/account/notifications/preferences', headers=headers)
            
            assert response.status_code == 200
            data = response.json
            assert data['preferences']['ticket'] is False
    
    def test_get_preferences_requires_auth(self, client):
        """Debe requerir autenticación."""
        response = client.get('/api/account/notifications/preferences')
        assert response.status_code == 401


class TestAccountNotificationPreferencesUpdate:
    """Tests para PUT /api/account/notifications/preferences."""
    
    def test_update_preferences_basic(self, app, client, session_token_factory):
        """Debe actualizar preferencias correctamente."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            response = client.put(
                '/api/account/notifications/preferences',
                headers=headers,
                json={"ticket": False, "reminder": True}
            )
            
            assert response.status_code == 200
            data = response.json
            assert data['message'] == "Preferencias actualizadas."
            assert data['preferences']['ticket'] is False
            assert data['preferences']['reminder'] is True
    
    def test_update_preferences_invalid_json(self, app, client, session_token_factory):
        """Debe rechazar JSON inválido."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            response = client.put(
                '/api/account/notifications/preferences',
                headers=headers,
                data="invalid json"
            )
            
            assert response.status_code == 400
            assert 'error' in response.json
    
    def test_update_preferences_non_dict(self, app, client, session_token_factory):
        """Debe rechazar si no es un objeto."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            response = client.put(
                '/api/account/notifications/preferences',
                headers=headers,
                json=["not", "a", "dict"]
            )
            
            assert response.status_code == 400
            assert 'error' in response.json
    
    def test_update_preferences_requires_auth(self, client):
        """Debe requerir autenticación."""
        response = client.put(
            '/api/account/notifications/preferences',
            json={"ticket": False}
        )
        assert response.status_code == 401
