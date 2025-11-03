from tests.test_history_pagination import _seed_history_records


def test_history_export_json(client, session_token_factory, app, _db):
    token, user = session_token_factory()
    with app.app_context():
        _seed_history_records(_db, user)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.get("/api/plot/history/export?format=json", headers=headers)
    assert res.status_code == 200
    assert res.headers["Content-Disposition"].endswith(".json")

    payload = res.get_json()
    assert "data" in payload and "meta" in payload
    assert payload["meta"]["count"] == len(payload["data"])
    assert payload["meta"]["total"] >= payload["meta"]["count"]


def test_history_export_csv_with_filters(client, session_token_factory, app, _db):
    token, user = session_token_factory()
    with app.app_context():
        _seed_history_records(_db, user)

    headers = {"Authorization": f"Bearer {token}"}
    res = client.get(
        "/api/plot/history/export?format=csv&include_deleted=1&tags=algebra",
        headers=headers,
    )
    assert res.status_code == 200
    assert res.headers["Content-Disposition"].endswith(".csv")

    body = res.data.decode("utf-8").splitlines()
    assert body[0] == "id,uuid,expression,tags,created_at,deleted"
    assert any("algebra" in row for row in body[1:])
