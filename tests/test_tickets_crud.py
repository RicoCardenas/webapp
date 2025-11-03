import pytest


def test_ticket_creation_and_listing(client, app, user_factory, session_token_factory):
    user = user_factory()
    token, _ = session_token_factory(user=user)
    headers = {"Authorization": f"Bearer {token}"}

    payload = {
        "type": "soporte",
        "title": "Problema con la cuenta",
        "description": "Tengo inconvenientes para acceder a algunas funciones avanzadas del panel.",
    }

    res = client.post("/api/account/requests", json=payload, headers=headers)
    assert res.status_code == 201
    data = res.get_json()
    assert data["ticket"]["status"] == "pendiente"

    list_res = client.get("/api/account/requests?page=1&page_size=5", headers=headers)
    assert list_res.status_code == 200
    listing = list_res.get_json()
    assert listing["meta"]["page"] == 1
    assert listing["meta"]["page_size"] == 5
    assert listing["meta"]["total"] >= 1
    assert any(item["title"] == payload["title"] for item in listing["data"])


def test_ticket_validation_errors(client, user_factory, session_token_factory):
    user = user_factory()
    token, _ = session_token_factory(user=user)
    headers = {"Authorization": f"Bearer {token}"}

    bad_payload = {"type": "", "title": "Hi", "description": "Corto"}
    res = client.post("/api/account/requests", json=bad_payload, headers=headers)
    assert res.status_code == 400
    data = res.get_json()
    assert "fields" in data
    assert set(data["fields"]) >= {"type", "title", "description"}


def test_ticket_requires_auth(client):
    res = client.post(
        "/api/account/requests",
        json={"type": "soporte", "title": "Test", "description": "Detalle suficiente."},
    )
    assert res.status_code in {401, 403}
