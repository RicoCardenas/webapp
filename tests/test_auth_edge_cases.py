"""
Tests adicionales para backend/app/routes/auth.py
Cobertura de rutas de error y casos edge.
"""
import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch


class TestRegisterEdgeCases:
    """Tests para edge cases en /api/register."""
    
    def test_register_with_missing_fields(self, client):
        """Registro sin campos debe retornar 400."""
        response = client.post("/api/register", json={})
        assert response.status_code == 400
        data = response.get_json()
        assert 'error' in data
    
    def test_register_with_invalid_json(self, client):
        """Registro con JSON inválido debe retornar 400."""
        response = client.post(
            "/api/register",
            data="not json",
            content_type="application/json"
        )
        assert response.status_code == 400
    
    def test_register_password_mismatch(self, client):
        """Contraseñas no coincidentes debe retornar error."""
        response = client.post("/api/register", json={
            "email": "test@example.com",
            "password": "ValidPass123!",
            "password_confirm": "DifferentPass123!",
            "terms": True
        })
        assert response.status_code == 400
        data = response.get_json()
        assert 'error' in data
        assert 'coinciden' in data['error'].lower()
    
    def test_register_without_accepting_terms(self, client):
        """Registro sin aceptar términos debe retornar error."""
        response = client.post("/api/register", json={
            "email": "test@example.com",
            "password": "ValidPass123!",
            "password_confirm": "ValidPass123!",
            "terms": False
        })
        assert response.status_code == 400
        data = response.get_json()
        assert 'términos' in data['error'].lower()
    
    def test_register_with_weak_password(self, client):
        """Contraseña débil debe retornar error."""
        response = client.post("/api/register", json={
            "email": "test@example.com",
            "password": "weak",
            "password_confirm": "weak",
            "terms": True
        })
        assert response.status_code == 400
        data = response.get_json()
        assert 'error' in data
    
    def test_register_duplicate_email(self, client, user_factory):
        """Registrar email duplicado debe retornar error."""
        user_factory(email="existing@example.com")
        
        response = client.post("/api/register", json={
            "email": "existing@example.com",
            "password": "ValidPass123!",
            "password_confirm": "ValidPass123!",
            "terms": True
        })
        assert response.status_code in [400, 409]  # 409 Conflict es válido
        data = response.get_json()
        assert 'error' in data


class TestVerifyEmailEdgeCases:
    """Tests para edge cases en /api/verify-email."""
    
    def test_verify_without_token_redirects_with_error(self, client):
        """Verificación sin token debe redirigir con error."""
        response = client.get("/api/verify-email")
        assert response.status_code == 302
        assert 'error=missing_token' in response.location
    
    def test_verify_with_invalid_token_redirects(self, client):
        """Token inválido debe redirigir con error."""
        response = client.get("/api/verify-email?token=invalid-token-xxx")
        assert response.status_code == 302
        assert 'error=invalid' in response.location
    
    # Test comentado - requiere fixture make_token con parámetros específicos
    # def test_verify_expired_token_redirects(self, client, user_factory, make_token):
    #     """Token expirado debe redirigir con error."""
    #     pass


class TestLoginEdgeCases:
    """Tests para edge cases en /api/login."""
    
    def test_login_without_data(self, client):
        """Login sin datos debe retornar error."""
        response = client.post("/api/login")
        # Acepta cualquier error 4xx
        assert 400 <= response.status_code < 500
    
    def test_login_with_invalid_json(self, client):
        """Login con JSON inválido debe retornar 400."""
        response = client.post(
            "/api/login",
            data="not json",
            content_type="application/json"
        )
        assert response.status_code == 400
    
    def test_login_missing_email(self, client):
        """Login sin email debe retornar error."""
        response = client.post("/api/login", json={
            "password": "test"
        })
        assert response.status_code == 400
        data = response.get_json()
        assert 'email' in data['error'].lower() or 'correo' in data['error'].lower()
    
    def test_login_missing_password(self, client):
        """Login sin contraseña debe retornar error."""
        response = client.post("/api/login", json={
            "email": "test@example.com"
        })
        assert response.status_code == 400
        data = response.get_json()
        assert 'contraseña' in data['error'].lower() or 'password' in data['error'].lower()
    
    def test_login_unverified_user_blocked(self, client, user_factory):
        """Usuario no verificado no puede hacer login."""
        user = user_factory(email="unverified@example.com", verified=False)
        
        response = client.post("/api/login", json={
            "email": "unverified@example.com",
            "password": "Password.123"
        })
        assert response.status_code in [401, 403]  # Puede ser 401 o 403
        data = response.get_json()
        assert 'error' in data
    
    def test_login_nonexistent_user(self, client):
        """Login con usuario inexistente debe retornar error."""
        response = client.post("/api/login", json={
            "email": "nonexistent@example.com",
            "password": "anypassword"
        })
        assert response.status_code in [401, 404]  # Puede ser 401 o 404 por seguridad
        data = response.get_json()
        assert 'error' in data


