"""Historial de gráficos con paginación optimizada y exportación."""

import csv
import io
import json
import math
import time
from datetime import datetime, timezone
from flask import jsonify, current_app, g, request, stream_with_context
from sqlalchemy import asc, desc
from sqlalchemy.orm import selectinload

from . import api
from ..auth import require_session
from ..extensions import db
from ..models import PlotHistory, PlotHistoryTags
from ..plot_tags import auto_tag_history, apply_tags_to_history
from ..event_stream import events as event_bus
from ..services.history import (
    history_query_params,
    build_history_query,
    serialize_history_item,
    HISTORY_EXPORT_LIMIT,
)


def _load_user_history_entry(history_id):
    """Load a history entry for current user."""
    history = (
        db.session.query(PlotHistory)
        .options(selectinload(PlotHistory.tags_association).selectinload(PlotHistoryTags.tag))
        .filter(
            PlotHistory.id == history_id,
            PlotHistory.user_id == g.current_user.id,
        )
        .first()
    )
    return history


def _normalize_tags_payload(tags_value):
    """Normalize tags from request payload."""
    if tags_value is None:
        return []
    if isinstance(tags_value, (list, tuple)):
        tags = []
        for raw in tags_value:
            if raw is None:
                continue
            name = str(raw).strip()
            if name:
                tags.append(name)
        return tags
    raise ValueError("tags debe ser una lista de cadenas")


@api.post("/plot")
@require_session
def create_plot():
    """
    Guarda en plot_history para el usuario autenticado.
    Acepta:
      - {"expression": "f(x)=sin(x)"}    # una
      - {"expressions": ["f(x)=...","..."]}  # varias
      - (opcional) plot_parameters, plot_metadata
    """
    data = request.get_json() or {}

    expressions = []
    if isinstance(data.get("expressions"), list):
        expressions = [str(x).strip() for x in data["expressions"] if str(x).strip()]
    elif isinstance(data.get("expression"), str):
        exp = data["expression"].strip()
        if exp:
            expressions = [exp]

    if not expressions:
        return jsonify(error="No hay expresiones para guardar."), 400

    plot_parameters = data.get('plot_parameters')
    plot_metadata = data.get('plot_metadata')

    items = []
    try:
        for expr in expressions:
            created_at = datetime.now(timezone.utc)
            item = PlotHistory(
                user_id=g.current_user.id,
                expression=expr,
                plot_parameters=plot_parameters,
                plot_metadata=plot_metadata,
                created_at=created_at,
                updated_at=created_at,
            )
            db.session.add(item)
            items.append(item)
            auto_tag_history(item, expr, session=db.session, replace=True)
        db.session.flush()
        for item in items:
            db.session.refresh(item)

        response_items = []
        for record in items:
            tag_names = sorted({
                (assoc.tag.name or '').strip().lower()
                for assoc in (record.tags_association or [])
                if assoc.tag and assoc.tag.name
            })
            response_items.append({
                "id": str(record.id),
                "expression": record.expression,
                "created_at": record.created_at.isoformat() if record.created_at else None,
                "tags": tag_names,
            })
        db.session.commit()
        event_bus.publish(
            g.current_user.id,
            channel="history",
            event_type="history:new",
            data={"items": response_items},
        )
        return jsonify(
            message="Expresiones guardadas en historial.",
            saved=len(items),
            items=response_items
        ), 201
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al guardar plot_history: {e}")
        return jsonify(error="No se pudo guardar el historial."), 500


@api.get("/plot/history")
@require_session
def plot_history_list():
    """
    Lista el historial del usuario autenticado.
    
    Query params:
    - with_total=true (default): Calcula total exacto (requiere COUNT)
    - with_total=false: Omite COUNT(), usa LIMIT+1 para determinar has_more
    """
    params = history_query_params()
    query = build_history_query(params)

    order_clause = asc(PlotHistory.created_at) if params["order"] == "asc" else desc(PlotHistory.created_at)
    secondary_order = asc(PlotHistory.id) if params["order"] == "asc" else desc(PlotHistory.id)

    # Monitoreo de performance de query
    start_time = time.perf_counter()
    
    if params["with_total"]:
        # Comportamiento tradicional: COUNT() + paginación exacta
        total = query.count()
        total_pages = math.ceil(total / params["page_size"]) if total else 0

        rows = []
        if total and params["offset"] < total:
            rows = (
                query.order_by(order_clause, secondary_order)
                .offset(params["offset"])
                .limit(params["page_size"])
                .all()
            )

        data = [serialize_history_item(row) for row in rows]

        # Log de tiempo de query para análisis de performance
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        current_app.logger.info(
            f"History query: user={g.current_user.id}, page={params['page']}, "
            f"total={total}, time={elapsed_ms:.2f}ms, with_count=true"
        )

        return jsonify(
            {
                "data": data,
                "meta": {
                    "page": params["page"],
                    "page_size": params["page_size"],
                    "total": total,
                    "total_pages": total_pages,
                    "order": params["order"],
                },
            }
        )
    else:
        # Optimización: evitar COUNT(), usar LIMIT+1 para has_more
        rows = (
            query.order_by(order_clause, secondary_order)
            .offset(params["offset"])
            .limit(params["page_size"] + 1)  # Pedir uno más para detectar has_more
            .all()
        )

        has_more = len(rows) > params["page_size"]
        if has_more:
            rows = rows[:params["page_size"]]  # Recortar el extra

        data = [serialize_history_item(row) for row in rows]

        # Log de tiempo de query optimizada (sin COUNT)
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        current_app.logger.info(
            f"History query: user={g.current_user.id}, page={params['page']}, "
            f"rows={len(data)}, time={elapsed_ms:.2f}ms, with_count=false"
        )

        return jsonify(
            {
                "data": data,
                "meta": {
                    "page": params["page"],
                    "page_size": params["page_size"],
                    "has_more": has_more,
                    "order": params["order"],
                },
            }
        )


