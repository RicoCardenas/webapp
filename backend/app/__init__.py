"""Application factory for the backend service."""
from pathlib import Path
from flask import Flask
from backend.config import Config, init_app_config

# Importamos las instancias de las extensiones
from .extensions import db, migrate, bcrypt, mail, cors, limiter
from .event_stream import events as event_bus
from .logging_config import configure_logging, setup_request_logging

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PUBLIC_DIR = PROJECT_ROOT / "frontend" / "public"
STATIC_DIR = PROJECT_ROOT / "frontend" / "src"


def create_app(config_object=Config) -> Flask:
    """
    Fábrica de la aplicación Flask.
    Configura la app
    """
    app = Flask(
        __name__,
        static_folder=str(STATIC_DIR),
        static_url_path="/static",
        template_folder=str(PUBLIC_DIR),
    )

    app.config.from_object(config_object)
    init_app_config(app)

    # Configure structured logging early
    configure_logging(app)
    setup_request_logging(app)

    # Inicializar Extensiones
    # Vinculamos las instancias de 'extensions.py' con nuestra 'app'
    db.init_app(app)
    migrate.init_app(app, db)
    bcrypt.init_app(app)
    mail.init_app(app)
    runtime_env = app.config.get("APP_ENV", "production")
    cors_origins = app.config.get("CORS_ORIGINS") or []

    if runtime_env == "production":
        if not cors_origins:
            raise RuntimeError(
                "FATAL: CORS_ORIGINS no está configurado para producción. "
                "Define una lista de dominios permitidos antes de iniciar la aplicación."
            )
    if not cors_origins:
        cors_origins = "*"

    supports_credentials = bool(app.config.get("CORS_SUPPORTS_CREDENTIALS", False))

    cors.init_app(
        app,
        resources={r"/api/*": {"origins": cors_origins}},
        supports_credentials=supports_credentials,
    )

    # Initialize rate limiter
    # Note: storage_uri debe configurarse en el limiter object antes de init_app
    storage_uri = app.config.get("RATELIMIT_STORAGE_URI", "memory://")
    limiter.storage_uri = storage_uri
    limiter.init_app(app)

    event_bus.set_max_subscribers(app.config.get("SSE_MAX_CONNECTIONS_PER_USER", 3))

    with app.app_context():
        from . import models

    # Importar blueprints desde el paquete routes modular
    from .routes import api as api_blueprint
    from .routes import frontend as frontend_blueprint

    app.register_blueprint(frontend_blueprint)
    app.register_blueprint(api_blueprint, url_prefix="/api")

    return app
