"""Application factory for the backend service."""
from pathlib import Path
from flask import Flask
from backend.config import Config, init_app_config

# Importamos las instancias de las extensiones
from .extensions import db, migrate, bcrypt, mail, cors

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

    # Inicializar Extensiones
    # Vinculamos las instancias de 'extensions.py' con nuestra 'app'
    db.init_app(app)
    migrate.init_app(app, db)
    bcrypt.init_app(app)
    mail.init_app(app)
    cors.init_app(
        app,
        resources={r"/api/*": {"origins": app.config.get("CORS_ORIGINS", "*")}},
        supports_credentials=True,
    )

    with app.app_context():
        from . import models

    from .routes import api as api_blueprint
    from .routes import frontend as frontend_blueprint

    app.register_blueprint(frontend_blueprint)
    app.register_blueprint(api_blueprint, url_prefix="/api")

    return app
