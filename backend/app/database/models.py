"""Modelos base de la base de datos."""
from __future__ import annotations

from datetime import datetime

from ..database import db


class Chart(db.Model):
    """Ejemplo de entidad para almacenar configuraciones de gráficas."""

    __tablename__ = "charts"

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def __repr__(self) -> str:  # pragma: no cover - representación útil en depuración
        return f"<Chart {self.id} {self.title!r}>"
