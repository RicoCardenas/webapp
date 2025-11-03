"""Utilidades de autenticación para la API de EcuPlot."""
from functools import wraps
from datetime import datetime, timezone
from flask import request, jsonify, g
from sqlalchemy import cast, String, or_
from sqlalchemy.orm import selectinload
from .extensions import db
from .models import UserSessions, Users


def _resolve_user(session):
    """Obtiene el usuario vinculado a la sesión con roles activos."""
    user_id = session.user_id
    if not user_id:
        return None

    stmt = (
        db.select(Users)
        .options(selectinload(Users.roles), selectinload(Users.role))
        .where(Users.id == user_id)
    )

    user = db.session.execute(stmt).scalar_one_or_none()
    if user is not None:
        return user

    try:
        stmt_fallback = (
            db.select(Users)
            .options(selectinload(Users.roles), selectinload(Users.role))
            .where(or_(Users.id == user_id, cast(Users.id, String) == str(user_id)))
        )
        return db.session.execute(stmt_fallback).scalar_one_or_none()
    except Exception:
        return None

def require_session(fn):
    """Verifica el token de sesión (Bearer o X-Session-Token) y carga g.current_user."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        auth = request.headers.get('Authorization', '')
        token = None
        if auth.startswith('Bearer '):
            token = auth.split(' ', 1)[1].strip()
        if not token:
            token = request.headers.get('X-Session-Token')
        if not token:
            token = request.args.get('token')

        if not token:
            return jsonify(error="Token de sesión faltante."), 401

        session = db.session.execute(
            db.select(UserSessions).where(UserSessions.session_token == token)
        ).scalar_one_or_none()

        if not session:
            return jsonify(error="Sesión inválida o expirada."), 401

        expires_at = session.expires_at
        if expires_at:
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at <= datetime.now(timezone.utc):
                return jsonify(error="Sesión inválida o expirada."), 401

        user = _resolve_user(session)
        if user is None:
            return jsonify(error="Sesión sin usuario asociado."), 401

        g.current_user = user
        g.current_session = session
        return fn(*args, **kwargs)
    return wrapper
