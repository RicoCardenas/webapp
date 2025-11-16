"""
Tests para backend/app/routes/sse.py
Server-Sent Events.
"""
import pytest


class TestSSEStream:
    """Tests para endpoint de streaming."""
    
    def test_sse_stream_no_token(self, client):
        """Sin token debe retornar 401."""
        response = client.get('/api/stream')
        assert response.status_code == 401
        data = response.json
        assert 'error' in data
    
    def test_sse_stream_invalid_token(self, app, client):
        """Con token inválido debe retornar 401."""
        with app.app_context():
            client.set_cookie('sse_stream_token', 'invalid_token')
            response = client.get('/api/stream')
            assert response.status_code == 401
