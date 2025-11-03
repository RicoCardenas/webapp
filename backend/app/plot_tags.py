
from __future__ import annotations

import re
from typing import Iterable, Set

from sqlalchemy import func, select

from .extensions import db
from .models import PlotHistory, PlotHistoryTags, Tags

DEFAULT_FALLBACK_TAG = "other"

_TRIG_PATTERN = re.compile(r"\b(sin|cos|tan|cot|sec|csc)\b", re.IGNORECASE)
_HYPERBOLIC_PATTERN = re.compile(r"\b(sinh|cosh|tanh|coth|sech|csch)\b", re.IGNORECASE)
_LOG_PATTERN = re.compile(r"\b(ln|log)\b", re.IGNORECASE)
_EXP_PATTERN = re.compile(r"(\bexp\s*\(|\be\s*\^)|(\b(?!x)[a-df-z]\s*\^\s*x)|(\b\d+\s*\^\s*x)", re.IGNORECASE)
_RADICAL_PATTERN = re.compile(r"(\bsqrt\s*\(|\broot\s*\(|\^\s*\(?1\s*/\s*\d+\)?)", re.IGNORECASE)
_PIECEWISE_PATTERN = re.compile(r"(\bpiecewise\b|\{|\}|\bif\b.*\belse\b)", re.IGNORECASE | re.DOTALL)
_PARAMETRIC_PATTERN = re.compile(r"(\bx\s*\(\s*t\s*\)\s*=.*\by\s*\(\s*t\s*\)\s*=)|\bparam", re.IGNORECASE | re.DOTALL)

_ALLOWED_POLY_CHARS = re.compile(r"[0-9xX\+\-\*\^\(\)\s\.]")


def _normalize_tag_name(raw: str | None) -> str | None:
    if raw is None:
        return None
    name = str(raw).strip().lower()
    return name or None


def _extract_rhs(expression: str) -> str:
    parts = expression.split("=", 1)
    return parts[1].strip() if len(parts) == 2 else expression.strip()


def _looks_like_polynomial(expr: str) -> bool:
    expr = expr.strip()
    if not expr:
        return False
    residual = _ALLOWED_POLY_CHARS.sub("", expr)
    return residual == ""


def classify_expression(expression: str | None) -> Set[str]:
    text = (expression or "").strip()
    if not text:
        return {DEFAULT_FALLBACK_TAG}

    lower = text.lower()
    rhs = _extract_rhs(lower)

    categories: Set[str] = set()

    if _TRIG_PATTERN.search(lower):
        categories.add("trigonometric")
    if _HYPERBOLIC_PATTERN.search(lower):
        categories.add("hyperbolic")
    if _LOG_PATTERN.search(lower):
        categories.add("logarithmic")
    if _EXP_PATTERN.search(lower):
        categories.add("exponential")
    if _RADICAL_PATTERN.search(lower):
        categories.add("radical")

    if "/" in rhs:
        numerator, _, denominator = rhs.partition("/")
        if numerator and denominator and _looks_like_polynomial(numerator) and _looks_like_polynomial(denominator):
            categories.add("rational")

    if _looks_like_polynomial(rhs) and not categories.intersection({"rational", "radical", "logarithmic", "exponential", "trigonometric", "hyperbolic"}):
        categories.add("polynomial")

    if _PIECEWISE_PATTERN.search(lower):
        categories.add("piecewise")

    if _PARAMETRIC_PATTERN.search(lower):
        categories.add("parametric")

    if not categories:
        categories.add(DEFAULT_FALLBACK_TAG)

    return categories


def _ensure_tag_objects(user_id, tag_names: Set[str], session=None) -> list[Tags]:
    session = session or db.session
    if not tag_names:
        return []
    normalized = {name for name in (_normalize_tag_name(name) for name in tag_names) if name}
    if not normalized:
        return []

    normalized_list = sorted(normalized)

    existing = (
        session.scalars(
            select(Tags).where(
                Tags.user_id == user_id,
                func.lower(Tags.name).in_(normalized_list),
            )
        ).all()
        if normalized_list
        else []
    )

    by_name = {tag.name.lower(): tag for tag in existing if tag.name}

    tags: list[Tags] = []
    for name in normalized_list:
        tag = by_name.get(name)
        if not tag:
            tag = Tags(user_id=user_id, name=name)
            session.add(tag)
            session.flush([tag])
            by_name[name] = tag
        tags.append(tag)
    return tags


def apply_tags_to_history(history: PlotHistory, tag_names: Iterable[str], session=None) -> Set[str]:
    session = session or db.session
    normalized = {name for name in (_normalize_tag_name(name) for name in tag_names) if name}
    if not normalized:
        normalized = {DEFAULT_FALLBACK_TAG}

    attached: Set[str] = set()
    existing = {
        _normalize_tag_name(assoc.tag.name)
        for assoc in (history.tags_association or [])
        if assoc.tag and assoc.tag.name
    }

    tags = _ensure_tag_objects(history.user_id, normalized, session=session)
    for tag in tags:
        tag_name = _normalize_tag_name(tag.name)
        if not tag_name or tag_name in existing:
            continue
        history.tags_association.append(PlotHistoryTags(tag=tag))
        existing.add(tag_name)
        attached.add(tag_name)
    return attached