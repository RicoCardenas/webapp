"""
Tests para backend/app/routes/account.py
Rutas de gestión de cuenta.
"""
import pytest
from backend.app.models import RequestTicket
from backend.app.extensions import db


class TestAccountDashboardPreferences:
    """Tests para preferencias del dashboard."""
    
    def test_get_default_dashboard_preferences(self, app, client, session_token_factory):
        """Debe retornar preferencias por defecto del dashboard."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            response = client.get('/api/account/dashboard/preferences', headers=headers)
            
            assert response.status_code == 200
            data = response.json
            assert 'layout' in data
            assert 'widgets' in data
            assert 'order' in data['layout']
            assert 'hidden' in data['layout']
            assert isinstance(data['layout']['order'], list)
            assert isinstance(data['layout']['hidden'], list)
    
    def test_update_dashboard_preferences(self, app, client, session_token_factory):
        """Debe actualizar preferencias del dashboard."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            new_layout = {
                "order": ["notifications", "history", "stats"],
                "hidden": ["learning"]
            }
            
            response = client.put(
                '/api/account/dashboard/preferences',
                headers=headers,
                json={"layout": new_layout}
            )
            
            assert response.status_code == 200
            data = response.json
            assert data['message'] == "Panel personal guardado."
            assert 'layout' in data
            assert "notifications" in data['layout']['order']
    
    def test_update_dashboard_invalid_json(self, app, client, session_token_factory):
        """Debe rechazar JSON inválido."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            response = client.put(
                '/api/account/dashboard/preferences',
                headers=headers,
                data="invalid json"
            )
            
            assert response.status_code == 400
            assert 'error' in response.json
    
    def test_dashboard_preferences_requires_auth(self, client):
        """Debe requerir autenticación."""
        response = client.get('/api/account/dashboard/preferences')
        assert response.status_code == 401


class TestAccountRequestTickets:
    """Tests para listado de tickets de solicitud."""
    
    def test_list_tickets_empty(self, app, client, session_token_factory):
        """Debe retornar lista vacía si no hay tickets."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            response = client.get('/api/account/requests', headers=headers)
            
            assert response.status_code == 200
            data = response.json
            assert 'data' in data
            assert len(data['data']) == 0
            assert data['meta']['total'] == 0
    
    def test_list_tickets_with_data(self, app, client, session_token_factory):
        """Debe listar tickets del usuario."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            ticket = RequestTicket(
                user_id=user.id,
                type="soporte",
                title="Test Ticket",
                description="Test message",
                status="pendiente"
            )
            db.session.add(ticket)
            db.session.commit()
            
            response = client.get('/api/account/requests', headers=headers)
            
            assert response.status_code == 200
            data = response.json
            assert len(data['data']) == 1
            assert data['data'][0]['title'] == "Test Ticket"
            assert data['meta']['total'] == 1
    
    def test_list_tickets_pagination(self, app, client, session_token_factory):
        """Debe paginar tickets correctamente."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            # Crear 12 tickets
            for i in range(12):
                ticket = RequestTicket(
                    user_id=user.id,
                    type="consulta",
                    title=f"Ticket {i}",
                    description="Message",
                    status="pendiente"
                )
                db.session.add(ticket)
            db.session.commit()
            
            # Primera página (default page_size=5)
            response = client.get('/api/account/requests', headers=headers)
            assert response.status_code == 200
            data = response.json
            assert len(data['data']) == 5
            assert data['meta']['total'] == 12
            assert data['meta']['total_pages'] == 3
            
            # Segunda página
            response = client.get('/api/account/requests?page=2&page_size=5', headers=headers)
            assert response.status_code == 200
            data = response.json
            assert len(data['data']) == 5
    
    def test_list_tickets_filter_by_status(self, app, client, session_token_factory):
        """Debe filtrar por estado."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            pendiente = RequestTicket(
                user_id=user.id,
                type="soporte",
                title="Pendiente",
                description="M",
                status="pendiente"
            )
            atendida = RequestTicket(
                user_id=user.id,
                type="soporte",
                title="Atendida",
                description="M",
                status="atendida"
            )
            db.session.add_all([pendiente, atendida])
            db.session.commit()
            
            response = client.get('/api/account/requests?status=pendiente', headers=headers)
            
            assert response.status_code == 200
            data = response.json
            assert len(data['data']) == 1
            assert data['data'][0]['status'] == "pendiente"
            assert data['meta']['status'] == "pendiente"
    
    def test_list_tickets_requires_auth(self, client):
        """Debe requerir autenticación."""
        response = client.get('/api/account/requests')
        assert response.status_code == 401


class TestNormalizeDashboardLayout:
    """Tests para funciones internas de normalización."""
    
    def test_normalize_empty_layout(self, app):
        """Layout vacío debe retornar default."""
        with app.app_context():
            from backend.app.routes.account import _normalize_dashboard_layout
            
            result = _normalize_dashboard_layout({})
            
            assert 'order' in result
            assert 'hidden' in result
            assert len(result['order']) > 0
    
    def test_normalize_invalid_layout(self, app):
        """Layout inválido debe retornar default."""
        with app.app_context():
            from backend.app.routes.account import _normalize_dashboard_layout
            
            result = _normalize_dashboard_layout("invalid")
            
            assert 'order' in result
            assert 'hidden' in result
    
    def test_normalize_custom_order(self, app):
        """Debe respetar orden personalizado."""
        with app.app_context():
            from backend.app.routes.account import _normalize_dashboard_layout
            
            layout = {
                "order": ["notifications", "history", "stats"],
                "hidden": ["learning"]
            }
            
            result = _normalize_dashboard_layout(layout)
            
            assert result['order'][0] == "notifications"
            assert result['order'][1] == "history"
            assert "learning" in result['hidden']
    
    def test_normalize_removes_invalid_widgets(self, app):
        """Debe ignorar widgets inválidos."""
        with app.app_context():
            from backend.app.routes.account import _normalize_dashboard_layout
            
            layout = {
                "order": ["invalid_widget", "stats"],
                "hidden": ["nonexistent"]
            }
            
            result = _normalize_dashboard_layout(layout)
            
            assert "invalid_widget" not in result['order']
            assert "stats" in result['order']
            assert "nonexistent" not in result['hidden']
    
    def test_normalize_prevents_duplicates_in_order(self, app):
        """No debe permitir duplicados en order."""
        with app.app_context():
            from backend.app.routes.account import _normalize_dashboard_layout
            
            layout = {
                "order": ["stats", "stats", "history", "stats"],
                "hidden": []
            }
            
            result = _normalize_dashboard_layout(layout)
            
            # Solo debe haber una ocurrencia de 'stats'
            assert result['order'].count("stats") == 1
    
    def test_normalize_adds_missing_widgets(self, app):
        """Debe agregar widgets faltantes al final del order."""
        with app.app_context():
            from backend.app.routes.account import _normalize_dashboard_layout
            
            layout = {
                "order": ["stats"],  # Solo uno
                "hidden": []
            }
            
            result = _normalize_dashboard_layout(layout)
            
            # Debe incluir todos los widgets
            from backend.app.routes.account import DASHBOARD_WIDGETS
            for key in DASHBOARD_WIDGETS.keys():
                assert key in result['order']
    
    def test_normalize_filters_hidden_not_in_order(self, app):
        """Hidden items que no están en order deben ser filtrados."""
        with app.app_context():
            from backend.app.routes.account import _normalize_dashboard_layout
            
            layout = {
                "order": ["stats", "history"],
                "hidden": ["notifications", "learning"]  # Uno no está en order
            }
            
            result = _normalize_dashboard_layout(layout)
            
            # Solo 'notifications' y 'learning' deberían estar en hidden si están en order
            # Como estamos añadiendo widgets faltantes, ambos estarán en order
            for item in result['hidden']:
                assert item in result['order']


class TestSerializeTicket:
    """Tests para _serialize_ticket."""
    
    def test_serialize_ticket_basic(self, app, user_factory):
        """Debe serializar ticket correctamente."""
        with app.app_context():
            user = user_factory()
            
            ticket = RequestTicket(
                user_id=user.id,
                type="soporte",
                title="Test",
                description="Desc",
                status="pendiente"
            )
            db.session.add(ticket)
            db.session.commit()
            
            from backend.app.routes.account import _serialize_ticket
            
            result = _serialize_ticket(ticket)
            
            assert result['type'] == "soporte"
            assert result['title'] == "Test"
            assert result['description'] == "Desc"
            assert result['status'] == "pendiente"
            assert 'id' in result
            assert 'created_at' in result
            assert 'updated_at' in result



