"""
Tests para backend/app/services/mail.py
Servicio de envío de correo electrónico.
"""
import pytest
from unittest.mock import Mock, patch
from flask_mail import Message
from backend.app.services.mail import (
    resolve_mail_sender,
    send_contact_notification,
    MAIL_SENDER_MISSING_ERROR
)


class TestResolveMailSender:
    """Tests para resolve_mail_sender."""
    
    def test_returns_mail_default_sender_if_set(self, app):
        """Debe retornar MAIL_DEFAULT_SENDER si está configurado."""
        with app.app_context():
            app.config['MAIL_DEFAULT_SENDER'] = 'noreply@example.com'
            app.config['MAIL_USERNAME'] = 'fallback@example.com'
            
            result = resolve_mail_sender()
            assert result == 'noreply@example.com'
    
    def test_strips_whitespace_from_sender(self, app):
        """Debe remover espacios del sender."""
        with app.app_context():
            app.config['MAIL_DEFAULT_SENDER'] = '  noreply@example.com  '
            
            result = resolve_mail_sender()
            assert result == 'noreply@example.com'
    
    def test_returns_tuple_sender_if_valid(self, app):
        """Debe retornar tupla (email, nombre) si está configurada."""
        with app.app_context():
            app.config['MAIL_DEFAULT_SENDER'] = ('noreply@example.com', 'EcuPlot App')
            
            result = resolve_mail_sender()
            assert result == ('noreply@example.com', 'EcuPlot App')
    
    def test_cleans_tuple_sender_parts(self, app):
        """Debe limpiar espacios en cada parte de la tupla."""
        with app.app_context():
            app.config['MAIL_DEFAULT_SENDER'] = ('  noreply@example.com  ', '  EcuPlot  ')
            
            result = resolve_mail_sender()
            assert result == ('noreply@example.com', 'EcuPlot')
    
    def test_handles_list_sender(self, app):
        """Debe manejar lista como tupla."""
        with app.app_context():
            app.config['MAIL_DEFAULT_SENDER'] = ['noreply@example.com', 'EcuPlot App']
            
            result = resolve_mail_sender()
            assert result == ('noreply@example.com', 'EcuPlot App')
    
    def test_filters_empty_parts_from_tuple(self, app):
        """Debe filtrar partes vacías de tupla."""
        with app.app_context():
            app.config['MAIL_DEFAULT_SENDER'] = ('noreply@example.com', '   ')
            
            result = resolve_mail_sender()
            # Solo la parte no vacía debe quedar
            assert result == ('noreply@example.com',)
    
    def test_returns_none_if_tuple_all_empty(self, app):
        """Debe retornar None si tupla tiene solo elementos vacíos."""
        with app.app_context():
            app.config['MAIL_DEFAULT_SENDER'] = ('', '  ')
            app.config['MAIL_USERNAME'] = None
            
            result = resolve_mail_sender()
            assert result is None
    
    def test_falls_back_to_mail_username(self, app):
        """Debe usar MAIL_USERNAME si MAIL_DEFAULT_SENDER no está."""
        with app.app_context():
            app.config['MAIL_DEFAULT_SENDER'] = None
            app.config['MAIL_USERNAME'] = 'username@example.com'
            
            result = resolve_mail_sender()
            assert result == 'username@example.com'
    
    def test_falls_back_if_sender_empty_string(self, app):
        """Debe usar fallback si MAIL_DEFAULT_SENDER es string vacío."""
        with app.app_context():
            app.config['MAIL_DEFAULT_SENDER'] = '   '
            app.config['MAIL_USERNAME'] = 'username@example.com'
            
            result = resolve_mail_sender()
            assert result == 'username@example.com'
    
    def test_strips_whitespace_from_fallback(self, app):
        """Debe limpiar espacios del fallback MAIL_USERNAME."""
        with app.app_context():
            app.config['MAIL_DEFAULT_SENDER'] = None
            app.config['MAIL_USERNAME'] = '  username@example.com  '
            
            result = resolve_mail_sender()
            assert result == 'username@example.com'
    
    def test_returns_none_if_no_sender_configured(self, app):
        """Debe retornar None si no hay remitente configurado."""
        with app.app_context():
            app.config['MAIL_DEFAULT_SENDER'] = None
            app.config['MAIL_USERNAME'] = None
            
            result = resolve_mail_sender()
            assert result is None
    
    def test_returns_none_if_both_empty_strings(self, app):
        """Debe retornar None si ambos son strings vacíos."""
        with app.app_context():
            app.config['MAIL_DEFAULT_SENDER'] = '   '
            app.config['MAIL_USERNAME'] = '   '
            
            result = resolve_mail_sender()
            assert result is None


