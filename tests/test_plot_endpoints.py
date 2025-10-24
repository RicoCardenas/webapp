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

def test_plot_multiple_expressions(client, auth_headers):
    body = {"expressions": ["f(x)=x^2", "g(x)=cos(x)"], "plot_parameters": {"grid": True}}
    res = client.post("/api/plot", headers=auth_headers, json=body)
    assert res.status_code == 201
    data = res.get_json()
    assert data["saved"] == 2