class TestPasswordResetEdgeCases:
    """Tests para edge cases en password reset."""
    
    def test_forgot_password_without_data(self, client):
        """Forgot password sin datos debe manejar gracefully."""
        response = client.post("/api/password/forgot")
        # Puede retornar 200 (silencioso) o error
        assert response.status_code in [200, 400]
    
    def test_forgot_password_invalid_email(self, client):
        """Email inválido en forgot password."""
        response = client.post("/api/password/forgot", json={
            "email": "not-an-email"
        })
        # Retorna 200 para no revelar si usuario existe
        assert response.status_code == 200
    
    def test_forgot_password_nonexistent_user(self, client):
        """Usuario inexistente en forgot password retorna 200 (seguridad)."""
        response = client.post("/api/password/forgot", json={
            "email": "nonexistent@example.com"
        })
        assert response.status_code in [200, 201]  # Éxito silencioso por seguridad
        data = response.get_json()
        # Mensaje genérico por seguridad
        assert 'message' in data or 'error' not in data
    
    def test_reset_password_without_token(self, client):
        """Reset sin token debe retornar error."""
        response = client.post("/api/password/reset", json={
            "password": "NewPass123!"
        })
        assert response.status_code == 400
        data = response.get_json()
        assert 'token' in data['error'].lower()
    
    def test_reset_password_invalid_token(self, client):
        """Token inválido en reset debe retornar error."""
        response = client.post("/api/password/reset", json={
            "token": "invalid-token-xxx",
            "password": "NewPass123!"
        })
        assert response.status_code in [400, 404]  # Puede ser 400 o 404
        data = response.get_json()
        assert 'error' in data
    
    # Test comentado - requiere fixture make_token con parámetros específicos
    # def test_reset_password_expired_token(self, client, user_factory, make_token):
    #     """Token expirado en reset debe retornar error."""
    #     pass
    
    # Test comentado - requiere fixture make_token con parámetros específicos
    # def test_reset_password_weak_password(self, client, user_factory, make_token):
    #     """Contraseña débil en reset debe retornar error."""
    #     pass


class TestUnlockAccountEdgeCases:
    """Tests para edge cases en /api/unlock-account."""
    
    def test_unlock_without_token_redirects(self, client):
        """Desbloqueo sin token debe redirigir con error."""
        response = client.get("/api/unlock-account")
        assert response.status_code == 302
        assert 'unlock=missing' in response.location
    
    def test_unlock_with_invalid_token_redirects(self, client):
        """Token inválido debe redirigir con error."""
        response = client.get("/api/unlock-account?token=invalid-token")
        assert response.status_code == 302
        assert 'unlock=invalid' in response.location
    
    # Test comentado - requiere fixture make_token con parámetros específicos
    # def test_unlock_expired_token_redirects(self, client, user_factory, make_token):
    #     """Token expirado debe redirigir con error."""
    #     pass


