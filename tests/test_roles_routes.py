"""
Tests para backend/app/routes/roles.py
Solicitudes de rol.
"""
import pytest


class TestRoleRequestStatus:
    """Tests para obtener estado de solicitud de rol."""
    
    def test_get_role_request_status_no_request(self, app, client, session_token_factory):
        """Sin solicitud debe retornar request=None."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            response = client.get('/api/role-requests/me', headers=headers)
            
            assert response.status_code == 200
            data = response.json
            assert 'request' in data
            assert data['request'] is None
    
    def test_role_request_requires_auth(self, client):
        """Debe requerir autenticación."""
        response = client.get('/api/role-requests/me')
        assert response.status_code == 401
