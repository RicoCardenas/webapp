"""Tests para funciones HIBP y envío de emails en auth.py."""

import hashlib
from unittest.mock import patch, MagicMock

import pytest
from flask_mail import Mail

from backend.app.routes.auth import (
    _hibp_fetch_range,
    _password_is_compromised,
    _send_lockout_notification,
    _send_password_reset_email,
)


class TestHIBPPasswordCheck:
    """Tests para verificación de contraseñas comprometidas con HIBP."""

    def test_hibp_fetch_range_success(self, app):
        """Debe obtener sufijos de HIBP correctamente."""
        with app.app_context():
            # Mock de requests.get
            mock_response = MagicMock()
            mock_response.text = "00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2\n011053FD0102E94D6AE2F8B83D76FAF94F6:1\n"
            mock_response.raise_for_status = MagicMock()
            
            with patch('backend.app.services.passwords.requests.get', return_value=mock_response):
                result = _hibp_fetch_range("5BAA6")
                
                assert isinstance(result, dict)
                assert len(result) == 2
                assert result.get("00D4F6E8FA6EECAD2A3AA415EEC418D38EC") == 2
                assert result.get("011053FD0102E94D6AE2F8B83D76FAF94F6") == 1

    def test_hibp_fetch_range_invalid_prefix(self, app):
        """Debe retornar dict vacío con prefijo inválido."""
        with app.app_context():
            result = _hibp_fetch_range("ABC")  # menos de 5 caracteres
            assert result == {}
            
            result = _hibp_fetch_range("ABCDEF")  # más de 5 caracteres
            assert result == {}
            
            result = _hibp_fetch_range("ABC@!")  # caracteres no alfanuméricos
            assert result == {}

    def test_hibp_fetch_range_request_exception(self, app):
        """Debe manejar excepciones de requests y retornar dict vacío."""
        with app.app_context():
            # Limpiar cache para este test
            _hibp_fetch_range.cache_clear()
            with patch('backend.app.services.passwords.requests.get', side_effect=Exception("Network error")):
                result = _hibp_fetch_range("ABCDE")  # Prefijo diferente
                assert result == {}

    def test_hibp_fetch_range_http_error(self, app):
        """Debe manejar errores HTTP y retornar dict vacío."""
        with app.app_context():
            _hibp_fetch_range.cache_clear()
            mock_response = MagicMock()
            mock_response.raise_for_status.side_effect = Exception("404")
            
            with patch('backend.app.services.passwords.requests.get', return_value=mock_response):
                result = _hibp_fetch_range("FGHIJ")  # Prefijo diferente
                assert result == {}

    def test_hibp_fetch_range_malformed_response(self, app):
        """Debe ignorar líneas mal formadas en respuesta."""
        with app.app_context():
            _hibp_fetch_range.cache_clear()
            mock_response = MagicMock()
            mock_response.text = "INVALID_LINE\n00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2\nBAD:COUNT:FORMAT\n"
            mock_response.raise_for_status = MagicMock()
            
            with patch('backend.app.services.passwords.requests.get', return_value=mock_response):
                result = _hibp_fetch_range("KLMNO")  # Prefijo diferente
                
                # Solo debe parsear la línea válida
                assert len(result) == 1
                assert result.get("00D4F6E8FA6EECAD2A3AA415EEC418D38EC") == 2

    def test_password_is_compromised_true(self, app):
        """Debe detectar contraseña comprometida."""
        with app.app_context():
            # "password" tiene SHA1 que empieza con 5BAA6
            mock_response = MagicMock()
            # El resto del SHA1 de "password" es 1E4C9B93F3F0682250B6CF8331B7EE68FD8
            mock_response.text = "1E4C9B93F3F0682250B6CF8331B7EE68FD8:3645804\n"
            mock_response.raise_for_status = MagicMock()
            
            with patch('backend.app.services.passwords.requests.get', return_value=mock_response):
                result = _password_is_compromised("password", minimum_count=1)
                assert result is True

    def test_password_is_compromised_false(self, app):
        """Debe retornar False si contraseña no está comprometida."""
        with app.app_context():
            mock_response = MagicMock()
            mock_response.text = "00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2\n"  # Otro hash
            mock_response.raise_for_status = MagicMock()
            
            with patch('backend.app.services.passwords.requests.get', return_value=mock_response):
                result = _password_is_compromised("MySecureP@ssw0rd123!", minimum_count=1)
                assert result is False

    def test_password_is_compromised_empty_password(self, app):
        """Debe retornar False para contraseña vacía."""
        with app.app_context():
            result = _password_is_compromised("", minimum_count=1)
            assert result is False

    def test_password_is_compromised_below_threshold(self, app):
        """Debe retornar False si el conteo está por debajo del mínimo."""
        with app.app_context():
            _hibp_fetch_range.cache_clear()
            mock_response = MagicMock()
            # Usar un password diferente para evitar cache - "testpass123"
            # SHA1 de "testpass123" es 4F8996F...
            mock_response.text = "8996FB92427AE41E4649B934CA495991B7852BE:5\n"  # Solo 5 ocurrencias
            mock_response.raise_for_status = MagicMock()
            
            with patch('backend.app.services.passwords.requests.get', return_value=mock_response):
                result = _password_is_compromised("testpass123", minimum_count=10)  # Requiere mínimo 10
                assert result is False


