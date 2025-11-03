from sqlalchemy import select

from backend.app.models import PlotHistory


def test_plot_requires_auth(client):
    res = client.post("/api/plot", json={"expression": "y=x"})
    assert res.status_code == 401
    assert "Token de sesión" in res.get_json()["error"]

def test_plot_requires_expression(client, auth_headers):
    res = client.post("/api/plot", headers=auth_headers, json={})
    assert res.status_code == 400

def test_plot_single_expression(client, auth_headers):
    res = client.post("/api/plot", headers=auth_headers, json={"expression": "f(x)=sin(x)"})
    assert res.status_code == 201
    data = res.get_json()
    assert data["saved"] == 1
    assert len(data["items"]) == 1
    assert "expression" in data["items"][0]
    assert "tags" in data["items"][0]

def test_plot_multiple_expressions(client, auth_headers):
    body = {"expressions": ["f(x)=x^2", "g(x)=cos(x)"], "plot_parameters": {"grid": True}}
    res = client.post("/api/plot", headers=auth_headers, json=body)
    assert res.status_code == 201
    data = res.get_json()
    assert data["saved"] == 2


def test_plot_auto_tags(client, auth_headers, app, _db):
    expr = "f(x)=sin(x)+exp(x)"
    res = client.post("/api/plot", headers=auth_headers, json={"expression": expr})
    assert res.status_code == 201
    payload = res.get_json()
    assert payload["items"]
    tags = payload["items"][0]["tags"]
    assert "trigonometric" in tags
    assert "exponential" in tags

    with app.app_context():
        history = _db.session.scalars(select(PlotHistory).order_by(PlotHistory.created_at.desc())).first()
        assert history is not None
        saved = sorted(
            {
                (assoc.tag.name or "").lower()
                for assoc in (history.tags_association or [])
                if assoc.tag and assoc.tag.name
            }
        )
        assert "trigonometric" in saved
        assert "exponential" in saved