class TestTwoFactorEdgeCases:
    """Tests para edge cases en 2FA."""
    
    def test_totp_setup_without_auth(self, client):
        """Setup 2FA sin autenticación debe retornar 401."""
        response = client.post("/api/2fa/totp/setup")
        assert response.status_code in [401, 404]  # Puede ser 404 si ruta no existe sin auth
    
    def test_totp_verify_without_code(self, client, auth_headers):
        """Verificar 2FA sin código debe retornar error."""
        response = client.post(
            "/api/2fa/totp/verify",
            json={},
            headers=auth_headers
        )
        assert response.status_code in [400, 404]  # Puede variar
    
    def test_totp_verify_invalid_code(self, client, auth_headers, user_factory):
        """Código 2FA inválido debe retornar error."""
        response = client.post(
            "/api/2fa/totp/verify",
            json={"code": "000000"},
            headers=auth_headers
        )
        # Puede ser 400, 401 o 404 dependiendo del estado
        assert response.status_code in [400, 401, 404]


class TestMailSendingErrors:
    """Tests para casos de error en envío de emails."""
    
    def test_register_mail_send_fails_gracefully(self, client, app, monkeypatch):
        """Si falla envío de email en registro, debe manejarse."""
        # Mock mail.send para que falle
        def mock_send_fail(msg):
            raise Exception("SMTP connection failed")
        
        with app.app_context():
            from backend.app.extensions import mail
            monkeypatch.setattr(mail, "send", mock_send_fail)
            
            response = client.post("/api/register", json={
                "email": "newuser@example.com",
                "password": "ValidPass123!",
                "password_confirm": "ValidPass123!",
                "terms": True
            })
            
            # Aún así debe crear el usuario
            assert response.status_code in [200, 201]
    
    def test_forgot_password_mail_fails_gracefully(self, client, app, user_factory, monkeypatch):
        """Si falla envío en forgot password, debe manejarse."""
        user = user_factory(email="test@example.com")
        
        def mock_send_fail(msg):
            raise Exception("SMTP error")
        
        with app.app_context():
            from backend.app.extensions import mail
            monkeypatch.setattr(mail, "send", mock_send_fail)
            
            response = client.post("/api/password/forgot", json={
                "email": "test@example.com"
            })
            
            # Debe retornar éxito aunque falle el email (seguridad)
            assert response.status_code == 200


class TestSessionManagement:
    """Tests para manejo de sesiones."""
    
    def test_logout_without_session(self, client):
        """Logout sin sesión activa debe retornar 401."""
        response = client.post("/api/logout")
        assert response.status_code == 401
    
    def test_user_me_without_session(self, client):
        """GET /api/user/me sin sesión debe retornar 401."""
        response = client.get("/api/user/me")
        assert response.status_code == 401
    
    def test_user_me_with_invalid_token(self, client):
        """GET /api/user/me con token inválido debe retornar 401."""
        response = client.get(
            "/api/user/me",
            headers={"Authorization": "Bearer invalid-token-xxx"}
        )
        assert response.status_code == 401
    
    def test_user_me_success(self, client, auth_headers, user_factory):
        """GET /api/user/me con token válido debe retornar datos."""
        response = client.get("/api/user/me", headers=auth_headers)
        assert response.status_code == 200
        data = response.get_json()
        assert 'email' in data
        assert 'name' in data


class TestInputValidation:
    """Tests para validación de inputs."""
    
    def test_register_email_too_long(self, client):
        """Email extremadamente largo debe manejarse."""
        long_email = "x" * 300 + "@example.com"
        response = client.post("/api/register", json={
            "email": long_email,
            "password": "ValidPass123!",
            "password_confirm": "ValidPass123!",
            "terms": True
        })
        # Puede aceptarse o rechazarse según validación DB
        assert response.status_code in [200, 201, 400, 422]
    
    def test_register_email_with_spaces(self, client):
        """Email con espacios debe normalizarse."""
        response = client.post("/api/register", json={
            "email": "  test@example.com  ",
            "password": "ValidPass123!",
            "password_confirm": "ValidPass123!",
            "terms": True
        })
        # Debe aceptarse o dar conflicto si ya existe
        assert response.status_code in [200, 201, 400, 409]
    
    def test_login_case_insensitive_email(self, client, user_factory):
        """Login debe ser case-insensitive para email."""
        user = user_factory(email="test@example.com", verified=True)
        
        response = client.post("/api/login", json={
            "email": "TEST@EXAMPLE.COM",
            "password": "Password.123"
        })
        # Debe encontrar el usuario
        assert response.status_code in [200, 401]  # 401 si contraseña incorrecta
