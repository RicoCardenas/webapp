from urllib.parse import urlparse, parse_qs

def test_verify_email_flow(client, make_token):
    token_obj, user = make_token(token_type="verify_email", ttl_hours=24)
    # GET /api/verify-email?token=...
    res = client.get(f"/api/verify-email?token={token_obj.token}", follow_redirects=False)
    # Debe redirigir al frontend con ?verified=true
    assert res.status_code in (301, 302)
    location = res.headers["Location"]
    # index.html se sirve desde frontend blueprint; la ruta redirige al index con query
    # Queremos ver 'verified=true' o similar
    assert "verified=true" in location

def test_verify_email_expired(client, make_token, app):
    token_obj, user = make_token(ttl_hours=-1)
    res = client.get(f"/api/verify-email?token={token_obj.token}", follow_redirects=False)
    assert res.status_code in (301, 302)
    assert "token_expired" in res.headers["Location"]

def test_verify_email_invalid(client):
    res = client.get("/api/verify-email?token=does-not-exist", follow_redirects=False)
    assert res.status_code in (301, 302)
    assert "invalid_token" in res.headers["Location"]

def test_verify_email_missing_token(client):
    res = client.get("/api/verify-email", follow_redirects=False)
    assert res.status_code in (301, 302)
    assert "missing_token" in res.headers["Location"]