class TestAuthEmailFunctions:
    """Tests para funciones de envío de emails en auth."""

    def test_send_lockout_notification_success(self, app, user_factory):
        """Debe enviar email de bloqueo correctamente."""
        with app.app_context():
            user = user_factory(email="locked@test.com")
            user.name = "TestUser"  # Asignar directamente
            unlock_link = "https://ecuplot.com/unlock?token=abc123"
            
            with patch('backend.app.routes.auth.mail') as mock_mail:
                mock_mail.send = MagicMock()
                app.config['MAIL_DEFAULT_SENDER'] = 'noreply@ecuplot.com'
                
                _send_lockout_notification(user, unlock_link)
                
                mock_mail.send.assert_called_once()
                # Verificar que se creó el mensaje
                call_args = mock_mail.send.call_args[0][0]
                assert call_args.subject == "Tu cuenta de EcuPlot fue bloqueada"
                assert "locked@test.com" in call_args.recipients
                assert unlock_link in call_args.body

    def test_send_lockout_notification_no_sender(self, app, user_factory):
        """Debe manejar ausencia de remitente configurado."""
        with app.app_context():
            user = user_factory(email="locked@test.com")
            unlock_link = "https://ecuplot.com/unlock?token=abc123"
            
            # Sin configurar MAIL_DEFAULT_SENDER
            app.config['MAIL_DEFAULT_SENDER'] = None
            
            # No debe lanzar excepción, solo loguear warning
            _send_lockout_notification(user, unlock_link)

    def test_send_lockout_notification_exception(self, app, user_factory):
        """Debe manejar excepciones al enviar email."""
        with app.app_context():
            user = user_factory(email="locked@test.com")
            unlock_link = "https://ecuplot.com/unlock?token=abc123"
            
            with patch('backend.app.routes.auth.mail') as mock_mail:
                mock_mail.send.side_effect = Exception("SMTP error")
                app.config['MAIL_DEFAULT_SENDER'] = 'noreply@ecuplot.com'
                
                # No debe lanzar excepción, solo loguear error
                _send_lockout_notification(user, unlock_link)

    def test_send_password_reset_email_success(self, app, user_factory):
        """Debe enviar email de reset correctamente."""
        with app.app_context():
            user = user_factory(email="reset@test.com")
            user.name = "TestUser"  # Asignar directamente
            reset_link = "https://ecuplot.com/reset?token=xyz789"
            
            with patch('backend.app.routes.auth.mail') as mock_mail:
                mock_mail.send = MagicMock()
                app.config['MAIL_DEFAULT_SENDER'] = 'noreply@ecuplot.com'
                
                _send_password_reset_email(user, reset_link)
                
                mock_mail.send.assert_called_once()
                call_args = mock_mail.send.call_args[0][0]
                assert call_args.subject == "Restablece tu contraseña de EcuPlot"
                assert "reset@test.com" in call_args.recipients
                assert reset_link in call_args.body

    def test_send_password_reset_email_no_sender(self, app, user_factory):
        """Debe manejar ausencia de remitente para reset."""
        with app.app_context():
            user = user_factory(email="reset@test.com")
            reset_link = "https://ecuplot.com/reset?token=xyz789"
            
            app.config['MAIL_DEFAULT_SENDER'] = None
            
            # No debe lanzar excepción
            _send_password_reset_email(user, reset_link)

    def test_send_password_reset_email_exception(self, app, user_factory):
        """Debe manejar excepciones al enviar email de reset."""
        with app.app_context():
            user = user_factory(email="reset@test.com")
            reset_link = "https://ecuplot.com/reset?token=xyz789"
            
            with patch('backend.app.routes.auth.mail') as mock_mail:
                mock_mail.send.side_effect = Exception("SMTP error")
                app.config['MAIL_DEFAULT_SENDER'] = 'noreply@ecuplot.com'
                
                # No debe lanzar excepción
                _send_password_reset_email(user, reset_link)
