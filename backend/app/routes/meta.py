"""Meta endpoints - app metadata."""
from flask import jsonify, current_app

from . import api


@api.get("/meta/env")
def meta_env():
    """Retorna el entorno de ejecución."""
    env = (current_app.config.get("APP_ENV") or current_app.config.get("ENV") or "production").lower()
    return jsonify({
        "env": env,
        "demo_mode": env in {"development", "test"},
    })
