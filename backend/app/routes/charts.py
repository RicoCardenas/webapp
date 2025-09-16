"""Rutas relacionadas con las gráficas."""
from __future__ import annotations

from flask import jsonify, request

from ..database.models import Chart
from ..database import db
from ..services.chart_service import build_chart_preview
from . import api_bp


@api_bp.get("/charts")
def list_charts():
    """Devuelve la lista de gráficas disponibles."""
    charts = Chart.query.order_by(Chart.created_at.desc()).all()
    data = [
        {
            "id": chart.id,
            "title": chart.title,
            "description": chart.description,
            "created_at": chart.created_at.isoformat(),
            "updated_at": chart.updated_at.isoformat(),
        }
        for chart in charts
    ]
    return jsonify(data)


@api_bp.post("/charts")
def create_chart():
    """Crea una nueva gráfica en base a los parámetros recibidos."""
    payload = request.get_json(silent=True) or {}
    title = payload.get("title")
    description = payload.get("description")

    if not title:
        return jsonify({"error": "El campo 'title' es obligatorio."}), 400

    chart = Chart(title=title, description=description)
    db.session.add(chart)
    db.session.commit()

    return jsonify({"id": chart.id, "preview": build_chart_preview(chart)}), 201
