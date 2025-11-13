"""
Routes package - modular organization of API endpoints.
"""
from flask import Blueprint

# Blueprint único para la API
api = Blueprint("api", __name__)

# Blueprint para frontend
frontend = Blueprint("frontend", __name__)

# Importar módulos de rutas después de crear blueprints para evitar circular imports
from . import (
    frontend_routes,
    health,
    meta,
    sse,
    history,
    auth,
    account,
    twofa,
    notifications_routes,
    admin,
    groups,
    dev,
    roles,
    learning,
)

__all__ = ["api", "frontend"]
