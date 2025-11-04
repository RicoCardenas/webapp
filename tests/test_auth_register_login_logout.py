import re

def test_register_requires_json(client):
    res = client.post("/api/register")
    assert res.status_code == 400
    assert "No se proporcionaron" in res.get_json()["error"]

def test_register_requires_terms(client):
    payload = {
        "email": "a@test.com",
        "password": "Str0ng!Pass1",
        "password_confirm": "Str0ng!Pass1",
    }
    res = client.post("/api/register", json=payload)
    assert res.status_code == 400
    assert "términos" in res.get_json()["error"]

def test_register_happy_path(client, mail_outbox):
    payload = {
        "email": "a@test.com",
        "password": "Str0ng!Pass1",
        "password_confirm": "Str0ng!Pass1",
        "terms": True,
    }
    res = client.post("/api/register", json=payload)
    assert res.status_code == 201
    msg = res.get_json()["message"]
    assert "Registro exitoso" in msg

    # Se envía un correo (capturado por mail_outbox)
    assert len(mail_outbox) == 1
    m = mail_outbox[0]
    assert "Verifica tu correo" in m.subject
    # link debe parecer una URL con ?token=
    assert re.search(r"/api/verify-email\?token=[A-Za-z0-9_\-]+", m.body)

def test_register_conflict(client):
    payload = {
        "email": "dup@test.com",
        "password": "Str0ng!Pass1",
        "password_confirm": "Str0ng!Pass1",
        "terms": True,
    }
    res1 = client.post("/api/register", json=payload)
    assert res1.status_code == 201
    res2 = client.post("/api/register", json=payload)
    assert res2.status_code == 409


def test_register_fails_when_mail_sender_missing(client, mail_outbox):
    app = client.application
    original_sender = app.config.get("MAIL_DEFAULT_SENDER")
    original_username = app.config.get("MAIL_USERNAME")
    app.config["MAIL_DEFAULT_SENDER"] = ""
    app.config["MAIL_USERNAME"] = ""

    try:
        payload = {
            "email": "missing@test.com",
            "password": "Str0ng!Pass1",
            "password_confirm": "Str0ng!Pass1",
            "terms": True,
        }
        res = client.post("/api/register", json=payload)
        assert res.status_code == 503
        body = res.get_json() or {}
        assert "correo" in body.get("error", "").lower()
        assert len(mail_outbox) == 0
    finally:
        app.config["MAIL_DEFAULT_SENDER"] = original_sender
        app.config["MAIL_USERNAME"] = original_username

def test_login_requires_verification(client, user_factory):
    u = user_factory(email="nv@test.com", verified=False)
    res = client.post("/api/login", json={"email": u.email, "password": "Password.123"})
    assert res.status_code == 403
    assert "no ha sido verificada" in res.get_json()["error"]

def test_login_wrong_credentials(client, user_factory):
    u = user_factory(email="ok@test.com", verified=True)
    res = client.post("/api/login", json={"email": u.email, "password": "wrong"})
    assert res.status_code == 401

def test_login_success_and_logout(client, user_factory):
    u = user_factory(email="ok2@test.com", verified=True)
    # login
    res = client.post("/api/login", json={"email": u.email, "password": "Password.123"})
    assert res.status_code == 200
    data = res.get_json()
    assert "session_token" in data
    token = data["session_token"]
    set_cookie = res.headers.get("Set-Cookie", "")
    assert "session_token=" in set_cookie
    assert "HttpOnly" in set_cookie

    # logout usando la cookie enviada por el servidor
    res2 = client.post("/api/logout")
    assert res2.status_code == 200
    assert "Sesión cerrada" in res2.get_json()["message"]
    cleared_cookie = res2.headers.get("Set-Cookie", "")
    assert "session_token=" in cleared_cookie
    assert "Max-Age=0" in cleared_cookie or "expires=" in cleared_cookie.lower()

    # volver a usar el token debe fallar
    res3 = client.post("/api/logout", headers={"Authorization": f"Bearer {token}"})
    assert res3.status_code == 401

    # la cookie ya no debe autenticar
    res4 = client.get("/api/user/me")
    assert res4.status_code == 401


def test_locked_account_login_flow(client, user_factory, mail_outbox):
    u = user_factory(email="locked@test.com", verified=True)

    first = client.post("/api/login", json={"email": u.email, "password": "wrong"})
    second = client.post("/api/login", json={"email": u.email, "password": "wrong"})
    third = client.post("/api/login", json={"email": u.email, "password": "wrong"})

    assert first.status_code == 401
    assert second.status_code == 401
    assert third.status_code == 423

    locked_attempt = client.post("/api/login", json={"email": u.email, "password": "Password.123"})
    assert locked_attempt.status_code == 423

    payload = locked_attempt.get_json()
    assert payload
    assert "bloqueada" in payload.get("error", "").lower()

    # Debe enviar al menos un correo con el enlace de desbloqueo
    assert len(mail_outbox) >= 1
