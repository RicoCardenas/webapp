"""HTTP endpoints exposed by the backend service."""
from flask import Blueprint, current_app, jsonify, send_from_directory

api = Blueprint("api", __name__)
frontend = Blueprint("frontend", __name__)


@frontend.get("/")
def serve_frontend():
    """Return the frontend entry-point so users see the app instead of a 404."""
    return send_from_directory(current_app.template_folder, "index.html")


@api.get("/health")
def health_check():
    """Basic health-check endpoint."""
    return jsonify(status="ok")


def register_routes(app):
    app.register_blueprint(frontend)
    app.register_blueprint(api, url_prefix="/api")
