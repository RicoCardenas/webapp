"""Punto de entrada para los blueprints de la API."""
from __future__ import annotations

from flask import Blueprint

api_bp = Blueprint("api", __name__)

# Importar rutas para registrarlas en el blueprint.
from . import charts  # noqa: E402,F401
