"""SSE (Server-Sent Events) endpoints."""
import queue
from datetime import datetime, timezone
from flask import jsonify, current_app, request, g, stream_with_context

from . import api
from ..auth import require_session
from ..extensions import db
from ..models import UserTokens, Users
from ..event_stream import events as event_bus
from datetime import timedelta


# Tiempo de vida de los tokens de streaming SSE
SSE_STREAM_TOKEN_TTL = timedelta(minutes=5)


def _issue_user_token(user, token_type, expires_delta):
    """Helper para generar tokens. TODO: mover a servicio compartido."""
    import secrets
    from sqlalchemy import delete
    
    token_value = secrets.token_urlsafe(48)
    expiry = datetime.now(timezone.utc) + expires_delta

    db.session.execute(
        delete(UserTokens).where(
            UserTokens.user_id == user.id,
            UserTokens.token_type == token_type,
            UserTokens.used_at.is_(None),
        )
    )

    token = UserTokens(
        user=user,
        token=token_value,
        token_type=token_type,
        expires_at=expiry,
    )
    db.session.add(token)
    return token


@api.post("/stream/token")
@require_session
def issue_stream_token():
    """Genera un token efímero para consumir el canal SSE."""
    try:
        # Invalidar tokens SSE anteriores no usados del mismo usuario
        # para evitar conexiones duplicadas
        existing_tokens = db.session.execute(
            db.select(UserTokens).where(
                UserTokens.user_id == g.current_user.id,
                UserTokens.token_type == "sse_stream",
                UserTokens.used_at.is_(None),
            )
        ).scalars().all()
        
        for old_token in existing_tokens:
            # Marcar como usado para que no se puedan usar
            old_token.used_at = datetime.now(timezone.utc)
        
        token = _issue_user_token(g.current_user, "sse_stream", SSE_STREAM_TOKEN_TTL)
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("No se pudo generar token de stream: %s", exc)
        return jsonify(error="No se pudo generar el token de streaming."), 500

    expires_at = token.expires_at
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    response = jsonify(
        {
            "expires_at": expires_at.isoformat() if expires_at else None,
        }
    )

    max_age = int(SSE_STREAM_TOKEN_TTL.total_seconds())
    runtime_env = (current_app.config.get("APP_ENV") or "production").lower()
    secure_default = runtime_env == "production"
    secure_cookie = bool(current_app.config.get("SESSION_COOKIE_SECURE", secure_default))

    response.set_cookie(
        "sse_stream_token",
        token.token,
        max_age=max_age,
        httponly=True,
        secure=secure_cookie,
        samesite="Lax",
        path="/api/stream",
    )
    response.headers["Cache-Control"] = "no-store"
    return response, 201


@api.get("/stream")
def user_event_stream():
    """Canal SSE protegido con token efímero."""
    token_value = (request.cookies.get("sse_stream_token") or "").strip()
    legacy_param = request.args.get("stream_token")
    if legacy_param and not token_value:
        current_app.logger.warning("Intento de acceso SSE con token en querystring bloqueado.")
    if not token_value:
        return jsonify(error="Token de stream faltante."), 401

    token_obj = db.session.execute(
        db.select(UserTokens).where(
            UserTokens.token == token_value,
            UserTokens.token_type == "sse_stream",
            UserTokens.used_at.is_(None),
        )
    ).scalar_one_or_none()

    if not token_obj:
        return jsonify(error="Token de stream inválido."), 401

    expires_at = token_obj.expires_at
    if expires_at:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at <= datetime.now(timezone.utc):
            return jsonify(error="Token de stream expirado."), 401

    user = token_obj.user
    if user is None and token_obj.user_id:
        user = db.session.get(Users, token_obj.user_id)
    if user is None:
        return jsonify(error="Token de stream sin usuario asociado."), 401

    g.current_user = user

    token_obj.used_at = datetime.now(timezone.utc)
    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("No se pudo marcar token de stream como usado: %s", exc)
        return jsonify(error="No se pudo habilitar el canal de eventos."), 500

    user_id = user.id
    try:
        subscription = event_bus.subscribe(user_id)
    except RuntimeError:
        current_app.logger.warning("Usuario %s excedió el límite de conexiones SSE", user_id)
        return jsonify(error="Límite de conexiones SSE alcanzado."), 429

    def _iterator():
        try:
            yield "event: ready\ndata: {}\n\n"
            while True:
                try:
                    payload = subscription.get(timeout=25)
                except queue.Empty:
                    yield "event: keepalive\ndata: {}\n\n"
                    continue
                if payload is None:
                    break
                if isinstance(payload, dict) and payload.get("type") == "disconnect":
                    break
                yield event_bus.format_sse(payload)
        finally:
            event_bus.unsubscribe(user_id, subscription)

    response = current_app.response_class(
        stream_with_context(_iterator()),
        mimetype="text/event-stream",
    )
    response.headers["Cache-Control"] = "no-cache"
    response.headers["X-Accel-Buffering"] = "no"
    return response
