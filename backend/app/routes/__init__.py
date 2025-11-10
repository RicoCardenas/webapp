"""
Routes package - modular organization of API endpoints.

Este paquete organiza las rutas por dominio funcional manteniendo un
blueprint 'api' único para evitar conflictos de prefijos.
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
