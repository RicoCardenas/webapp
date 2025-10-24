def test_require_session_missing_token(client):
    # /api/plot está protegido por require_session
    res = client.post("/api/plot", json={"expression": "f(x)=x"})
    assert res.status_code == 401
    assert "Token de sesión faltante" in res.get_json()["error"]

def test_require_session_invalid_token(client):
    res = client.post("/api/plot", headers={"Authorization": "Bearer invalid"}, json={"expression": "f(x)=x"})
    assert res.status_code == 401
    assert "Sesión inválida" in res.get_json()["error"]
