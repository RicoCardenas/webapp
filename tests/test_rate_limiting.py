"""
Tests para verificar que el rate limiting funciona correctamente.
"""
import pytest
from backend.app import create_app
from backend.app.extensions import db


@pytest.fixture
def app_with_rate_limits():
    """Fixture que crea una app con rate limits muy bajos para testing."""
    # CRÍTICO: Crear config de test antes de inicializar la app
    class TestRateLimitConfig:
        TESTING = True
        SECRET_KEY = "testing-rate-limit"
        SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
        SQLALCHEMY_TRACK_MODIFICATIONS = False
        WTF_CSRF_ENABLED = False
        RATELIMIT_STORAGE_URI = "memory://"
        RATELIMIT_LOGIN = "3 per minute"
        RATELIMIT_REGISTER = "2 per minute"
        RATELIMIT_PASSWORD_RESET = "2 per minute"
        RATELIMIT_EMAIL_VERIFY = "3 per minute"
        RATELIMIT_CONTACT = "2 per minute"
        RATELIMIT_UNLOCK_ACCOUNT = "2 per minute"
        # Prevenir carga de variables de entorno peligrosas
        APP_ENV = "test"
        ENV = "test"
        MAIL_SUPPRESS_SEND = True
        MAIL_DEFAULT_SENDER = "test@example.com"
    
    # Pasar TestConfig explícitamente para evitar usar Config por defecto
    app = create_app(TestRateLimitConfig)
    
    with app.app_context():
        # Verificación de seguridad: asegurar que usamos SQLite
        db_uri = app.config.get("SQLALCHEMY_DATABASE_URI", "")
        if "postgresql" in db_uri.lower():
            raise RuntimeError(
                f"🔴 test_rate_limiting.py intentando usar PostgreSQL: {db_uri}\n"
                f"   Este test DEBE usar SQLite para proteger producción."
            )
        
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


@pytest.fixture
def client_with_limits(app_with_rate_limits):
    """Cliente de test con rate limits bajos."""
    return app_with_rate_limits.test_client()


class TestLoginRateLimit:
    """Tests para rate limiting en /api/login."""
    
    def test_login_within_limit(self, client_with_limits):
        """Prueba que requests dentro del límite funcionan correctamente."""
        # Primer intento - debe funcionar
        response = client_with_limits.post(
            "/api/login",
            json={"email": "test@example.com", "password": "wrongpass"}
        )
        assert response.status_code in [400, 401, 404]  # Error de auth, no rate limit
        
        # Segundo intento - debe funcionar
        response = client_with_limits.post(
            "/api/login",
            json={"email": "test@example.com", "password": "wrongpass"}
        )
        assert response.status_code in [400, 401, 404]
    
    def test_login_exceeds_limit(self, client_with_limits):
        """Prueba que exceder el límite retorna 429."""
        # Hacer 3 requests (el límite configurado)
        for _ in range(3):
            client_with_limits.post(
                "/api/login",
                json={"email": "test@example.com", "password": "pass"}
            )
        
        # El cuarto debe retornar 429
        response = client_with_limits.post(
            "/api/login",
            json={"email": "test@example.com", "password": "pass"}
        )
        assert response.status_code == 429
    
    def test_login_429_response_format(self, client_with_limits):
        """Prueba que la respuesta 429 tiene el formato correcto."""
        # Exceder el límite
        for _ in range(4):
            response = client_with_limits.post(
                "/api/login",
                json={"email": "test@example.com", "password": "pass"}
            )
        
        # Verificar que retorna 429
        assert response.status_code == 429
        assert response.is_json
        payload = response.get_json()
        assert payload.get("error") == "Too Many Requests"
        assert "message" in (payload.get("details") or {})
        assert response.headers.get("Retry-After") is not None


class TestRegisterRateLimit:
    """Tests para rate limiting en /api/register."""
    
    def test_register_within_limit(self, client_with_limits):
        """Prueba que requests dentro del límite funcionan."""
        response = client_with_limits.post(
            "/api/register",
            json={
                "username": "testuser",
                "email": "test@example.com",
                "password": "ValidPass123!"
            }
        )
        # Puede fallar por validación pero no por rate limit
        assert response.status_code != 429
    
    def test_register_exceeds_limit(self, client_with_limits):
        """Prueba que exceder el límite retorna 429."""
        # Hacer 2 requests (el límite configurado)
        for i in range(2):
            client_with_limits.post(
                "/api/register",
                json={
                    "username": f"user{i}",
                    "email": f"test{i}@example.com",
                    "password": "ValidPass123!"
                }
            )
        
        # El tercero debe retornar 429
        response = client_with_limits.post(
            "/api/register",
            json={
                "username": "user3",
                "email": "test3@example.com",
                "password": "ValidPass123!"
            }
        )
        assert response.status_code == 429


