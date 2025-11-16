"""
Tests para backend/app/services/validate.py
Validación y normalización de datos de entrada.
"""
import pytest
from backend.app.services.validate import (
    normalize_email,
    validate_contact_submission
)


class TestNormalizeEmail:
    """Tests para normalize_email."""
    
    def test_lowercase_conversion(self):
        """Email debe convertirse a minúsculas."""
        assert normalize_email("USER@EXAMPLE.COM") == "user@example.com"
        assert normalize_email("Test@Domain.Com") == "test@domain.com"
    
    def test_strip_whitespace(self):
        """Espacios al inicio y final deben removerse."""
        assert normalize_email("  user@example.com  ") == "user@example.com"
        assert normalize_email("\tuser@example.com\n") == "user@example.com"
    
    def test_none_returns_empty_string(self):
        """None debe retornar string vacío."""
        assert normalize_email(None) == ""
    
    def test_empty_string_returns_empty(self):
        """String vacío debe retornar string vacío."""
        assert normalize_email("") == ""
    
    def test_whitespace_only_returns_empty(self):
        """Solo espacios debe retornar string vacío."""
        assert normalize_email("   ") == ""
        assert normalize_email("\t\n") == ""
    
    def test_preserves_special_chars(self):
        """Caracteres especiales válidos en email deben preservarse."""
        assert normalize_email("user+tag@example.com") == "user+tag@example.com"
        assert normalize_email("user.name@example.com") == "user.name@example.com"
        assert normalize_email("user_name@example.com") == "user_name@example.com"


class TestValidateContactSubmission:
    """Tests para validate_contact_submission."""
    
    def test_valid_submission_returns_empty_errors(self):
        """Datos válidos deben retornar dict vacío."""
        errors = validate_contact_submission(
            name="John Doe",
            email="john@example.com",
            message="This is a valid message with more than 10 characters."
        )
        assert errors == {}
    
    def test_name_too_short_returns_error(self):
        """Nombre < 2 caracteres debe retornar error."""
        errors = validate_contact_submission(
            name="J",
            email="john@example.com",
            message="Valid message here."
        )
        assert 'name' in errors
        assert 'mínimo 2 caracteres' in errors['name']
    
    def test_empty_name_returns_error(self):
        """Nombre vacío debe retornar error."""
        errors = validate_contact_submission(
            name="",
            email="john@example.com",
            message="Valid message here."
        )
        assert 'name' in errors
    
    def test_missing_at_symbol_returns_error(self):
        """Email sin @ debe retornar error."""
        errors = validate_contact_submission(
            name="John Doe",
            email="notanemail.com",
            message="Valid message here."
        )
        assert 'email' in errors
        assert 'correo válido' in errors['email']
    
    def test_empty_email_returns_error(self):
        """Email vacío debe retornar error."""
        errors = validate_contact_submission(
            name="John Doe",
            email="",
            message="Valid message here."
        )
        assert 'email' in errors
    
    def test_none_email_returns_error(self):
        """Email None debe retornar error."""
        errors = validate_contact_submission(
            name="John Doe",
            email=None,
            message="Valid message here."
        )
        assert 'email' in errors
    
    def test_message_too_short_returns_error(self):
        """Mensaje < 10 caracteres debe retornar error."""
        errors = validate_contact_submission(
            name="John Doe",
            email="john@example.com",
            message="Short"
        )
        assert 'message' in errors
        assert 'al menos 10 caracteres' in errors['message']
    
    def test_empty_message_returns_error(self):
        """Mensaje vacío debe retornar error."""
        errors = validate_contact_submission(
            name="John Doe",
            email="john@example.com",
            message=""
        )
        assert 'message' in errors
    
    def test_multiple_errors_returned_together(self):
        """Múltiples errores deben retornarse juntos."""
        errors = validate_contact_submission(
            name="J",
            email="bademail",
            message="short"
        )
        assert 'name' in errors
        assert 'email' in errors
        assert 'message' in errors
        assert len(errors) == 3
    
    def test_minimum_valid_lengths(self):
        """Valores en límites mínimos deben ser válidos."""
        errors = validate_contact_submission(
            name="Jo",  # Exactamente 2 caracteres
            email="a@b",  # Email mínimo válido
            message="1234567890"  # Exactamente 10 caracteres
        )
        assert errors == {}
    
    def test_name_with_one_character_is_invalid(self):
        """Nombre con 1 carácter debe ser inválido."""
        errors = validate_contact_submission(
            name="X",
            email="valid@example.com",
            message="This is valid message."
        )
        assert 'name' in errors
    
    def test_message_with_nine_characters_is_invalid(self):
        """Mensaje con 9 caracteres debe ser inválido."""
        errors = validate_contact_submission(
            name="Valid Name",
            email="valid@example.com",
            message="123456789"  # 9 caracteres
        )
        assert 'message' in errors
