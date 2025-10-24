"""Utilidades de autenticación para la API de EcuPlot."""
from functools import wraps
from datetime import datetime, timezone
from flask import request, jsonify, g
from sqlalchemy import and_
from .extensions import db
from .models import UserSessions

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
            return jsonify(error="Token de sesión faltante."), 401

        session = db.session.execute(
            db.select(UserSessions).where(
                and_(
                    UserSessions.session_token == token,
                    UserSessions.expires_at > datetime.now(timezone.utc)
                )
            )
        ).scalar_one_or_none()

        if not session:
            return jsonify(error="Sesión inválida o expirada."), 401

        g.current_user = session.user
        g.current_session = session
        return fn(*args, **kwargs)
    return wrapper