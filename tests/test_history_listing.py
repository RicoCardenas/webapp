# tests/test_history_listing.py
def _seed_plots(db, PlotHistory, user_id, n=5):
    items = []
    for i in range(n):
        items.append(
            PlotHistory(
                user_id=user_id,
                expression=f"f{i}(x)=x+{i}",
                plot_parameters={"grid": bool(i % 2)},
                plot_metadata={"note": f"n{i}"},
            )
        )
    db.session.add_all(items)
    db.session.commit()

def test_history_pagination_and_filter(client, session_token_factory, app, _db, models_ns):
    token, user = session_token_factory()
    with app.app_context():
        _seed_plots(_db, models_ns.PlotHistory, user.id, n=8)

    res = client.get("/api/plot/history?limit=3&offset=0", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.get_json()
    assert data["total"] == 8
    assert len(data["items"]) == 3

    res2 = client.get("/api/plot/history?q=x+3", headers={"Authorization": f"Bearer {token}"})
    assert res2.status_code == 200
    data2 = res2.get_json()
    assert data2["total"] >= 1
    assert any("x+3" in it["expression"] for it in data2["items"])
