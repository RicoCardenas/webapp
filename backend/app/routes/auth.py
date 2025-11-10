"""Rutas de autenticación de usuario."""

import base64
import hashlib
import hmac
import re
import secrets
import struct
import time
from datetime import datetime, timedelta, timezone
from urllib import request as urllib_request, error as urllib_error
from urllib.parse import quote
from functools import lru_cache

from flask import current_app, jsonify, request, redirect, url_for, g
from flask_mail import Message
from sqlalchemy import cast, String, delete, func

from . import api
from ..extensions import db, bcrypt, mail
from ..models import (
    Users,
    Roles,
    UserTokens,
    UserSessions,
    TwoFactorBackupCode,
    AuditLog,
)
from ..auth import require_session
from ..notifications import create_notification
from ..event_stream import events as event_bus
from ..services.passwords import password_strength_error, password_is_compromised
from ..services.validate import normalize_email
from ..services.mail import resolve_mail_sender
from ..services.tokens import issue_user_token as _svc_issue_user_token


MAX_FAILED_LOGIN_ATTEMPTS = 3
ACCOUNT_UNLOCK_TOKEN_TTL = timedelta(hours=24)
PASSWORD_RESET_TOKEN_TTL = timedelta(hours=1)
PASSWORD_POLICY_MESSAGE = (
    "La contraseña debe tener al menos 8 caracteres, con una letra mayúscula, "
    "una letra minúscula, un número y un carácter especial."
)
HIBP_API_RANGE_URL = "https://api.pwnedpasswords.com/range/"
HIBP_USER_AGENT = "EcuPlotPasswordChecker/1.0"
MAIL_SENDER_MISSING_ERROR = "Servicio de correo no disponible. Intenta más tarde."

TOTP_ISSUER = 'EcuPlot'
TOTP_PERIOD = 30
TOTP_DIGITS = 6

OPS_AUDIT_ACTIONS = {
    "role.admin.assigned",
    "role.admin.removed",
    "auth.login.failed",
    "auth.login.succeeded",
    "auth.account.locked",
    "security.2fa.enabled",
    "security.2fa.disabled",
    "security.2fa.backup_regenerated",
    "ops.backup.created",
}


def _log_warning(message: str, *args) -> None:
    """Registra un warning en el logger de la aplicación."""
    try:
        current_app.logger.warning(message, *args)
    except Exception:
        pass


@lru_cache(maxsize=512)
def _hibp_fetch_range(prefix: str) -> dict[str, int]:
    """Recupera el mapa de sufijos SHA1 -> número de apariciones desde HIBP."""
    prefix = (prefix or "").strip().upper()
    if len(prefix) != 5 or not prefix.isalnum():
        return {}

    url = f"{HIBP_API_RANGE_URL}{prefix}"
    request_obj = urllib_request.Request(url, headers={"User-Agent": HIBP_USER_AGENT})

    try:
        with urllib_request.urlopen(request_obj, timeout=3.0) as response:
            if getattr(response, "status", 200) >= 400:
                _log_warning("HIBP devolvió estado inesperado (%s)", getattr(response, "status", "unknown"))
                return {}
            payload = response.read().decode("utf-8", errors="ignore")
    except (urllib_error.URLError, urllib_error.HTTPError) as exc:
        _log_warning("No se pudo consultar HIBP: %s", exc)
        return {}
    except Exception as exc:  # pragma: no cover - ruta defensiva
        _log_warning("Fallo inesperado consultando HIBP: %s", exc)
        return {}

    results: dict[str, int] = {}
    for line in payload.splitlines():
        if not line or ":" not in line:
            continue
        suffix, count = line.split(":", 1)
        suffix = suffix.strip().upper()
        if len(suffix) != 35:
            continue
        try:
            results[suffix] = int(count.strip())
        except ValueError:
            continue
    return results


def _password_is_compromised(password: str, minimum_count: int) -> bool:
    """Verifica si una contraseña aparece en bases de datos filtradas (HIBP)."""
    if not password:
        return False
    digest = hashlib.sha1(password.encode("utf-8")).hexdigest().upper()
    prefix, suffix = digest[:5], digest[5:]
    matches = _hibp_fetch_range(prefix)
    count = matches.get(suffix, 0)
    return count >= max(1, minimum_count)


