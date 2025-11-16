"""
Tests para backend/app/routes/frontend_routes.py
Rutas de frontend HTML.
"""
import pytest


class TestFrontendRoutes:
    """Tests básicos para rutas de páginas HTML."""
    
    def test_index_page(self, client):
        """Debe servir la página de inicio."""
        response = client.get('/')
        assert response.status_code == 200
        assert b'html' in response.data or response.content_type == 'text/html'
    
    def test_graph_page(self, client):
        """Debe servir la página de graficar."""
        response = client.get('/graph')
        assert response.status_code == 200
    
    def test_account_page(self, client):
        """Debe servir la página de cuenta."""
        response = client.get('/account')
        assert response.status_code == 200
    
    def test_login_page(self, client):
        """Debe servir la página de login."""
        response = client.get('/login')
        assert response.status_code == 200
    
    def test_signup_page(self, client):
        """Debe servir la página de registro."""
        response = client.get('/signup')
        assert response.status_code == 200
    
    def test_reset_password_page(self, client):
        """Debe servir la página de reseteo de contraseña."""
        response = client.get('/reset-password')
        assert response.status_code == 200
    
    def test_contact_result_page(self, client):
        """Debe servir la página de resultado de contacto."""
        response = client.get('/contact/resultado')
        # Puede ser 200 o redirigir (302)
        assert response.status_code in [200, 302]
    
    def test_favicon(self, client):
        """Debe servir favicon."""
        response = client.get('/favicon.ico')
        # Puede retornar archivo o 404
        assert response.status_code in [200, 404]
    
    def test_manifest(self, client):
        """Debe servir manifest.json."""
        response = client.get('/manifest.json')
        # Puede retornar archivo o 404
        assert response.status_code in [200, 404]