class TestPasswordResetRateLimit:
    """Tests para rate limiting en /api/password/forgot y /api/password/reset."""
    
    def test_password_forgot_within_limit(self, client_with_limits):
        """Prueba que requests dentro del límite funcionan."""
        response = client_with_limits.post(
            "/api/password/forgot",
            json={"email": "test@example.com"}
        )
        assert response.status_code != 429
    
    def test_password_forgot_exceeds_limit(self, client_with_limits):
        """Prueba que exceder el límite retorna 429."""
        # Hacer 2 requests (el límite configurado)
        for _ in range(2):
            client_with_limits.post(
                "/api/password/forgot",
                json={"email": "test@example.com"}
            )
        
        # El tercero debe retornar 429
        response = client_with_limits.post(
            "/api/password/forgot",
            json={"email": "test@example.com"}
        )
        assert response.status_code == 429
    
    def test_password_reset_exceeds_limit(self, client_with_limits):
        """Prueba que exceder el límite en reset retorna 429."""
        # Hacer 2 requests (el límite configurado)
        for _ in range(2):
            client_with_limits.post(
                "/api/password/reset",
                json={"token": "faketoken", "password": "NewPass123!"}
            )
        
        # El tercero debe retornar 429
        response = client_with_limits.post(
            "/api/password/reset",
            json={"token": "faketoken", "password": "NewPass123!"}
        )
        assert response.status_code == 429


class TestEmailVerifyRateLimit:
    """Tests para rate limiting en /api/verify-email."""
    
    def test_verify_email_within_limit(self, client_with_limits):
        """Prueba que requests dentro del límite funcionan."""
        response = client_with_limits.get("/api/verify-email?token=faketoken")
        # Redirige o retorna error, pero no 429
        assert response.status_code != 429
    
    def test_verify_email_exceeds_limit(self, client_with_limits):
        """Prueba que exceder el límite retorna 429."""
        # Hacer 3 requests (el límite configurado)
        for _ in range(3):
            client_with_limits.get("/api/verify-email?token=faketoken")
        
        # El cuarto debe retornar 429
        response = client_with_limits.get("/api/verify-email?token=faketoken")
        assert response.status_code == 429


class TestContactFormRateLimit:
    """Tests para rate limiting en /contact."""
    
    def test_contact_within_limit(self, client_with_limits):
        """Prueba que requests dentro del límite funcionan."""
        response = client_with_limits.post(
            "/contact",
            data={
                "name": "Test User",
                "email": "test@example.com",
                "message": "This is a test message"
            }
        )
        # Puede fallar por validación pero no por rate limit
        assert response.status_code != 429
    
    def test_contact_exceeds_limit(self, client_with_limits):
        """Prueba que exceder el límite retorna 429."""
        # Hacer 2 requests (el límite configurado)
        for _ in range(2):
            client_with_limits.post(
                "/contact",
                data={
                    "name": "Test User",
                    "email": "test@example.com",
                    "message": "This is a test message"
                }
            )
        
        # El tercero debe retornar 429
        response = client_with_limits.post(
            "/contact",
            data={
                "name": "Test User",
                "email": "test@example.com",
                "message": "This is a test message"
            }
        )
        assert response.status_code == 429


class TestUnlockAccountRateLimit:
    """Tests para rate limiting en /api/unlock-account."""
    
    def test_unlock_account_within_limit(self, client_with_limits):
        """Prueba que requests dentro del límite funcionan."""
        response = client_with_limits.get("/api/unlock-account?token=faketoken")
        assert response.status_code != 429
    
    def test_unlock_account_exceeds_limit(self, client_with_limits):
        """Prueba que exceder el límite retorna 429."""
        # Hacer 2 requests (el límite configurado)
        for _ in range(2):
            client_with_limits.get("/api/unlock-account?token=faketoken")
        
        # El tercero debe retornar 429
        response = client_with_limits.get("/api/unlock-account?token=faketoken")
        assert response.status_code == 429
