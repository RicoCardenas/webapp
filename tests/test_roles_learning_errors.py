"""Tests adicionales de cobertura para roles y learning."""

from unittest.mock import patch, MagicMock

import pytest
from sqlalchemy.exc import IntegrityError

from backend.app.models import RoleRequest, LearningProgress


class TestRolesNotifications:
    """Tests para notificaciones de solicitudes de roles."""

    def test_create_role_request_sends_notification(self, app, client, session_token_factory, _db):
        """Debe enviar notificación al crear solicitud de rol."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            # Configurar destinatario
            app.config['ROLE_REQUEST_RECIPIENTS'] = 'admin@ecuplot.com'
            app.config['MAIL_DEFAULT_SENDER'] = 'noreply@ecuplot.com'
            
            with patch('backend.app.routes.roles.mail') as mock_mail:
                mock_mail.send = MagicMock()
                
                response = client.post(
                    "/api/role-requests",
                    json={"role": "admin", "notes": "Necesito permisos"},
                    headers=headers
                )
                
                assert response.status_code == 201
                # Verificar que se intentó enviar email
                mock_mail.send.assert_called_once()

    def test_create_role_request_no_recipients_configured(self, app, client, session_token_factory, _db):
        """Debe manejar ausencia de destinatarios configurados."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            # Sin configurar destinatarios
            app.config['ROLE_REQUEST_RECIPIENTS'] = None
            app.config['CONTACT_RECIPIENTS'] = None
            
            response = client.post(
                "/api/role-requests",
                json={"role": "admin", "notes": "Test"},
                headers=headers
            )
            
            # Debe funcionar aunque no envíe notificación
            assert response.status_code == 201

    def test_create_role_request_no_sender_configured(self, app, client, session_token_factory, _db):
        """Debe manejar ausencia de remitente configurado."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            # Con destinatarios pero sin remitente
            app.config['ROLE_REQUEST_RECIPIENTS'] = 'admin@ecuplot.com'
            app.config['MAIL_DEFAULT_SENDER'] = None
            
            response = client.post(
                "/api/role-requests",
                json={"role": "admin"},
                headers=headers
            )
            
            # Debe funcionar aunque no envíe notificación
            assert response.status_code == 201

    def test_create_role_request_email_exception(self, app, client, session_token_factory, _db):
        """Debe manejar excepciones al enviar email."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            app.config['ROLE_REQUEST_RECIPIENTS'] = 'admin@ecuplot.com'
            app.config['MAIL_DEFAULT_SENDER'] = 'noreply@ecuplot.com'
            
            with patch('backend.app.routes.roles.mail') as mock_mail:
                mock_mail.send.side_effect = Exception("SMTP error")
                
                response = client.post(
                    "/api/role-requests",
                    json={"role": "admin"},
                    headers=headers
                )
                
                # Debe funcionar aunque falle el email
                assert response.status_code == 201

    def test_create_role_request_database_error(self, app, client, session_token_factory, _db):
        """Debe manejar errores de base de datos."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            with patch('backend.app.extensions.db.session.commit', side_effect=Exception("DB error")):
                response = client.post(
                    "/api/role-requests",
                    json={"role": "admin"},
                    headers=headers
                )
                
                assert response.status_code == 500
                assert "error" in response.json


class TestRoleRequestStringRecipients:
    """Test para roles con recipients como string."""
    
    def test_create_role_request_string_recipients(self, app, client, session_token_factory, _db):
        """Debe manejar ROLE_REQUEST_RECIPIENTS como string."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            # Configurar como string en lugar de lista
            app.config['ROLE_REQUEST_RECIPIENTS'] = 'single@email.com'
            app.config['MAIL_DEFAULT_SENDER'] = 'noreply@ecuplot.com'
            
            with patch('backend.app.routes.roles.mail') as mock_mail:
                mock_mail.send = MagicMock()
                
                response = client.post(
                    "/api/role-requests",
                    json={"role": "admin"},
                    headers=headers
                )
                
                assert response.status_code == 201
                mock_mail.send.assert_called_once()
