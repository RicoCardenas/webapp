from types import SimpleNamespace


def _patch_loadavg(monkeypatch, value=(0.1, 0.1, 0.1)):
    monkeypatch.setattr('backend.app.routes.os.getloadavg', lambda: value)


def test_health_ok(client, monkeypatch):
    _patch_loadavg(monkeypatch)

    res = client.get("/api/health")
    assert res.status_code == 200

    data = res.get_json()
    assert data["status"] == "ok"
    assert data["db_status"] == "connected"

    metrics = data["metrics"]
    assert set(metrics.keys()) == {"db_latency_ms", "mail_queue", "system_load"}
    assert "ratio" in metrics["system_load"]
    assert "raw" in metrics["system_load"]
    assert "cores" in metrics["system_load"]
    assert data["indicators"]["database"] == "ok"
    assert data["indicators"]["mail"] in {"ok", "unknown"}
    assert data["indicators"]["system"] in {"ok", "unknown"}
    assert "timestamp" in data
    latency = metrics["db_latency_ms"]
    if latency is not None:
        assert latency >= 0


def test_health_degraded_by_mail_queue(client, monkeypatch):
    _patch_loadavg(monkeypatch)
    monkeypatch.setattr(
        'backend.app.routes.mail',
        SimpleNamespace(state=SimpleNamespace(outbox_size=3)),
    )

    res = client.get("/api/health")
    assert res.status_code == 200

    data = res.get_json()
    assert data["status"] == "degraded"
    assert data["indicators"]["mail"] == "warning"
    assert data["metrics"]["mail_queue"] == 3


def test_health_db_failure_returns_error(client, monkeypatch):
    _patch_loadavg(monkeypatch)

    def fail_execute(*args, **kwargs):
        raise RuntimeError("db down")

    monkeypatch.setattr('backend.app.routes.db.session.execute', fail_execute)

    res = client.get("/api/health")
    assert res.status_code == 500

    data = res.get_json()
    assert data["status"] == "error"
    assert data["db_status"] == "error"
    assert data["indicators"]["database"] == "critical"
