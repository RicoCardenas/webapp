"""Configuración de la capa de acceso a datos."""
from __future__ import annotations

from flask_sqlalchemy import SQLAlchemy

# Instancia de SQLAlchemy compartida en toda la aplicación.
db = SQLAlchemy()
