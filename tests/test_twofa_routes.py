"""
Tests para backend/app/routes/twofa.py
Autenticación de dos factores.
"""
import pytest


class TestTwoFactorStatus:
    """Tests para estado de 2FA."""
    
    def test_2fa_status_disabled(self, app, client, session_token_factory):
        """Usuario sin 2FA debe retornar enabled=False."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            response = client.get('/api/account/2fa/status', headers=headers)
            
            assert response.status_code == 200
            data = response.json
            assert 'enabled' in data
            assert data['enabled'] is False
            assert 'has_backup_codes' in data
    
    def test_2fa_status_requires_auth(self, client):
        """Debe requerir autenticación."""
        response = client.get('/api/account/2fa/status')
        assert response.status_code == 401
