"""
Tests para backend/app/services/passwords.py
Validación de contraseñas y verificación contra HIBP.
"""
import pytest
from unittest.mock import Mock
from backend.app.services.passwords import (
    password_strength_error,
    password_is_compromised,
    hibp_fetch_range,
    PASSWORD_POLICY_MESSAGE
)


class TestPasswordStrengthError:
    """Tests para password_strength_error - validación de política de contraseñas."""
    
    def test_none_password_returns_error(self, app):
        """None debe retornar error de política."""
        with app.app_context():
            error = password_strength_error(None)
            assert error == PASSWORD_POLICY_MESSAGE
    
    def test_empty_password_returns_error(self, app):
        """String vacío debe retornar error de política."""
        with app.app_context():
            error = password_strength_error("")
            assert error == PASSWORD_POLICY_MESSAGE
    
    def test_too_short_password_returns_error(self, app):
        """Contraseña < 8 caracteres debe retornar error."""
        with app.app_context():
            error = password_strength_error("Aa1!")
            assert error == PASSWORD_POLICY_MESSAGE
    
    def test_missing_uppercase_returns_error(self, app):
        """Contraseña sin mayúscula debe retornar error."""
        with app.app_context():
            error = password_strength_error("password123!")
            assert error == PASSWORD_POLICY_MESSAGE
    
    def test_missing_lowercase_returns_error(self, app):
        """Contraseña sin minúscula debe retornar error."""
        with app.app_context():
            error = password_strength_error("PASSWORD123!")
            assert error == PASSWORD_POLICY_MESSAGE
    
    def test_missing_digit_returns_error(self, app):
        """Contraseña sin dígito debe retornar error."""
        with app.app_context():
            error = password_strength_error("Password!")
            assert error == PASSWORD_POLICY_MESSAGE
    
    def test_missing_special_char_returns_error(self, app):
        """Contraseña sin carácter especial debe retornar error."""
        with app.app_context():
            error = password_strength_error("Password123")
            assert error == PASSWORD_POLICY_MESSAGE
    
    def test_valid_strong_password_returns_none(self, app):
        """Contraseña fuerte válida debe retornar None."""
        with app.app_context():
            app.config["HIBP_PASSWORD_CHECK_ENABLED"] = False
            error = password_strength_error("ValidPass123!")
            assert error is None
    
    def test_valid_strong_password_with_symbols(self, app):
        """Contraseña válida con varios símbolos especiales."""
        with app.app_context():
            app.config["HIBP_PASSWORD_CHECK_ENABLED"] = False
            error = password_strength_error("MyP@ssw0rd#2025")
            assert error is None
    
    def test_hibp_check_disabled_allows_compromised(self, app, monkeypatch):
        """Con HIBP deshabilitado, contraseña comprometida debe pasar."""
        with app.app_context():
            app.config["HIBP_PASSWORD_CHECK_ENABLED"] = False
            
            # Simular que "Password123!" está comprometida
            monkeypatch.setattr(
                "backend.app.services.passwords.password_is_compromised",
                lambda pwd, threshold: True
            )
            
            error = password_strength_error("Password123!")
            assert error is None
    
    def test_hibp_check_enabled_rejects_compromised(self, app, monkeypatch):
        """Con HIBP habilitado, contraseña comprometida debe fallar."""
        with app.app_context():
            app.config["HIBP_PASSWORD_CHECK_ENABLED"] = True
            app.config["HIBP_PASSWORD_MIN_COUNT"] = 1
            
            # Simular que la contraseña está comprometida
            monkeypatch.setattr(
                "backend.app.services.passwords.password_is_compromised",
                lambda pwd, threshold: True
            )
            
            error = password_strength_error("ValidPass123!")
            assert error is not None
            assert "bases de datos filtradas" in error.lower()
    
    def test_hibp_check_enabled_allows_clean(self, app, monkeypatch):
        """Con HIBP habilitado, contraseña limpia debe pasar."""
        with app.app_context():
            app.config["HIBP_PASSWORD_CHECK_ENABLED"] = True
            app.config["HIBP_PASSWORD_MIN_COUNT"] = 1
            
            # Simular que la contraseña NO está comprometida
            monkeypatch.setattr(
                "backend.app.services.passwords.password_is_compromised",
                lambda pwd, threshold: False
            )
            
            error = password_strength_error("UniqueP@ss2025!")
            assert error is None
    
    def test_hibp_threshold_invalid_defaults_to_1(self, app, monkeypatch):
        """Threshold inválido debe usar default de 1."""
        with app.app_context():
            app.config["HIBP_PASSWORD_CHECK_ENABLED"] = True
            app.config["HIBP_PASSWORD_MIN_COUNT"] = "invalid"
            
            calls = []
            def mock_compromised(pwd, threshold):
                calls.append(threshold)
                return False
            
            monkeypatch.setattr(
                "backend.app.services.passwords.password_is_compromised",
                mock_compromised
            )
            
            password_strength_error("ValidPass123!")
            assert calls == [1]  # Debe usar default 1


