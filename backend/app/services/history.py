"""
Servicio de gestión de historial de gráficos.
"""

from datetime import datetime, timezone, timedelta

from flask import request, g
from sqlalchemy import or_, func
from sqlalchemy.orm import selectinload

from ..extensions import db
from ..models import PlotHistory, PlotHistoryTags, Tags

# Constantes de paginación
DEFAULT_HISTORY_PAGE_SIZE = 20
MIN_HISTORY_PAGE_SIZE = 10
MAX_HISTORY_PAGE_SIZE = 100
HISTORY_EXPORT_LIMIT = 5000


def parse_iso_datetime(value: str | None, *, end: bool = False):
    """
    Parsea una fecha ISO a datetime con timezone UTC.
    
    Si la fecha no tiene timezone, se asume UTC.
    Si end=True y no hay hora especificada, se ajusta al final del día.
    
    Args:
        value: String con fecha en formato ISO
        end: Si True, ajusta al final del día para fechas sin hora
        
    Returns:
        datetime en UTC o None si el valor es inválido
    """
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    if end and value and "T" not in value:
        dt = dt + timedelta(days=1) - timedelta(microseconds=1)
    return dt


def history_query_params():
    """
    Extrae y valida parámetros de consulta de historial desde request.args.
    
    Parámetros soportados:
    - page: Número de página (default: 1)
    - page_size/limit: Tamaño de página (default: 20, min: 10, max: 100)
    - offset: Offset legacy (convertido a page)
    - include_deleted: Incluir items eliminados
    - order: Orden de resultados ('asc' o 'desc', default: 'desc')
    - q: Término de búsqueda en expresiones y tags
    - from: Fecha desde (ISO)
    - to: Fecha hasta (ISO)
    - tags: Lista de tags separados por coma
    - with_total: Calcular total exacto (default: true, false evita COUNT())
    
    Returns:
        Diccionario con parámetros normalizados y validados
    """
    args = request.args

    def _read_int(name, default=None):
        try:
            return int(args.get(name))
        except (TypeError, ValueError):
            return default

    page = _read_int("page")
    page_size = _read_int("page_size")
    legacy_limit = _read_int("limit")

    if page_size is None:
        page_size = legacy_limit
    if page_size is None:
        page_size = DEFAULT_HISTORY_PAGE_SIZE

    page_size = max(MIN_HISTORY_PAGE_SIZE, min(page_size, MAX_HISTORY_PAGE_SIZE))

    if page is None:
        offset_param = args.get("offset")
        if offset_param is not None:
            legacy_offset = _read_int("offset", 0) or 0
            if legacy_offset < 0:
                legacy_offset = 0
            page = (legacy_offset // page_size) + 1
    if page is None or page < 1:
        page = 1

    include_deleted = str(args.get("include_deleted", "")).strip().lower() in {"1", "true", "yes"}
    order = (args.get("order") or "desc").strip().lower()
    if order not in {"asc", "desc"}:
        order = "desc"

    q = (args.get("q") or "").strip()
    date_from = parse_iso_datetime(args.get("from"))
    date_to = parse_iso_datetime(args.get("to"), end=True)

    tags_param = args.get("tags") or ""
    tags = [tag.strip() for tag in tags_param.split(",") if tag.strip()]

    # Parámetro de optimización: evitar COUNT() costoso
    with_total = str(args.get("with_total", "true")).strip().lower() in {"1", "true", "yes"}

    return {
        "page": page,
        "page_size": page_size,
        "offset": (page - 1) * page_size,
        "include_deleted": include_deleted,
        "order": order,
        "q": q,
        "date_from": date_from,
        "date_to": date_to,
        "tags": tags,
        "with_total": with_total,
    }


def build_history_query(params):
    """
    Construye una query SQLAlchemy de PlotHistory con los filtros aplicados.
    
    Filtra por:
    - Usuario actual (g.current_user)
    - Estado de eliminación
    - Rango de fechas
    - Tags específicos
    - Búsqueda de texto en expresiones y tags
    
    Args:
        params: Diccionario de parámetros (de history_query_params)
        
    Returns:
        Query de SQLAlchemy con filtros aplicados y relaciones precargadas
    """
    query = db.session.query(PlotHistory).filter(PlotHistory.user_id == g.current_user.id)

    if not params["include_deleted"]:
        query = query.filter(PlotHistory.deleted_at.is_(None))

    if params["date_from"]:
        query = query.filter(PlotHistory.created_at >= params["date_from"])
    if params["date_to"]:
        query = query.filter(PlotHistory.created_at <= params["date_to"])

    for raw_tag in params["tags"]:
        tag_value = raw_tag.lower()
        query = query.filter(
            PlotHistory.tags_association.any(
                PlotHistoryTags.tag.has(func.lower(Tags.name) == tag_value)
            )
        )

    q = params["q"]
    if q:
        terms = {q}
        if " " in q:
            terms.add(q.replace(" ", "+"))
        if "+" in q:
            terms.add(q.replace("+", " "))
        like_filters = []
        for term in terms:
            pattern = f"%{term}%"
            like_filters.append(PlotHistory.expression.ilike(pattern))
            like_filters.append(
                PlotHistory.tags_association.any(
                    PlotHistoryTags.tag.has(Tags.name.ilike(pattern))
                )
            )
        if like_filters:
            query = query.filter(or_(*like_filters))

    return query.options(
        selectinload(PlotHistory.tags_association).selectinload(PlotHistoryTags.tag)
    )


def serialize_history_item(row: PlotHistory):
    """
    Serializa un item de PlotHistory a formato JSON.
    
    Args:
        row: Instancia de PlotHistory
        
    Returns:
        Diccionario con campos serializados:
        - id/uuid: ID del item
        - expression: Expresión matemática
        - created_at: Fecha de creación (ISO)
        - tags: Lista de nombres de tags ordenada
        - deleted: Boolean indicando si está eliminado
    """
    tags = []
    for assoc in row.tags_association or []:
        name = getattr(getattr(assoc, "tag", None), "name", None)
        if name:
            tags.append(name)
    if tags:
        tags = sorted({t for t in tags})
    return {
        "id": str(row.id),
        "uuid": str(row.id),
        "expression": row.expression,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "tags": tags,
        "deleted": bool(row.deleted_at),
    }
