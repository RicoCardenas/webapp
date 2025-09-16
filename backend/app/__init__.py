"""Application factory for the backend service."""
from pathlib import Path

from flask import Flask

from backend.config import Config
from .routes import register_routes

# Resolve project directories so Flask can serve the frontend assets.
PROJECT_ROOT = Path(__file__).resolve().parents[2]
PUBLIC_DIR = PROJECT_ROOT / "frontend" / "public"
STATIC_DIR = PROJECT_ROOT / "frontend" / "src"


def create_app() -> Flask:
    app = Flask(
        __name__,
        static_folder=str(STATIC_DIR),
        static_url_path="/static",
        template_folder=str(PUBLIC_DIR),
    )
    app.config.from_object(Config)
    register_routes(app)
    return app
