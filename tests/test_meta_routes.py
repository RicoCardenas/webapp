"""
Tests para backend/app/routes/meta.py
Endpoints de metadatos de la aplicación.
"""
import pytest


class TestMetaEnv:
    """Tests para GET /api/meta/env."""
    
    def test_meta_env_returns_environment(self, client):
        """Debe retornar el entorno de ejecución."""
        response = client.get('/api/meta/env')
        
        assert response.status_code == 200
        data = response.json
        assert 'env' in data
        assert 'demo_mode' in data
        assert isinstance(data['demo_mode'], bool)
    
    def test_meta_env_test_environment(self, app, client):
        """En entorno test debe retornar demo_mode=True."""
        with app.app_context():
            app.config['APP_ENV'] = 'test'
            response = client.get('/api/meta/env')
            
            assert response.status_code == 200
            data = response.json
            assert data['env'] == 'test'
            assert data['demo_mode'] is True
    
    def test_meta_env_production_environment(self, app, client):
        """En entorno production debe retornar demo_mode=False."""
        with app.app_context():
            app.config['APP_ENV'] = 'production'
            response = client.get('/api/meta/env')
            
            assert response.status_code == 200
            data = response.json
            assert data['env'] == 'production'
            assert data['demo_mode'] is False
