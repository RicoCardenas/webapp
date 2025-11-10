import pytest

from backend.app.event_stream import EventBroker, events as event_bus

def test_stream_token_flow(client, session_token_factory):
    session_token, _ = session_token_factory()

    unauthorized = client.get("/api/stream")
    assert unauthorized.status_code == 401

    query_with_session = client.get(f"/api/stream?token={session_token}")
    assert query_with_session.status_code == 401

    legacy_stream = client.get("/api/stream?stream_token=deprecated")
    assert legacy_stream.status_code == 401

    issued = client.post(
        "/api/stream/token",
        headers={"Authorization": f"Bearer {session_token}"},
    )
    assert issued.status_code == 201
    payload = issued.get_json()
    assert "expires_at" in payload
    assert payload.get("token") is None
    set_cookie = issued.headers.get("Set-Cookie", "")
    assert "sse_stream_token=" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "Path=/api/stream" in set_cookie

    stream_response = client.get("/api/stream")
    assert stream_response.status_code == 200
    assert stream_response.mimetype == "text/event-stream"

    first_chunk = next(stream_response.response)
    assert first_chunk.startswith(b"event: ready")

    stream_response.close()


def test_event_broker_replaces_oldest_subscription():
    broker = EventBroker(max_queue_size=1, max_subscribers_per_user=2)
    first = broker.subscribe("user")
    second = broker.subscribe("user")
    third = broker.subscribe("user")

    assert first is not None
    assert second is not None
    assert third is not None

    # Primer suscriptor debe recibir evento de desconexión
    sentinel = first.get(timeout=0.5)
    assert isinstance(sentinel, dict)
    assert sentinel.get("type") == "disconnect"

    broker.unsubscribe("user", first)
    broker.unsubscribe("user", second)
    broker.unsubscribe("user", third)


def test_stream_route_returns_429_on_limit(client, session_token_factory, monkeypatch):
    session_token, _ = session_token_factory()

    issued = client.post(
        "/api/stream/token",
        headers={"Authorization": f"Bearer {session_token}"},
    )
    assert issued.status_code == 201

    def fake_subscribe(user_id):
        raise RuntimeError("limit reached")

    monkeypatch.setattr(event_bus, "subscribe", fake_subscribe)

    response = client.get("/api/stream")
    assert response.status_code == 429
    data = response.get_json()
    assert "error" in data