_password_strength_error = password_strength_error
_password_is_compromised = password_is_compromised
_normalize_email = normalize_email
_resolve_mail_sender = resolve_mail_sender
_issue_user_token = _svc_issue_user_token


def _send_lockout_notification(user, unlock_link):
    """Notifica al usuario que su cuenta quedó bloqueada y cómo desbloquearla."""
    sender = _resolve_mail_sender()
    if not sender:
        current_app.logger.warning(
            "No se puede enviar notificación de bloqueo: remitente no configurado (%s).",
            user.email,
        )
        return

    try:
        msg = Message(
            subject="Tu cuenta de EcuPlot fue bloqueada",
            sender=sender,
            recipients=[user.email],
            body=(
                f"Hola {user.name},\n\n"
                "Bloqueamos tu cuenta de EcuPlot después de tres intentos fallidos de inicio de sesión. "
                "Para proteger tus datos, no podrás iniciar sesión hasta que la desbloquees manualmente.\n\n"
                "Puedes reactivar el acceso con este enlace seguro:\n"
                f"{unlock_link}\n\n"
                "Si no fuiste tú, te recomendamos restablecer tu contraseña inmediatamente.\n\n"
                "Equipo de EcuPlot"
            ),
        )
        mail.send(msg)
    except Exception as exc:
        current_app.logger.error(
            "No se pudo enviar correo de bloqueo a %s: %s",
            user.email,
            exc,
        )


def _send_password_reset_email(user, reset_link):
    """Envía correo con enlace de restablecimiento de contraseña."""
    sender = _resolve_mail_sender()
    if not sender:
        current_app.logger.warning(
            "No se puede enviar correo de restablecimiento: remitente no configurado (%s).",
            user.email,
        )
        return

    try:
        msg = Message(
            subject="Restablece tu contraseña de EcuPlot",
            sender=sender,
            recipients=[user.email],
            body=(
                f"Hola {user.name},\n\n"
                "Recibimos una solicitud para restablecer tu contraseña en EcuPlot. "
                "Puedes definir una nueva contraseña con el siguiente enlace durante la próxima hora:\n"
                f"{reset_link}\n\n"
                "Si no solicitaste este cambio, ignora este mensaje. Tu contraseña actual seguirá siendo válida.\n\n"
                "Equipo de EcuPlot"
            ),
        )
        mail.send(msg)
    except Exception as exc:
        current_app.logger.error(
            "No se pudo enviar correo de restablecimiento a %s: %s",
            user.email,
            exc,
        )


def _normalize_base32(secret):
    """Normaliza un secreto base32 añadiendo padding si es necesario."""
    value = (secret or '').strip().upper()
    padding = '=' * ((8 - len(value) % 8) % 8)
    return value + padding


