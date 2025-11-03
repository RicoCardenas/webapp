import pytest

from backend.app.plot_tags import classify_expression


@pytest.mark.parametrize(
    ("expression", "expected"),
    [
        ("f(x)=sin(x)", {"trigonometric"}),
        ("g(x)=cosh(x)", {"hyperbolic"}),
        ("y=ln(x)", {"logarithmic"}),
        ("y=exp(x)", {"exponential"}),
        ("y=2^x", {"exponential"}),
        ("y=sqrt(x)", {"radical"}),
        ("y=(x^2+1)/(x-1)", {"rational"}),
        ("y=x^4 + 3x^2 + 1", {"polynomial"}),
        ("piecewise({x<0:-x;x>=0:x})", {"piecewise"}),
        ("x(t)=cos(t); y(t)=sin(t)", {"parametric", "trigonometric"}),
    ],
)
def test_classify_expression_detects_primary_categories(expression, expected):
    categories = classify_expression(expression)
    for tag in expected:
        assert tag in categories


def test_classify_expression_combined_categories():
    categories = classify_expression("sin(x) + exp(x)")
    assert {"trigonometric", "exponential"}.issubset(categories)


def test_classify_expression_returns_other_when_unknown():
    categories = classify_expression("abs(x)")
    assert "other" in categories
    assert len(categories) == 1


def test_classify_expression_rational_does_not_flag_trig():
    categories = classify_expression("sin(x)/x")
    assert "trigonometric" in categories
    assert "rational" not in categories