class TestPasswordIsCompromised:
    """Tests para password_is_compromised - verificación contra HIBP."""
    
    def test_empty_password_returns_false(self):
        """Password vacío debe retornar False."""
        assert password_is_compromised("", 1) is False
    
    def test_none_password_returns_false(self):
        """Password None debe retornar False."""
        assert password_is_compromised(None, 1) is False
    
    def test_compromised_password_returns_true(self, monkeypatch):
        """Password en HIBP con count >= threshold debe retornar True."""
        # Simular respuesta de hibp_fetch_range
        def mock_fetch(prefix):
            # Simular que encontramos el sufijo con count=100
            if prefix == "5BAA6":
                return {"1E4C9B93F3F0682250B6CF8331B7EE68FD8": 100}
            return {}
        
        monkeypatch.setattr(
            "backend.app.services.passwords.hibp_fetch_range",
            mock_fetch
        )
        
        # "password" -> SHA1: 5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8
        result = password_is_compromised("password", minimum_count=1)
        assert result is True
    
    def test_clean_password_returns_false(self, monkeypatch):
        """Password NO en HIBP debe retornar False."""
        def mock_fetch(prefix):
            # Retornar mapa vacío (no encontrado)
            return {}
        
        monkeypatch.setattr(
            "backend.app.services.passwords.hibp_fetch_range",
            mock_fetch
        )
        
        result = password_is_compromised("SuperUniqueP@ss2025!", minimum_count=1)
        assert result is False
    
    def test_password_below_threshold_returns_false(self, monkeypatch):
        """Password con count < threshold debe retornar False."""
        def mock_fetch(prefix):
            if prefix == "5BAA6":
                return {"1E4C9B93F3F0682250B6CF8331B7EE68FD8": 5}
            return {}
        
        monkeypatch.setattr(
            "backend.app.services.passwords.hibp_fetch_range",
            mock_fetch
        )
        
        # Count=5 pero threshold=10 -> False
        result = password_is_compromised("password", minimum_count=10)
        assert result is False
    
    def test_password_at_threshold_returns_true(self, monkeypatch):
        """Password con count == threshold debe retornar True."""
        def mock_fetch(prefix):
            if prefix == "5BAA6":
                return {"1E4C9B93F3F0682250B6CF8331B7EE68FD8": 10}
            return {}
        
        monkeypatch.setattr(
            "backend.app.services.passwords.hibp_fetch_range",
            mock_fetch
        )
        
        result = password_is_compromised("password", minimum_count=10)
        assert result is True
    
    def test_minimum_count_zero_uses_one(self, monkeypatch):
        """minimum_count <= 0 debe usar 1 como mínimo."""
        def mock_fetch(prefix):
            if prefix == "5BAA6":
                return {"1E4C9B93F3F0682250B6CF8331B7EE68FD8": 1}
            return {}
        
        monkeypatch.setattr(
            "backend.app.services.passwords.hibp_fetch_range",
            mock_fetch
        )
        
        # Con count=1 y threshold=0 (usa 1), debe retornar True
        result = password_is_compromised("password", minimum_count=0)
        assert result is True


