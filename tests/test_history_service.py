"""
Tests para backend/app/services/history.py
Servicio de historial de gráficas.
"""
import pytest
from datetime import datetime, timezone
from backend.app.services.history import parse_iso_datetime, serialize_history_item
from backend.app.models import PlotHistory
from backend.app.extensions import db


class TestParseIsoDatetime:
    """Tests para parse_iso_datetime."""
    
    def test_parse_none(self):
        """None debe retornar None."""
        result = parse_iso_datetime(None)
        assert result is None
    
    def test_parse_empty_string(self):
        """String vacío debe retornar None."""
        result = parse_iso_datetime("")
        assert result is None
    
    def test_parse_whitespace(self):
        """Solo espacios debe retornar None."""
        result = parse_iso_datetime("   ")
        assert result is None
    
    def test_parse_valid_iso(self):
        """Debe parsear ISO datetime válido."""
        result = parse_iso_datetime("2025-01-15T10:30:00")
        assert result is not None
        assert isinstance(result, datetime)
        assert result.year == 2025
        assert result.month == 1
        assert result.day == 15
    
    def test_parse_with_timezone(self):
        """Debe parsear ISO datetime con timezone."""
        result = parse_iso_datetime("2025-01-15T10:30:00+00:00")
        assert result is not None
        assert result.tzinfo is not None
    
    def test_parse_end_flag_adds_time(self):
        """Con end=True debe agregar tiempo al final del día."""
        result = parse_iso_datetime("2025-01-15", end=True)
        assert result is not None
        # Debe ser cerca del final del día
        assert result.hour == 23
        assert result.minute == 59


class TestSerializeHistoryItem:
    """Tests para serialize_history_item."""
    
    def test_serialize_basic(self, app, user_factory):
        """Debe serializar item de historial correctamente."""
        with app.app_context():
            user = user_factory()

            item = PlotHistory(
                user_id=user.id,
                expression="f(x)=x^2",
                plot_parameters={"data": "test"},
                created_at=datetime(2025, 1, 15, 10, 30, 0, tzinfo=timezone.utc)
            )