def _totp_value(secret, timestamp):
    """Genera el código TOTP para un timestamp dado."""
    key = base64.b32decode(_normalize_base32(secret), casefold=True)
    counter = int(timestamp // TOTP_PERIOD)
    msg = struct.pack('>Q', counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = (struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7FFFFFFF) % (10 ** TOTP_DIGITS)
    return f'{code:0{TOTP_DIGITS}d}'


def _verify_totp_code(user, code):
    """Verifica si un código TOTP es válido para el usuario."""
    secret = getattr(user, 'totp_secret', None)
    candidate = str(code or '').strip()
    if not secret or not candidate.isdigit():
        return False
    now = time.time()
    for offset in (-1, 0, 1):
        value = _totp_value(secret, now + offset * TOTP_PERIOD)
        if value == candidate.zfill(TOTP_DIGITS):
            return True
    return False


def _verify_backup_code(user, code):
    """Verifica si un código de respaldo es válido para el usuario."""
    if not code:
        return None
    candidate = str(code).strip()
    codes = db.session.execute(
        db.select(TwoFactorBackupCode).where(
            TwoFactorBackupCode.user_id == user.id,
            TwoFactorBackupCode.used_at.is_(None),
        )
    ).scalars()
    for entry in codes:
        if bcrypt.check_password_hash(entry.code_hash, candidate):
            return entry
    return None


def _consume_backup_code(entry):
    """Marca un código de respaldo como usado."""
    entry.used_at = datetime.now(timezone.utc)
    db.session.add(entry)


def _verify_2fa_or_backup(user, code):
    """Verifica código TOTP o código de respaldo."""
    if _verify_totp_code(user, code):
        return True, None
    entry = _verify_backup_code(user, code)
    if entry:
        _consume_backup_code(entry)
        return True, entry
    return False, None


def _serialize_audit_entry(entry):
    """Serializa una entrada de auditoría para eventos."""
    if not entry:
        return {}

    user_payload = None
    if getattr(entry, "user", None) is not None:
        user_payload = {
            "id": str(entry.user.id),
            "email": entry.user.email,
            "name": entry.user.name,
        }
    elif entry.user_id:
        actor = db.session.get(Users, entry.user_id)
        if actor:
            user_payload = {
                "id": str(actor.id),
                "email": actor.email,
                "name": actor.name,
            }

    target_payload = None
    if entry.target_entity_type or entry.target_entity_id:
        target_payload = {
            "type": entry.target_entity_type,
            "id": str(entry.target_entity_id) if entry.target_entity_id else None,
        }

    return {
        "id": str(entry.id) if entry.id is not None else None,
        "action": entry.action,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
        "ip_address": entry.ip_address,
        "details": entry.details or {},
        "user": user_payload,
        "target": target_payload,
    }


def _queue_ops_event(payload):
    """Encola un evento de operaciones para notificar."""
    if not payload:
        return
    events = getattr(g, "_ops_audit_events", None)
    if events is None:
        events = []
        g._ops_audit_events = events
    events.append(payload)


def _record_audit(action, *, target_entity_type=None, target_entity_id=None, details=None):
    """Registra una entrada de auditoría y opcionalmente la encola como evento."""
    try:
        actor = getattr(getattr(g, "current_user", None), "id", None)
        payload = dict(details or {})
        entry = AuditLog(
            user_id=actor,
            action=action,
            target_entity_type=target_entity_type,
            target_entity_id=target_entity_id,
            details=payload,
            ip_address=request.headers.get('X-Forwarded-For') or request.remote_addr,
        )
        db.session.add(entry)
        db.session.flush([entry])
        try:
            db.session.refresh(entry)
        except Exception:
            pass
        if action in OPS_AUDIT_ACTIONS:
            serialized = _serialize_audit_entry(entry)
            if serialized:
                _queue_ops_event(serialized)
        return entry
    except Exception as exc:
        current_app.logger.warning("No se pudo registrar auditoría (%s): %s", action, exc)
        return None


# ============================================================================
# Rutas de autenticación
# ============================================================================

    return response


@api.post("/register")
def register_user():
    """Registro de nuevo usuario (envía correo de verificación)."""
    data = request.get_json(silent=True)
    if data is None:
        return jsonify(error="No se proporcionaron datos JSON."), 400

    if not isinstance(data, dict):
        return jsonify(error="Formato JSON inválido."), 400

    email = (data.get('email') or '').strip()
    password = (data.get('password') or '').strip()
    password_confirm = (data.get('password_confirm') or '').strip()
    terms = data.get('terms')
    raw_name = (data.get('name') or '').strip()
    requested_role = (data.get('role') or 'user').strip().lower()
    allowed_roles = {'user', 'student'}

    if not email or not password:
        return jsonify(error="Email y contraseña son requeridos."), 400

    strength_error = _password_strength_error(password)
    if strength_error:
        return jsonify(error=strength_error), 400

    if password != password_confirm:
        return jsonify(error="Las contraseñas no coinciden."), 400
    if not terms:
        return jsonify(error="Debes aceptar los términos y condiciones para registrarte."), 400

    name = raw_name
    if raw_name and len(raw_name) < 2:
        return jsonify(error="El nombre debe tener al menos 2 caracteres"), 400
    if not name:
        local_part = email.split('@')[0] if '@' in email else email
        name = local_part or "Usuario"

    if '@' not in email or len(email) < 5:
        return jsonify(error="Proporciona un email válido."), 400

    if requested_role not in allowed_roles:
        return jsonify(error="Rol inválido. Solo se permiten 'user' o 'student'."), 400

    existing_user = db.session.execute(
        db.select(Users).where(Users.email == email)
    ).scalar_one_or_none()
    
    if existing_user:
        return jsonify(error="El correo electrónico ya está registrado."), 409

    selected_role = db.session.execute(
        db.select(Roles).where(Roles.name == requested_role)
    ).scalar_one_or_none()
    
    if not selected_role:
        current_app.logger.error("Error crítico: No se encontró el rol '%s' en la DB.", requested_role)
        return jsonify(error="Error interno del servidor al configurar el usuario."), 500

    hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')

    token_value = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(hours=24)
    verification_link = url_for('api.verify_email', token=token_value, _external=True)
    sender = _resolve_mail_sender()
    if not sender:
        current_app.logger.error("Registro bloqueado: remitente de correo no configurado.")
        return jsonify(error=MAIL_SENDER_MISSING_ERROR), 503

    msg = Message(
        subject="¡Bienvenido a EcuPlot! Verifica tu correo.",
        sender=sender,
        recipients=[email]
    )
    msg.body = f"""¡Hola {name}! 

Gracias por registrarte en EcuPlot.

Para activar tu cuenta, por favor haz clic en el siguiente enlace:
{verification_link}

El enlace es válido por 24 horas.

Si no te registraste, por favor ignora este correo.

Saludos,
El equipo de EcuPlot
"""

    try:
        new_user = Users(
            email=email,
            name=name,
            password_hash=hashed_password,
            role_id=selected_role.id
        )
        new_user.roles.append(selected_role)
        db.session.add(new_user)

        verification_token = UserTokens(
            user=new_user,
            token=token_value,
            token_type='verify_email',
            expires_at=expires
        )
        db.session.add(verification_token)

        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al registrar usuario: {e}")
        return jsonify(error="No se pudo completar el registro, intente más tarde."), 500

    try:
        mail.send(msg)
        current_app.logger.info(f"Correo de verificación enviado exitosamente a {email}")
    except Exception as mail_exc:
        current_app.logger.error("No se pudo enviar el correo de verificación a %s: %s", email, mail_exc)

    return jsonify(
        message=f"Registro exitoso para {email}. Se ha enviado un correo de verificación."
    ), 201


@api.get("/verify-email")
def verify_email():
    """Verificación de correo por token."""
    token_value = request.args.get('token')
    if not token_value:
        return redirect(url_for('frontend.login_page', error='missing_token'))

    token_obj = db.session.execute(
        db.select(UserTokens).where(
            UserTokens.token == token_value,
            UserTokens.token_type == 'verify_email'
        )
    ).scalar_one_or_none()

    if not token_obj:
        return redirect(url_for('frontend.login_page', error='invalid_token'))
        
    if token_obj.used_at:
        return redirect(url_for('frontend.login_page', error='token_used'))

    expires_at = token_obj.expires_at
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if expires_at and expires_at < datetime.now(timezone.utc):
        return redirect(url_for('frontend.login_page', error='token_expired'))

    try:
        user = token_obj.user
        if user is None and token_obj.user_id:
            user = db.session.get(Users, token_obj.user_id)
        if user is None and token_obj.user_id:
            user = db.session.execute(
                db.select(Users).where(cast(Users.id, String) == str(token_obj.user_id))
            ).scalar_one_or_none()
        if user is None:
            raise AttributeError("Token sin usuario asociado")

        user.is_verified = True
        user.verified_at = datetime.now(timezone.utc)
        token_obj.used_at = datetime.now(timezone.utc)
        
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al verificar token: {e}")
        return redirect(url_for('frontend.login_page', error='verification_failed'))

    return redirect(url_for('frontend.login_page', verified='true'))


@api.post("/login")
def login_user():
    """Inicio de sesión: devuelve session_token y crea registro en user_sessions."""
    data = request.get_json()
    if not data:
        return jsonify(error="No se proporcionaron datos JSON."), 400

    email = _normalize_email(data.get('email'))
    password = (data.get('password') or '').strip()

    if not email or not password:
        return jsonify(error="Email y contraseña son requeridos."), 400

    user = db.session.execute(
        db.select(Users).where(
            Users.email == email,
            Users.deleted_at == None 
        )
    ).scalar_one_or_none()

    if not user:
        return jsonify(error="No encontramos una cuenta con ese correo."), 404 

    if user.locked_until:
        # Si la cuenta ya estaba bloqueada, reenvía enlace si no hay token activo.
        unlock_token = db.session.execute(
            db.select(UserTokens).where(
                UserTokens.user_id == user.id,
                UserTokens.token_type == 'account_unlock',
                UserTokens.used_at.is_(None)
            )
        ).scalar_one_or_none()

        token_expired = False
        if unlock_token and unlock_token.expires_at:
            expires_at = unlock_token.expires_at
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            else:
                expires_at = expires_at.astimezone(timezone.utc)
            token_expired = expires_at < datetime.now(timezone.utc)

        if not unlock_token or token_expired:
            unlock_token = _issue_user_token(user, 'account_unlock', ACCOUNT_UNLOCK_TOKEN_TTL)
            try:
                db.session.commit()
            except Exception as exc:
                db.session.rollback()
                current_app.logger.error("No se pudo refrescar token de desbloqueo: %s", exc)
                return jsonify(error="No se pudo generar un nuevo enlace de desbloqueo."), 500

        if unlock_token:
            unlock_link = url_for('api.unlock_account', token=unlock_token.token, _external=True)
            _send_lockout_notification(user, unlock_link)

        return jsonify(error="Tu cuenta está bloqueada. Revisa tu correo para desbloquearla."), 423

    if not user.is_verified:
        return jsonify(error="Tu cuenta no ha sido verificada. Por favor, revisa tu correo."), 403 

    if not bcrypt.check_password_hash(user.password_hash, password):
        user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
        locked = False
        unlock_token = None
        failed_attempts = user.failed_login_attempts

        if user.failed_login_attempts >= MAX_FAILED_LOGIN_ATTEMPTS:
            user.locked_until = datetime.now(timezone.utc)
            user.failed_login_attempts = 0
            locked = True
            unlock_token = _issue_user_token(user, 'account_unlock', ACCOUNT_UNLOCK_TOKEN_TTL)

        _record_audit(
            "auth.login.failed",
            target_entity_type="user",
            target_entity_id=user.id,
            details={
                "email": email,
                "failed_attempts": int(failed_attempts),
                "locked": locked,
            },
        )

        try:
            db.session.commit()
        except Exception as exc:
            db.session.rollback()
            current_app.logger.error("No se pudo registrar intento de login fallido: %s", exc)
            return jsonify(error="Error interno al procesar la solicitud."), 500

        if locked and unlock_token:
            _record_audit(
                "auth.account.locked",
                target_entity_type="user",
                target_entity_id=user.id,
                details={"email": email},
            )
            unlock_link = url_for('api.unlock_account', token=unlock_token.token, _external=True)
            _send_lockout_notification(user, unlock_link)
            try:
                create_notification(
                    user.id,
                    category="security",
                    title="Cuenta bloqueada por seguridad",
                    body="Detectamos múltiples intentos fallidos. Revisa tu correo para desbloquear la cuenta.",
                    payload={
                        "email": email,
                        "unlock_token": unlock_token.token,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    },
                )
                db.session.commit()
            except Exception as exc:
                db.session.rollback()
                current_app.logger.warning("No se pudo registrar notificación de bloqueo: %s", exc)
            return jsonify(error="Tu cuenta fue bloqueada por intentos fallidos. Revisa tu correo para desbloquearla."), 423

        return jsonify(error="Contraseña incorrecta."), 401 

    backup_entry = None
    if user.is_2fa_enabled:
        otp_code = (data.get('otp') or data.get('otp_code') or data.get('code') or '').strip()
        if not otp_code:
            return jsonify(error="Se requiere el código de autenticación en dos pasos.", requires_2fa=True), 401

        valid, backup_entry = _verify_2fa_or_backup(user, otp_code)
        if not valid:
            return jsonify(error="Código de verificación inválido.", requires_2fa=True), 401

    session_token = secrets.token_urlsafe(64)
    expires = datetime.now(timezone.utc) + timedelta(days=7)

    user.failed_login_attempts = 0
    user.locked_until = None

    new_session = UserSessions(
        session_token=session_token,
        user_id=user.id,
        expires_at=expires,
        ip_address=request.remote_addr,
        user_agent=request.user_agent.string
    )

    try:
        db.session.add(new_session)
        db.session.flush([new_session])
        session_identifier = getattr(new_session, "session_token", None)
        session_fingerprint = None
        if session_identifier and len(session_identifier) >= 8:
            session_fingerprint = f"{session_identifier[:4]}…{session_identifier[-4:]}"
        audit_details = {
            "session_id": session_identifier,
            "used_backup_code": bool(backup_entry),
        }
        if session_fingerprint:
            audit_details["session_id_hint"] = session_fingerprint

        _record_audit(
            "auth.login.succeeded",
            target_entity_type="user",
            target_entity_id=user.id,
            details=audit_details,
        )
        payload = {
            "ip": request.remote_addr,
            "user_agent": request.user_agent.string if request.user_agent else None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        if session_fingerprint:
            payload["session_id_hint"] = session_fingerprint

        create_notification(
            user.id,
            category="security",
            title="Nuevo inicio de sesión",
            body=f"Se inició sesión desde {request.remote_addr or 'origen desconocido'}.",
            payload=payload,
        )
        db.session.commit()

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al crear sesión: {e}")
        return jsonify(error="Error interno al iniciar sesión."), 500

    response = jsonify(
        message=f"Inicio de sesión exitoso para {user.email}",
        session_token=session_token,
        user_id=user.id,
    )

    max_age = int(timedelta(days=7).total_seconds())
    runtime_env = (current_app.config.get("APP_ENV") or current_app.config.get("ENV") or "production").lower()
    secure_default = runtime_env == "production"
    secure_cookie = bool(current_app.config.get("SESSION_COOKIE_SECURE", secure_default))

    response.set_cookie(
        "session_token",
        session_token,
        max_age=max_age,
        httponly=True,
        secure=secure_cookie,
        samesite="Lax",
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    return response, 200


@api.get("/unlock-account")
def unlock_account():
    """Desbloquea una cuenta usando un token de desbloqueo."""
    token_value = request.args.get('token', '').strip()
    if not token_value:
        return redirect(url_for('frontend.serve_frontend', unlock='missing'))

    token_obj = db.session.execute(
        db.select(UserTokens).where(
            UserTokens.token == token_value,
            UserTokens.token_type == 'account_unlock'
        )
    ).scalar_one_or_none()

    if not token_obj:
        return redirect(url_for('frontend.serve_frontend', unlock='invalid'))

    if token_obj.used_at:
        return redirect(url_for('frontend.serve_frontend', unlock='used'))

    expires_at = token_obj.expires_at
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if expires_at and expires_at < datetime.now(timezone.utc):
        return redirect(url_for('frontend.serve_frontend', unlock='expired'))

    try:
        user = token_obj.user
        if user is None and token_obj.user_id:
            user = db.session.get(Users, token_obj.user_id)
        if user is None:
            raise AttributeError("Token sin usuario asociado")

        user.locked_until = None
        user.failed_login_attempts = 0
        token_obj.used_at = datetime.now(timezone.utc)

        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("No se pudo desbloquear la cuenta: %s", exc)
        return redirect(url_for('frontend.serve_frontend', unlock='error'))

    return redirect(url_for('frontend.serve_frontend', unlock='success'))


@api.post("/password/forgot")
def request_password_reset():
    """Solicita un restablecimiento de contraseña."""
    data = request.get_json(silent=True) or {}
    email = _normalize_email(data.get('email'))

    if not email:
        return jsonify(error="Debes proporcionar un correo."), 400

    user = db.session.execute(
        db.select(Users).where(
            Users.email == email,
            Users.deleted_at == None
        )
    ).scalar_one_or_none()

    if not user:
        # Respuesta genérica para no exponer existencia de cuentas.
        return jsonify(message="Si existe una cuenta con ese correo, enviaremos instrucciones para restablecer la contraseña."), 200

    reset_token = _issue_user_token(user, 'password_reset', PASSWORD_RESET_TOKEN_TTL)

    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("No se pudo generar token de restablecimiento: %s", exc)
        return jsonify(error="No se pudo generar el enlace de restablecimiento."), 500

    reset_link = url_for('frontend.reset_password_page', token=reset_token.token, _external=True)
    _send_password_reset_email(user, reset_link)

    return jsonify(message="Si existe una cuenta con ese correo, enviaremos instrucciones para restablecer la contraseña."), 200


@api.post("/password/reset")
def reset_password():
    """Restablece la contraseña usando un token válido."""
    data = request.get_json(silent=True) or {}
    token_value = (data.get('token') or '').strip()
    password = (data.get('password') or '').strip()
    password_confirm = (data.get('password_confirm') or '').strip()

    if not token_value:
        return jsonify(error="Token de restablecimiento requerido."), 400
    if not password:
        return jsonify(error="Debes ingresar una nueva contraseña."), 400

    strength_error = _password_strength_error(password)
    if strength_error:
        return jsonify(error=strength_error), 400

    if password != password_confirm:
        return jsonify(error="Las contraseñas no coinciden."), 400

    token_obj = db.session.execute(
        db.select(UserTokens).where(
            UserTokens.token == token_value,
            UserTokens.token_type == 'password_reset'
        )
    ).scalar_one_or_none()

    if not token_obj:
        return jsonify(error="El enlace de restablecimiento no es válido."), 400

    if token_obj.used_at:
        return jsonify(error="El enlace de restablecimiento ya fue utilizado."), 400

    expires_at = token_obj.expires_at
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if expires_at and expires_at < datetime.now(timezone.utc):
        return jsonify(error="El enlace de restablecimiento ha expirado."), 400

    try:
        user = token_obj.user
        if user is None and token_obj.user_id:
            user = db.session.get(Users, token_obj.user_id)
        if user is None:
            raise AttributeError("Token sin usuario asociado")

        new_hash = bcrypt.generate_password_hash(password).decode('utf-8')
        user.password_hash = new_hash
        user.failed_login_attempts = 0
        user.locked_until = None

        token_obj.used_at = datetime.now(timezone.utc)

        # Invalidar otros tokens de restablecimiento pendientes.
        db.session.execute(
            delete(UserTokens).where(
                UserTokens.user_id == user.id,
                UserTokens.token_type == 'password_reset',
                UserTokens.used_at.is_(None),
                UserTokens.token != token_obj.token,
            )
        )

        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("No se pudo restablecer la contraseña: %s", exc)
        return jsonify(error="No se pudo restablecer la contraseña en este momento."), 500

    return jsonify(message="Tu contraseña fue actualizada. Ya puedes iniciar sesión."), 200


@api.post("/logout")
@require_session
def logout_user():
    """Cierra la sesión actual (revoca el token usado en la petición)."""
    try:
        db.session.delete(g.current_session)
        db.session.commit()
        response = jsonify(message="Sesión cerrada.")
        response.delete_cookie("session_token", path="/")
        return response, 200
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al cerrar sesión: {e}")
        return jsonify(error="No se pudo cerrar la sesión."), 500


@api.get("/user/me")
@require_session
def get_current_user_details():
    """
    Devuelve los detalles del usuario actualmente autenticado.
    Usa el decorador @require_session que puebla g.current_user.
    """  
  
    user = g.current_user 

    backup_count = (
        db.session.query(func.count(TwoFactorBackupCode.id))
        .filter(
            TwoFactorBackupCode.user_id == user.id,
            TwoFactorBackupCode.used_at.is_(None),
        )
        .scalar()
        or 0
    )

    return jsonify({
        "id": str(user.id),
        "name": user.name,
        "email": user.email,
        "role": user.role.name,  
        "roles": [r.name for r in user.roles],
        "public_id": user.public_id,
        "is_verified": user.is_verified,
        "created_at": user.created_at.isoformat(),
        "two_factor_enabled": bool(getattr(user, "is_2fa_enabled", False)),
        "two_factor_backup_codes": int(backup_count),
    }), 200