class TestHibpFetchRange:
    """Tests para hibp_fetch_range - llamada a API de HIBP."""
    
    @pytest.fixture(autouse=True)
    def clear_cache(self):
        """Limpiar cache antes de cada test."""
        hibp_fetch_range.cache_clear()
        yield
        hibp_fetch_range.cache_clear()
    
    def test_empty_prefix_returns_empty_dict(self):
        """Prefix vacío debe retornar dict vacío."""
        result = hibp_fetch_range("")
        assert result == {}
    
    def test_invalid_prefix_length_returns_empty(self):
        """Prefix con longitud != 5 debe retornar dict vacío."""
        assert hibp_fetch_range("ABC") == {}
        assert hibp_fetch_range("ABCDEF") == {}
    
    def test_non_alphanumeric_prefix_returns_empty(self):
        """Prefix con caracteres no alfanuméricos debe retornar dict vacío."""
        assert hibp_fetch_range("ABC#$") == {}
        assert hibp_fetch_range("AB CD") == {}
    
    def test_successful_api_call_parses_response(self, monkeypatch):
        """Respuesta exitosa de HIBP debe parsear correctamente."""
        mock_response = Mock()
        mock_response.text = (
            "00D4F6E8FA6EECAD2A3AA415EEC418D38EC:3\n"
            "011053FD0102E94D6AE2F8B83D76FAF94F6:1\n"
            "012A7CA357541F0AC487871FEEC1891C49C:2\n"
        )
        mock_response.raise_for_status = Mock()
        
        mock_get = Mock(return_value=mock_response)
        monkeypatch.setattr("backend.app.services.passwords.requests.get", mock_get)
        
        result = hibp_fetch_range("5BAA6")
        
        assert len(result) == 3
        assert result["00D4F6E8FA6EECAD2A3AA415EEC418D38EC"] == 3
        assert result["011053FD0102E94D6AE2F8B83D76FAF94F6"] == 1
        assert result["012A7CA357541F0AC487871FEEC1891C49C"] == 2
        
        # Verificar que se llamó con URL correcta
        mock_get.assert_called_once()
        call_args = mock_get.call_args
        assert "5BAA6" in call_args[0][0]
    
    def test_api_timeout_returns_empty(self, monkeypatch):
        """Timeout de API debe retornar dict vacío."""
        def mock_get(*args, **kwargs):
            import requests
            raise requests.exceptions.Timeout("Connection timeout")
        
        monkeypatch.setattr("backend.app.services.passwords.requests.get", mock_get)
        
        result = hibp_fetch_range("5BAA6")
        assert result == {}
    
    def test_api_http_error_returns_empty(self, monkeypatch):
        """Error HTTP (4xx/5xx) debe retornar dict vacío."""
        mock_response = Mock()
        mock_response.raise_for_status = Mock(
            side_effect=Exception("HTTP 503 Service Unavailable")
        )
        
        mock_get = Mock(return_value=mock_response)
        monkeypatch.setattr("backend.app.services.passwords.requests.get", mock_get)
        
        result = hibp_fetch_range("5BAA6")
        assert result == {}
    
    def test_malformed_response_lines_skipped(self, monkeypatch):
        """Líneas malformadas en respuesta deben ser ignoradas."""
        mock_response = Mock()
        mock_response.text = (
            "00D4F6E8FA6EECAD2A3AA415EEC418D38EC:3\n"
            "INVALID_LINE_NO_COLON\n"
            "SHORT:10\n"  # Sufijo muy corto (< 35 chars)
            "012A7CA357541F0AC487871FEEC1891C49C:notanumber\n"  # Count no numérico
            "\n"  # Línea vacía
            "011053FD0102E94D6AE2F8B83D76FAF94F6:5\n"  # Válido (35 caracteres)
        )
        mock_response.raise_for_status = Mock()
        
        mock_get = Mock(return_value=mock_response)
        monkeypatch.setattr("backend.app.services.passwords.requests.get", mock_get)
        
        result = hibp_fetch_range("5BAA6")
        
        # Solo deben parsearse las líneas válidas
        assert len(result) == 2
        assert result["00D4F6E8FA6EECAD2A3AA415EEC418D38EC"] == 3
        assert result["011053FD0102E94D6AE2F8B83D76FAF94F6"] == 5
    
    def test_prefix_normalized_to_uppercase(self, monkeypatch):
        """Prefix debe normalizarse a uppercase antes de llamar API."""
        mock_response = Mock()
        mock_response.text = "00D4F6E8FA6EECAD2A3AA415EEC418D38EC:1\n"
        mock_response.raise_for_status = Mock()
        
        mock_get = Mock(return_value=mock_response)
        monkeypatch.setattr("backend.app.services.passwords.requests.get", mock_get)
        
        result = hibp_fetch_range("5baa6")  # lowercase
        
        # Debe llamar con uppercase
        call_args = mock_get.call_args
        assert "5BAA6" in call_args[0][0]
        assert len(result) == 1
    
    def test_caching_works_for_same_prefix(self, monkeypatch):
        """Cache LRU debe evitar llamadas repetidas a API."""
        call_count = []
        
        def mock_get(*args, **kwargs):
            call_count.append(1)
            mock_response = Mock()
            mock_response.text = "00D4F6E8FA6EECAD2A3AA415EEC418D38EC:1\n"
            mock_response.raise_for_status = Mock()
            return mock_response
        
        monkeypatch.setattr("backend.app.services.passwords.requests.get", mock_get)
        
        # Limpiar cache antes de test
        hibp_fetch_range.cache_clear()
        
        # Primera llamada - debe hacer request
        result1 = hibp_fetch_range("AAAAA")
        assert len(call_count) == 1
        
        # Segunda llamada con mismo prefix - debe usar cache
        result2 = hibp_fetch_range("AAAAA")
        assert len(call_count) == 1  # No aumentó
        
        assert result1 == result2
    
    def test_network_error_returns_empty(self, monkeypatch):
        """Error de red (ConnectionError, etc) debe retornar dict vacío."""
        def mock_get(*args, **kwargs):
            import requests
            raise requests.exceptions.ConnectionError("Network unreachable")
        
        monkeypatch.setattr("backend.app.services.passwords.requests.get", mock_get)
        
        result = hibp_fetch_range("5BAA6")
        assert result == {}
