from datetime import datetime, timezone

import pytest

from backend.app.event_stream import events as event_bus
from backend.app.models import PlotHistory


@pytest.fixture
def history_entry(app, _db, session_token_factory):
    token, user = session_token_factory()
    with app.app_context():
        entry = PlotHistory(
            user_id=user.id,
            expression="y = x",
            created_at=datetime.now(timezone.utc),
        )
        _db.session.add(entry)
        _db.session.commit()
        entry_id = entry.id
    return token, str(user.id), entry_id


def test_update_history_entry(client, app, _db, history_entry, monkeypatch):
    token, user_id, entry_id = history_entry
    captured = []

    def fake_publish(user_id, *, channel, event_type, data):
        captured.append({
            "user_id": user_id,
            "channel": channel,
            "type": event_type,
            "data": data,
        })

    monkeypatch.setattr(event_bus, "publish", fake_publish)

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    payload = {
        "expression": "y = x + 1",
        "tags": ["algebra", "lineal"],
    }

    res = client.patch(f"/api/plot/history/{entry_id}", headers=headers, json=payload)
    assert res.status_code == 200
    body = res.get_json()
    assert body["item"]["expression"] == "y = x + 1"
    assert set(body["item"].get("tags", ())) == {"algebra", "lineal"}

    assert captured
    last_event = captured[-1]
    assert str(last_event["user_id"]) == user_id
    assert last_event["channel"] == "history"
    assert last_event["type"] == "history:update"
    assert last_event["data"]["items"][0]["id"] == str(entry_id)

    with app.app_context():
        updated = _db.session.get(PlotHistory, entry_id)
        assert updated.expression == "y = x + 1"
        tag_names = {assoc.tag.name for assoc in updated.tags_association}
        assert tag_names == {"algebra", "lineal"}


def test_delete_history_entry(client, app, _db, history_entry, monkeypatch):
    token, _, entry_id = history_entry
    captured = []

    monkeypatch.setattr(event_bus, "publish", lambda *args, **kwargs: captured.append({
        "args": args,
        "kwargs": kwargs,
    }))

    headers = {"Authorization": f"Bearer {token}"}
    res = client.delete(f"/api/plot/history/{entry_id}", headers=headers)
    assert res.status_code == 200
    body = res.get_json()
    assert body["item"]["deleted"] is True

    assert captured
    delete_event = captured[-1]
    assert delete_event["kwargs"]["channel"] == "history"
    assert delete_event["kwargs"]["event_type"] == "history:delete"
    assert delete_event["kwargs"]["data"]["items"][0]["id"] == str(entry_id)

    with app.app_context():
        deleted = _db.session.get(PlotHistory, entry_id)
        assert deleted.deleted_at is not None


def test_update_history_requires_changes(client, history_entry):
    token, _, entry_id = history_entry
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    res = client.patch(f"/api/plot/history/{entry_id}", headers=headers, json={})
    assert res.status_code == 400
    payload = res.get_json()
    assert payload["error"] == "No se recibieron cambios."
