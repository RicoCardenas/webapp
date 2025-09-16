"""Inicialización de la aplicación web basada en Flask."""
from __future__ import annotations

from flask import Flask, jsonify

from .config import Config
from .database import db


def create_app(config_class: type[Config] = Config) -> Flask:
    """Crea y configura una instancia de la aplicación Flask."""
    app = Flask(__name__, static_folder=None)
    app.config.from_object(config_class)

    db.init_app(app)

    from .routes import api_bp

    app.register_blueprint(api_bp, url_prefix="/api")

    @app.get("/health")
    def healthcheck() -> tuple[dict[str, str], int]:
        """Ruta simple para comprobar el estado del servicio."""
        return jsonify(status="ok"), 200

    return app
