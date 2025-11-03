from datetime import datetime, timedelta, timezone

from backend.app.models import PlotHistory, PlotHistoryTags, Tags


def _seed_history_records(db, user, total=12):
    now = datetime.now(timezone.utc)
    tag_algebra = Tags(user_id=user.id, name="algebra")
    tag_trig = Tags(user_id=user.id, name="trigonometria")
    db.session.add_all([tag_algebra, tag_trig])
    db.session.flush()

    expressions = [
        "sin(x)",
        "cos(x)",
        "tan(x)",
        "x**2 + 3",
        "e**x",
        "log(x)",
        "sqrt(x)",
        "abs(x)",
        "x + 1",
        "x + 2",
        "x + 3",
        "x + 4",
    ][:total]

    entries = []
    for idx, expr in enumerate(expressions):
        entry = PlotHistory(
            user_id=user.id,
            expression=expr,
            created_at=now - timedelta(days=idx),
        )
        entries.append(entry)
        db.session.add(entry)
    db.session.flush()

    if entries:
        db.session.add_all(
            [
                PlotHistoryTags(plot_history_id=entries[0].id, tag_id=tag_trig.id),
                PlotHistoryTags(plot_history_id=entries[1].id, tag_id=tag_trig.id),
                PlotHistoryTags(plot_history_id=entries[2].id, tag_id=tag_algebra.id),
                PlotHistoryTags(plot_history_id=entries[3].id, tag_id=tag_algebra.id),
            ]
        )
        entries[-1].deleted_at = now

    db.session.commit()
    return entries


def test_history_pagination_and_filters(client, session_token_factory, app, _db):
    token, user = session_token_factory()
    with app.app_context():
        _seed_history_records(_db, user)

    headers = {"Authorization": f"Bearer {token}"}

    res = client.get("/api/plot/history?page=1&page_size=10", headers=headers)
    assert res.status_code == 200
    payload = res.get_json()
    assert payload["meta"]["page"] == 1
    assert payload["meta"]["page_size"] == 10
    assert payload["meta"]["total"] == 11  # última entrada marcada como eliminada
    assert payload["meta"]["total_pages"] == 2
    assert len(payload["data"]) == 10
    assert all(item["deleted"] is False for item in payload["data"])

    page_two = client.get("/api/plot/history?page=2&page_size=10", headers=headers).get_json()
    assert page_two["meta"]["page"] == 2
    assert len(page_two["data"]) == 1

    out_of_range = client.get("/api/plot/history?page=5&page_size=10", headers=headers).get_json()
    assert out_of_range["meta"]["page"] == 5
    assert out_of_range["data"] == []

    search = client.get("/api/plot/history?q=sin", headers=headers).get_json()
    assert any("sin" in item["expression"] for item in search["data"])

    tag_filter = client.get("/api/plot/history?tags=algebra", headers=headers).get_json()
    assert all("algebra" in item["tags"] for item in tag_filter["data"])

    tag_query = client.get("/api/plot/history?q=algebra", headers=headers).get_json()
    assert tag_query["data"]
    assert all("algebra" in " ".join(item["tags"]) or "algebra" in (item["expression"] or "").lower() for item in tag_query["data"])

    date_from = (datetime.now(timezone.utc) - timedelta(days=3)).date().isoformat()
    date_to = (datetime.now(timezone.utc) - timedelta(days=1)).date().isoformat()
    date_filtered = client.get(f"/api/plot/history?from={date_from}&to={date_to}", headers=headers).get_json()
    assert date_filtered["meta"]["total"] <= payload["meta"]["total"]
    assert all(date_from <= item["created_at"][:10] <= date_to for item in date_filtered["data"])

    with_deleted = client.get("/api/plot/history?include_deleted=1&page_size=20", headers=headers).get_json()
    assert with_deleted["meta"]["total"] == 12
    assert any(item["deleted"] for item in with_deleted["data"])
