"""Servicios auxiliares relacionados con las gráficas."""
from __future__ import annotations

from ..database.models import Chart


def build_chart_preview(chart: Chart) -> dict[str, str | int]:
    """Genera datos mínimos para presentar una gráfica en el frontend."""
    return {
        "id": chart.id,
        "title": chart.title,
        "description": chart.description or "",
    }
