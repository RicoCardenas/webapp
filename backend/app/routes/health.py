"""Health check del servicio."""

import os
import time
from datetime import datetime, timezone
from flask import jsonify, current_app

from . import api
from ..extensions import db, mail


@api.get("/health")
def health_check():
    """Verifica estado del sistema: DB, email y carga del servidor."""
    db_latency_ms = None
    db_status = "connected"
    start = time.perf_counter()
    try:
        db.session.execute(db.select(1))
        db_latency_ms = (time.perf_counter() - start) * 1000
    except Exception as exc:
        current_app.logger.error("Error de conexión a DB: %s", exc)
        db_status = "error"
        db_latency_ms = None

    queue_depth = None
    mail_ext = getattr(mail, "state", None)
    if mail_ext is not None:
        try:
            queue_depth = int(getattr(mail_ext, "outbox_size", 0) or 0)
        except (TypeError, ValueError):
            queue_depth = None

    load_ratio = None
    load_value = None
    cpu_count = os.cpu_count() or 1
    try:
        load_value = os.getloadavg()[0]
        load_ratio = load_value / max(cpu_count, 1)
    except (AttributeError, OSError):
        load_ratio = None

    latency_value = round(db_latency_ms, 2) if db_latency_ms is not None else None

    def classify_db():
        if db_status != "connected":
            return "critical"
        if latency_value is None:
            return "unknown"
        if latency_value <= 250:
            return "ok"
        if latency_value <= 600:
            return "warning"
        return "critical"

    def classify_mail():
        if queue_depth is None:
            return "unknown"
        if queue_depth == 0:
            return "ok"
        if queue_depth <= 5:
            return "warning"
        return "critical"

    def classify_system():
        if load_ratio is None:
            return "unknown"
        if load_ratio <= 0.6:
            return "ok"
        if load_ratio <= 1.5:
            return "warning"
        return "critical"

    indicators = {
        "database": classify_db(),
        "mail": classify_mail(),
        "system": classify_system(),
    }

    indicator_values = list(indicators.values())
    if db_status != "connected":
        overall = "error"
    elif any(value in {"warning", "critical"} for value in indicator_values):
        overall = "degraded"
    else:
        overall = "ok"

    payload = {
        "status": overall,
        "db_status": db_status,
        "metrics": {
            "db_latency_ms": latency_value,
            "mail_queue": int(queue_depth) if queue_depth is not None else None,
            "system_load": {
                "ratio": round(load_ratio, 2) if load_ratio is not None else None,
                "cores": cpu_count,
                "raw": round(load_value, 2) if load_value is not None else None,
            },
        },
        "indicators": indicators,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    status_code = 200 if db_status == "connected" else 500
    return jsonify(payload), status_code