@api.get("/plot/history/export")
@require_session
def export_plot_history():
    """
    Exporta historial en CSV o JSON.
    
    CSV usa streaming (generador) para consumo constante de memoria O(1).
    JSON carga todo en memoria (limitado por HISTORY_EXPORT_LIMIT).
    """
    params = history_query_params()
    fmt = (request.args.get("format") or "csv").strip().lower()
    if fmt not in {"csv", "json"}:
        return jsonify(error="Formato no soportado. Usa 'csv' o 'json'."), 400

    query = build_history_query(params)
    order_clause = asc(PlotHistory.created_at) if params["order"] == "asc" else desc(PlotHistory.created_at)
    secondary_order = asc(PlotHistory.id) if params["order"] == "asc" else desc(PlotHistory.id)

    limit = HISTORY_EXPORT_LIMIT
    generated_at = datetime.now(timezone.utc).strftime("%Y%m%d")

    if fmt == "json":
        # JSON requiere cargar todo en memoria para serializar
        total = query.count()
        rows = (
            query.order_by(order_clause, secondary_order)
            .limit(limit)
            .all()
        )
        data = [serialize_history_item(row) for row in rows]
        truncated = total > len(data)

        response = jsonify(
            {
                "data": data,
                "meta": {
                    "count": len(data),
                    "total": total,
                    "truncated": truncated,
                },
            }
        )
        response.headers["Content-Disposition"] = f'attachment; filename=plot-history-{generated_at}.json'
        return response

    # CSV: streaming con generador para memoria O(1)
    @stream_with_context
    def generate_csv():
        """Generador que produce CSV línea por línea con contexto de aplicación."""
        # Header
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(["id", "uuid", "expression", "tags", "created_at", "deleted"])
        yield buffer.getvalue()
        buffer.seek(0)
        buffer.truncate(0)

        # Filas: procesar en chunks para evitar cargar todo en memoria
        count = 0
        offset = 0
        chunk_size = 500  # Procesar 500 filas a la vez

        while count < limit:
            chunk_limit = min(chunk_size, limit - count)
            rows = (
                query.order_by(order_clause, secondary_order)
                .offset(offset)
                .limit(chunk_limit)
                .all()
            )

            if not rows:
                break

            for row in rows:
                item = serialize_history_item(row)
                writer.writerow(
                    [
                        item["id"],
                        item["uuid"],
                        item["expression"] or "",
                        ";".join(item["tags"]) if item["tags"] else "",
                        item["created_at"] or "",
                        "1" if item["deleted"] else "0",
                    ]
                )
                yield buffer.getvalue()
                buffer.seek(0)
                buffer.truncate(0)

            count += len(rows)
            offset += chunk_limit

            if len(rows) < chunk_limit:
                break

    response = current_app.response_class(generate_csv(), mimetype="text/csv")
    response.headers["Content-Disposition"] = f'attachment; filename=plot-history-{generated_at}.csv'
    return response


@api.patch("/plot/history/<uuid:history_id>")
@require_session
def update_plot_history(history_id):
    """Actualiza una entrada del historial."""
    payload = request.get_json(silent=True) or {}
    history = _load_user_history_entry(history_id)
    if not history:
        return jsonify(error="Historial no encontrado."), 404
    if history.deleted_at:
        return jsonify(error="No se puede editar un registro eliminado."), 400

    sentinel = object()
    expression_raw = payload.get("expression", sentinel)
    tags_raw = payload.get("tags", sentinel)
    auto_tag_flag = bool(payload.get("auto_tag"))

    changed = False

    if expression_raw is not sentinel:
        expression = (expression_raw or "") if isinstance(expression_raw, str) else str(expression_raw or "")
        expression = expression.strip()
        if not expression:
            return jsonify(error="La expresión no puede estar vacía."), 400
        history.expression = expression
        changed = True

    if tags_raw is not sentinel:
        try:
            normalized_tags = _normalize_tags_payload(tags_raw)
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        apply_tags_to_history(history, normalized_tags, session=db.session, replace=True)
        changed = True
    elif expression_raw is not sentinel or auto_tag_flag:
        # Recalcular etiquetas automáticas si cambió la expresión o el cliente lo solicitó.
        auto_tag_history(history, history.expression, session=db.session, replace=True)
        changed = True

    if not changed:
        return jsonify(error="No se recibieron cambios."), 400

    try:
        db.session.flush()
        item = serialize_history_item(history)
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("No se pudo actualizar el historial %s: %s", history_id, exc)
        return jsonify(error="No se pudo actualizar el historial."), 500

    event_bus.publish(
        g.current_user.id,
        channel="history",
        event_type="history:update",
        data={"items": [item]},
    )

    return jsonify(item=item)


@api.delete("/plot/history/<uuid:history_id>")
@require_session
def delete_plot_history(history_id):
    """Elimina (soft delete) una entrada del historial."""
    history = _load_user_history_entry(history_id)
    if not history:
        return jsonify(error="Historial no encontrado."), 404

    if not history.deleted_at:
        history.deleted_at = datetime.now(timezone.utc)

    try:
        db.session.flush()
        item = serialize_history_item(history)
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("No se pudo eliminar el historial %s: %s", history_id, exc)
        return jsonify(error="No se pudo eliminar el historial."), 500

    event_bus.publish(
        g.current_user.id,
        channel="history",
        event_type="history:delete",
        data={"items": [item]},
    )

    return jsonify(item=item)
