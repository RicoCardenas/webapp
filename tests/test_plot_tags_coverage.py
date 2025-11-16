"""Tests de cobertura para plot_tags.py."""

import pytest

from backend.app.plot_tags import (
    _normalize_tag_name,
    _extract_rhs,
    _looks_like_polynomial,
    classify_expression,
    _ensure_tag_objects,
    apply_tags_to_history,
    auto_tag_history,
)
from backend.app.models import PlotHistory, Tags


class TestTagUtilities:
    """Tests para utilidades de tags."""

    def test_normalize_tag_name_none(self):
        """Debe manejar None."""
        assert _normalize_tag_name(None) is None

    def test_normalize_tag_name_empty(self):
        """Debe manejar strings vacíos."""
        assert _normalize_tag_name("") is None
        assert _normalize_tag_name("   ") is None

    def test_extract_rhs_no_equals(self):
        """Debe retornar expresión completa sin '='."""
        assert _extract_rhs("x^2 + 1") == "x^2 + 1"

    def test_looks_like_polynomial_empty(self):
        """Debe retornar False para expresión vacía."""
        assert _looks_like_polynomial("") is False

    def test_classify_expression_empty(self):
        """Debe retornar 'other' para expresión vacía."""
        result = classify_expression("")
        assert "other" in result

    def test_classify_expression_none(self):
        """Debe retornar 'other' para None."""
        result = classify_expression(None)
        assert "other" in result

    def test_classify_expression_rational_frac(self):
        """Debe detectar rational con frac."""
        result = classify_expression("y = frac(x+1)(x-1)")
        assert "rational" in result

    def test_classify_expression_rational_division(self):
        """Debe detectar rational con división."""
        result = classify_expression("y = (x^2 + 1)/(x - 1)")
        assert "rational" in result

    def test_classify_expression_polynomial(self):
        """Debe clasificar polinomios."""
        result = classify_expression("y = x^2 + 2*x + 1")
        assert "polynomial" in result

    def test_classify_expression_multiple_categories(self):
        """Debe detectar múltiples categorías."""
        result = classify_expression("y = sin(x) + x^2")
        assert "trigonometric" in result
        # Puede tener otras categorías también

    def test_classify_expression_parametric(self):
        """Debe detectar ecuaciones paramétricas."""
        result = classify_expression("x(t) = cos(t), y(t) = sin(t)")
        assert "parametric" in result

    def test_classify_expression_piecewise(self):
        """Debe detectar funciones piecewise."""
        result = classify_expression("y = { x^2 if x > 0 else -x }")
        assert "piecewise" in result


class TestTagsWithDatabase:
    """Tests que requieren base de datos."""

    def test_ensure_tag_objects_empty_set(self, app, user_factory, _db):
        """Debe manejar conjunto vacío."""
        with app.app_context():
            user = user_factory()
            result = _ensure_tag_objects(user.id, set(), session=_db.session)
            assert result == []

    def test_ensure_tag_objects_creates_new(self, app, user_factory, _db):
        """Debe crear nuevos tags."""
        with app.app_context():
            user = user_factory()
            result = _ensure_tag_objects(user.id, {"newtag"}, session=_db.session)
            assert len(result) == 1
            assert result[0].name == "newtag"

    def test_ensure_tag_objects_reuses_existing(self, app, user_factory, _db):
        """Debe reutilizar tags existentes."""
        with app.app_context():
            user = user_factory()
            
            # Crear tag existente
            existing = Tags(user_id=user.id, name="existing")
            _db.session.add(existing)
            _db.session.commit()
            
            # Solicitar el mismo tag
            result = _ensure_tag_objects(user.id, {"existing"}, session=_db.session)
            assert len(result) == 1
            assert result[0].id == existing.id

    def test_apply_tags_empty_names(self, app, user_factory, _db):
        """Debe aplicar tag 'other' cuando no hay nombres."""
        with app.app_context():
            user = user_factory()
            history = PlotHistory(
                user_id=user.id,
                expression="y=x^2",
                plot_parameters={}
            )
            _db.session.add(history)
            _db.session.commit()
            
            result = apply_tags_to_history(history, [], session=_db.session)
            # Debe aplicar tag por defecto
            assert len(history.tags_association) > 0

    def test_apply_tags_replace_mode(self, app, user_factory, _db):
        """Debe reemplazar tags existentes cuando replace=True."""
        with app.app_context():
            user = user_factory()
            history = PlotHistory(
                user_id=user.id,
                expression="y=x^2",
                plot_parameters={}
            )
            _db.session.add(history)
            _db.session.commit()
            
            # Aplicar tags iniciales
            apply_tags_to_history(history, ["tag1", "tag2"], session=_db.session, replace=False)
            _db.session.commit()
            
            initial_count = len(history.tags_association)
            assert initial_count == 2
            
            # Reemplazar con nuevos tags
            apply_tags_to_history(history, ["tag3"], session=_db.session, replace=True)
            _db.session.commit()
            
            # Debería tener solo tag3
            assert len(history.tags_association) == 1
            assert history.tags_association[0].tag.name == "tag3"

    def test_auto_tag_history_basic(self, app, user_factory, _db):
        """Debe auto-etiquetar historial."""
        with app.app_context():
            user = user_factory()
            history = PlotHistory(
                user_id=user.id,
                expression="y = sin(x)",
                plot_parameters={}
            )
            _db.session.add(history)
            _db.session.commit()
            
            result = auto_tag_history(history, "y = sin(x)", session=_db.session)
            
            # Debe tener al menos un tag
            assert len(history.tags_association) > 0
            # Debe incluir trigonometric
            tag_names = {assoc.tag.name for assoc in history.tags_association}
            assert "trigonometric" in tag_names

    def test_auto_tag_history_no_expression(self, app, user_factory, _db):
        """Debe usar expresión del historial si no se provee."""
        with app.app_context():
            user = user_factory()
            history = PlotHistory(
                user_id=user.id,
                expression="y = x^2",
                plot_parameters={}
            )
            _db.session.add(history)
            _db.session.commit()
            
            result = auto_tag_history(history, session=_db.session)
            
            # Debe haber aplicado tags
            assert len(history.tags_association) > 0