class TestSendContactNotification:
    """Tests para send_contact_notification."""
    
    def test_returns_none_if_no_recipient_configured(self, app):
        """Debe retornar None si no hay CONTACT_RECIPIENT configurado."""
        with app.app_context():
            app.config['CONTACT_RECIPIENT'] = None
            
            mock_mail = Mock()
            result = send_contact_notification(
                name="Test User",
                email="test@example.com",
                message="Test message",
                mail=mock_mail
            )
            
            assert result is None
            mock_mail.send.assert_not_called()
    
    def test_logs_info_when_no_recipient(self, app):
        """Debe loggear info cuando no hay destinatario."""
        with app.app_context():
            app.config['CONTACT_RECIPIENT'] = None
            
            with patch.object(app.logger, 'info') as mock_log:
                mock_mail = Mock()
                send_contact_notification(
                    name="Test User",
                    email="test@example.com",
                    message="Test message",
                    mail=mock_mail
                )
                
                mock_log.assert_called_once()
                assert 'Test User' in str(mock_log.call_args)
    
    def test_returns_error_if_no_sender_configured(self, app):
        """Debe retornar error si no hay remitente configurado."""
        with app.app_context():
            app.config['CONTACT_RECIPIENT'] = 'admin@example.com'
            app.config['MAIL_DEFAULT_SENDER'] = None
            app.config['MAIL_USERNAME'] = None
            
            mock_mail = Mock()
            result = send_contact_notification(
                name="Test User",
                email="test@example.com",
                message="Test message",
                mail=mock_mail
            )
            
            assert result == MAIL_SENDER_MISSING_ERROR
            mock_mail.send.assert_not_called()
    
    def test_sends_email_successfully(self, app):
        """Debe enviar email exitosamente con configuración válida."""
        with app.app_context():
            app.config['CONTACT_RECIPIENT'] = 'admin@example.com'
            app.config['MAIL_DEFAULT_SENDER'] = 'noreply@example.com'
            
            mock_mail = Mock()
            result = send_contact_notification(
                name="Test User",
                email="test@example.com",
                message="This is a test message",
                mail=mock_mail
            )
            
            assert result is None
            mock_mail.send.assert_called_once()
            
            # Verificar que se creó Message con datos correctos
            sent_message = mock_mail.send.call_args[0][0]
            assert isinstance(sent_message, Message)
            assert sent_message.subject == 'Nuevo contacto de EcuPlot'
            assert sent_message.sender == 'noreply@example.com'
            assert sent_message.recipients == ['admin@example.com']
            assert 'Test User' in sent_message.body
            assert 'test@example.com' in sent_message.body
            assert 'This is a test message' in sent_message.body
    
    def test_handles_mail_send_exception(self, app):
        """Debe manejar excepciones al enviar email."""
        with app.app_context():
            app.config['CONTACT_RECIPIENT'] = 'admin@example.com'
            app.config['MAIL_DEFAULT_SENDER'] = 'noreply@example.com'
            
            mock_mail = Mock()
            mock_mail.send.side_effect = Exception("SMTP connection failed")
            
            result = send_contact_notification(
                name="Test User",
                email="test@example.com",
                message="Test message",
                mail=mock_mail
            )
            
            assert result is not None
            assert 'No se pudo enviar el mensaje' in result
    
    def test_logs_error_on_mail_failure(self, app):
        """Debe loggear error cuando falla el envío."""
        with app.app_context():
            app.config['CONTACT_RECIPIENT'] = 'admin@example.com'
            app.config['MAIL_DEFAULT_SENDER'] = 'noreply@example.com'
            
            mock_mail = Mock()
            mock_mail.send.side_effect = Exception("SMTP error")
            
            with patch.object(app.logger, 'error') as mock_log:
                send_contact_notification(
                    name="Test User",
                    email="test@example.com",
                    message="Test message",
                    mail=mock_mail
                )
                
                mock_log.assert_called_once()
                assert 'SMTP error' in str(mock_log.call_args)
    
    def test_formats_message_body_correctly(self, app):
        """Debe formatear el cuerpo del mensaje correctamente."""
        with app.app_context():
            app.config['CONTACT_RECIPIENT'] = 'admin@example.com'
            app.config['MAIL_DEFAULT_SENDER'] = 'noreply@example.com'
            
            mock_mail = Mock()
            send_contact_notification(
                name="John Doe",
                email="john@example.com",
                message="I need help with my account",
                mail=mock_mail
            )
            
            sent_message = mock_mail.send.call_args[0][0]
            body = sent_message.body
            
            # Verificar formato
            assert body.startswith("Nombre: John Doe")
            assert "Email: john@example.com" in body
            assert "I need help with my account" in body
    
    def test_uses_tuple_sender_if_configured(self, app):
        """Debe usar sender como tupla si está configurado así."""
        with app.app_context():
            app.config['CONTACT_RECIPIENT'] = 'admin@example.com'
            app.config['MAIL_DEFAULT_SENDER'] = ('noreply@example.com', 'EcuPlot')
            
            mock_mail = Mock()
            send_contact_notification(
                name="Test User",
                email="test@example.com",
                message="Test message",
                mail=mock_mail
            )
            
            sent_message = mock_mail.send.call_args[0][0]
            # Flask-Mail convierte tupla a formato "email <name>"
            assert 'noreply@example.com' in sent_message.sender
            assert 'EcuPlot' in sent_message.sender
