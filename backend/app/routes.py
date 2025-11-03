import base64
import csv
import hmac
import hashlib
import io
import math
import re
import secrets
import string
import struct
import time
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from flask import (
    Blueprint,
    current_app,
    flash,
    get_flashed_messages,
    jsonify,
    render_template,
    request,
    redirect,
    send_from_directory,
    url_for,
    g,
)
from .extensions import db, bcrypt, mail
from .models import (
    Users,
    Roles,
    UserTokens,
    UserSessions,
    PlotHistory,
    PlotHistoryTags,
    StudentGroup,
    GroupMember,
    RoleRequest,
    RequestTicket,
    TwoFactorBackupCode,
    Tags,
    AuditLog,
    user_roles_table,
)
from .plot_tags import apply_tags_to_history, classify_expression
from flask_mail import Message
from sqlalchemy import and_, asc, desc, func, cast, String, or_, delete
from sqlalchemy.orm import selectinload
from urllib.parse import quote

import qrcode

from .backup import BackupError, RestoreError, run_backup, restore_backup

from .auth import require_session

# --- Blueprints ---
api = Blueprint("api", __name__)
frontend = Blueprint("frontend", __name__)

MAX_FAILED_LOGIN_ATTEMPTS = 3
ACCOUNT_UNLOCK_TOKEN_TTL = timedelta(hours=24)
PASSWORD_RESET_TOKEN_TTL = timedelta(hours=1)
PASSWORD_POLICY_MESSAGE = (
    "La contraseña debe tener al menos 8 caracteres, con una letra mayúscula, "
    "una letra minúscula, un número y un carácter especial."
)


def _password_strength_error(password: str | None) -> str | None:
    if not password:
        return PASSWORD_POLICY_MESSAGE
    if len(password) < 8:
        return PASSWORD_POLICY_MESSAGE
    if not re.search(r"[A-Z]", password):
        return PASSWORD_POLICY_MESSAGE
    if not re.search(r"[a-z]", password):
        return PASSWORD_POLICY_MESSAGE
    if not re.search(r"\d", password):
        return PASSWORD_POLICY_MESSAGE
    if not re.search(r"[^\w\s]", password):
        return PASSWORD_POLICY_MESSAGE
    return None


def _normalize_email(value):
    return (value or "").strip().lower()


def _issue_user_token(user, token_type, expires_delta):
    """Crea un token único para el usuario, reemplazando los anteriores del mismo tipo."""
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


def _validate_contact_submission(name, email, message):
    errors = {}
    if len(name) < 2:
        errors['name'] = 'Ingresa tu nombre (mínimo 2 caracteres).'
    if not email or '@' not in email:
        errors['email'] = 'Proporciona un correo válido.'
    if len(message) < 10:
        errors['message'] = 'El mensaje debe tener al menos 10 caracteres.'
    return errors


def _send_contact_notification(name, email, message):
    recipient = current_app.config.get('CONTACT_RECIPIENT')
    sender = current_app.config.get('MAIL_DEFAULT_SENDER') or current_app.config.get('MAIL_USERNAME')

    if not recipient or not sender:
        current_app.logger.info('Contacto recibido sin destinatario configurado: %s <%s>', name, email)
        return None

    try:
        msg = Message(
            subject='Nuevo contacto de EcuPlot',
            sender=sender,
            recipients=[recipient],
            body=f"Nombre: {name}\nEmail: {email}\n\n{message}",
        )
        mail.send(msg)
    except Exception as exc:
        current_app.logger.error('No se pudo reenviar el contacto: %s', exc)
        return 'No se pudo enviar el mensaje en este momento.'
    return None


DEFAULT_HISTORY_PAGE_SIZE = 20
MIN_HISTORY_PAGE_SIZE = 10
MAX_HISTORY_PAGE_SIZE = 100
HISTORY_EXPORT_LIMIT = 5000
TICKET_MIN_PAGE_SIZE = 5
TICKET_MAX_PAGE_SIZE = 20
TICKET_ALLOWED_TYPES = {'soporte', 'rol', 'consulta', 'otro'}
TICKET_ALLOWED_STATUS = {'pendiente', 'atendida', 'rechazada'}
TOTP_ISSUER = 'EcuPlot'
BACKUP_CODE_COUNT = 8
TOTP_PERIOD = 30
TOTP_DIGITS = 6


def _parse_iso_datetime(value: str | None, *, end: bool = False):
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


def _history_query_params():
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
    date_from = _parse_iso_datetime(args.get("from"))
    date_to = _parse_iso_datetime(args.get("to"), end=True)

    tags_param = args.get("tags") or ""
    tags = [tag.strip() for tag in tags_param.split(",") if tag.strip()]

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
    }


def _build_history_query(params):
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


def _serialize_history_item(row: PlotHistory):
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


def _notify_ticket_status_change(ticket, previous_status=None):
    try:
        current_app.logger.info(
            'Ticket %s status change: %s -> %s',
            getattr(ticket, 'id', 'unknown'),
            previous_status or 'nuevo',
            getattr(ticket, 'status', 'desconocido'),
        )
    except Exception:
        pass


def _ticket_query_params():
    args = request.args

    def _read_int(name, default):
        try:
            return int(args.get(name, default))
        except (TypeError, ValueError):
            return default

    page = _read_int('page', 1)
    if page < 1:
        page = 1

    page_size = _read_int('page_size', TICKET_MIN_PAGE_SIZE)
    page_size = max(TICKET_MIN_PAGE_SIZE, min(page_size, TICKET_MAX_PAGE_SIZE))

    status = (args.get('status') or '').strip().lower()
    if status and status not in TICKET_ALLOWED_STATUS:
        status = None

    return {
        'page': page,
        'page_size': page_size,
        'offset': (page - 1) * page_size,
        'status': status,
    }


def _serialize_ticket(ticket: RequestTicket):
    return {
        'id': str(ticket.id),
        'type': ticket.type,
        'title': ticket.title,
        'description': ticket.description,
        'status': ticket.status,
        'created_at': ticket.created_at.isoformat() if ticket.created_at else None,
        'updated_at': ticket.updated_at.isoformat() if ticket.updated_at else None,
    }


def _generate_backup_codes(count=BACKUP_CODE_COUNT):
    alphabet = string.ascii_uppercase + string.digits
    codes = []
    for _ in range(count):
        code = ''.join(secrets.choice(alphabet) for _ in range(10))
        codes.append(code)
    return codes


def _store_backup_codes(user, codes):
    db.session.execute(
        delete(TwoFactorBackupCode).where(TwoFactorBackupCode.user_id == user.id)
    )
    for code in codes:
        hashed = bcrypt.generate_password_hash(code).decode('utf-8')
        db.session.add(TwoFactorBackupCode(user_id=user.id, code_hash=hashed))


def _normalize_base32(secret):
    value = (secret or '').strip().upper()
    padding = '=' * ((8 - len(value) % 8) % 8)
    return value + padding


def _generate_totp_secret():
    return base64.b32encode(secrets.token_bytes(20)).decode('utf-8').rstrip('=')


def _totp_value(secret, timestamp):
    key = base64.b32decode(_normalize_base32(secret), casefold=True)
    counter = int(timestamp // TOTP_PERIOD)
    msg = struct.pack('>Q', counter)
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    code = (struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7FFFFFFF) % (10 ** TOTP_DIGITS)
    return f'{code:0{TOTP_DIGITS}d}'


def _verify_totp_code(user, code):
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
    entry.used_at = datetime.now(timezone.utc)
    db.session.add(entry)


def _build_otpauth_url(user, secret):
    label_name = user.email or user.public_id or 'usuario'
    label = quote(f"{TOTP_ISSUER}:{label_name}")
    issuer = quote(TOTP_ISSUER)
    return f'otpauth://totp/{label}?secret={secret}&issuer={issuer}&digits={TOTP_DIGITS}&period={TOTP_PERIOD}'


def _require_roles(allowed):
    allowed_norm = {r.lower() for r in allowed}
    user_roles = {
        (role.name or '').lower()
        for role in getattr(g.current_user, 'roles', []) or []
    }
    primary_role = getattr(getattr(g.current_user, 'role', None), 'name', None)
    if primary_role:
        user_roles.add(primary_role.lower())

    if user_roles.intersection(allowed_norm):
        return None
    return jsonify(error="No tienes permisos para realizar esta acción."), 403


def _assign_teacher_role(user):
    teacher_role = _get_role_by_name('teacher')
    if not teacher_role:
        current_app.logger.error("Rol 'teacher' no encontrado al intentar asignar desde admin.")
        return jsonify(error="Rol 'teacher' no configurado en el sistema."), 500

    if teacher_role not in user.roles:
        user.roles.append(teacher_role)
    user.role_id = teacher_role.id

    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("Error al asignar rol teacher: %s", exc)
        return jsonify(error="No se pudo asignar el rol."), 500

    return jsonify(
        message="Rol 'teacher' asignado.",
        user={
            "id": str(user.id),
            "name": user.name,
            "roles": [r.name for r in user.roles],
            "primary_role": user.role.name if user.role else None,
            "public_id": user.public_id,
        },
    )


def _require_teacher():
    return _require_roles({'teacher'})


def _require_admin_or_dev():
    return _require_roles({'admin', 'development'})


def _get_role_by_name(name):
    return db.session.execute(
        db.select(Roles).where(Roles.name == name)
    ).scalar_one_or_none()


def _send_lockout_notification(user, unlock_link):
    """Notifica al usuario que su cuenta quedó bloqueada y cómo desbloquearla."""
    sender = current_app.config.get('MAIL_DEFAULT_SENDER') or current_app.config.get('MAIL_USERNAME')
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
    sender = current_app.config.get('MAIL_DEFAULT_SENDER') or current_app.config.get('MAIL_USERNAME')
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


def _notify_role_request_created(user, role_request):
    """Notifica al equipo cuando se registra una solicitud de rol administrador."""
    configured = current_app.config.get('ROLE_REQUEST_RECIPIENTS') or current_app.config.get('CONTACT_RECIPIENTS')
    if isinstance(configured, str):
        recipients = [configured]
    else:
        recipients = list(configured or [])

    recipients = [r for r in recipients if r]
    if not recipients:
        current_app.logger.info(
            "Solicitud de rol registrada pero sin destinatarios configurados (usuario: %s).",
            user.email,
        )
        return

    sender = current_app.config.get('MAIL_DEFAULT_SENDER') or current_app.config.get('MAIL_USERNAME')
    if not sender:
        current_app.logger.warning(
            "No se pudo notificar solicitud de rol: remitente no configurado (usuario: %s).",
            user.email,
        )
        return

    created_at = role_request.created_at
    if created_at and created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    created_label = created_at.isoformat() if created_at else datetime.now(timezone.utc).isoformat()

    roles = sorted({(r.name or '').strip() or 'sin rol' for r in getattr(user, 'roles', [])})
    role_list = ', '.join(roles) if roles else 'sin roles adicionales'

    body = (
        "Se registró una nueva solicitud para otorgar el rol 'admin'.\n\n"
        f"Usuario: {user.name} <{user.email}>\n"
        f"ID visible: {user.public_id}\n"
        f"ID interno: {user.id}\n"
        f"Roles actuales: {role_list}\n"
        f"Fecha de solicitud: {created_label}\n"
        f"Notas del solicitante: {role_request.notes or 'Sin notas adicionales.'}\n"
        f"ID solicitud: {role_request.id}\n"
    )

    try:
        msg = Message(
            subject="Nueva solicitud de rol administrador",
            sender=sender,
            recipients=recipients,
            body=body,
        )
        mail.send(msg)
    except Exception as exc:
        current_app.logger.error(
            "No se pudo enviar la notificación de solicitud de rol (usuario: %s): %s",
            user.email,
            exc,
        )


# --- Rutas del Frontend ---
@frontend.get("/")
def serve_frontend():
    """Sirve el index.html principal."""
    return send_from_directory(current_app.template_folder, "index.html")

@frontend.get("/graph")
def graph():
    # sirve /graph y /graph.html -> graph.html
    return send_from_directory(current_app.template_folder, "graph.html")

@frontend.get("/account")
def account():
    # sirve /account -> account.html
    return send_from_directory(current_app.template_folder, "account.html")


@frontend.get("/reset-password")
def reset_password_page():
    return send_from_directory(current_app.template_folder, "reset-password.html")


@frontend.get("/login")
def login_page():
    return send_from_directory(current_app.template_folder, "login.html")


@frontend.get("/signup")
def signup_page():
    return send_from_directory(current_app.template_folder, "signup.html")


@frontend.post("/contact")
def contact_form_submit():
    """Procesa el formulario de contacto cuando el usuario no tiene JavaScript."""
    name = (request.form.get('name') or '').strip()
    email = _normalize_email(request.form.get('email'))
    message = (request.form.get('message') or '').strip()
    form_snapshot = {"name": name, "email": email, "message": message}

    errors = _validate_contact_submission(name, email, message)
    if errors:
        flash(
            {
                "success": False,
                "message": "No pudimos enviar tu mensaje. Revisa los campos señalados e inténtalo de nuevo.",
                "errors": list(errors.values()),
                "form": form_snapshot,
                "status_code": 400,
            },
            "contact-feedback",
        )
        return redirect(url_for('frontend.contact_feedback', status='error'))

    delivery_error = _send_contact_notification(name, email, message)
    if delivery_error:
        flash(
            {
                "success": False,
                "message": delivery_error,
                "errors": [],
                "form": form_snapshot,
                "status_code": 502,
            },
            "contact-feedback",
        )
        return redirect(url_for('frontend.contact_feedback', status='error'))

    flash(
        {
            "success": True,
            "message": "Mensaje enviado. Gracias por escribirnos.",
            "errors": [],
            "form": {"name": "", "email": "", "message": ""},
            "status_code": 200,
        },
        "contact-feedback",
    )
    return redirect(url_for('frontend.contact_feedback', status='ok'))


@frontend.get("/contact/resultado")
def contact_feedback():
    """Muestra los mensajes resultantes del envío clásico del formulario de contacto."""
    feedback = get_flashed_messages(category_filter=["contact-feedback"])
    payload = feedback[-1] if feedback else None
    if not isinstance(payload, dict):
        return redirect(url_for('frontend.serve_frontend'))

    status_code = int(payload.get("status_code") or 200)
    return (
        render_template(
            "contact-result.html",
            success=bool(payload.get("success")),
            message=payload.get("message") or "",
            errors=list(payload.get("errors") or []),
            form=payload.get("form") or {},
        ),
        status_code,
    )

# --- Rutas de la API ---

@api.get("/health")
def health_check():
    """Endpoint básico de salud (para frontend)."""
    try:
        db.session.execute(db.select(1))
        return jsonify(status="ok", db_status="connected")
    except Exception as e:
        current_app.logger.error(f"Error de conexión a DB: {e}")
        return jsonify(status="ok", db_status="error"), 500


@api.post("/contact")
def contact_message():
    """Recibe mensajes del formulario de contacto del landing."""
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    email = _normalize_email(data.get('email'))
    message = (data.get('message') or '').strip()

    errors = _validate_contact_submission(name, email, message)
    if errors:
        return jsonify(error="Datos inválidos", fields=errors), 400

    delivery_error = _send_contact_notification(name, email, message)
    if delivery_error:
        return jsonify(error=delivery_error), 502

    return jsonify(message='Mensaje enviado. Gracias por escribirnos.'), 200

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
    sender = current_app.config.get('MAIL_DEFAULT_SENDER') or current_app.config.get('MAIL_USERNAME')

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
        return redirect(url_for('frontend.serve_frontend', error='missing_token'))

    token_obj = db.session.execute(
        db.select(UserTokens).where(
            UserTokens.token == token_value,
            UserTokens.token_type == 'verify_email'
        )
    ).scalar_one_or_none()

    if not token_obj:
        return redirect(url_for('frontend.serve_frontend', error='invalid_token'))
        
    if token_obj.used_at:
        return redirect(url_for('frontend.serve_frontend', error='token_used'))

    expires_at = token_obj.expires_at
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if expires_at and expires_at < datetime.now(timezone.utc):
        return redirect(url_for('frontend.serve_frontend', error='token_expired'))

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
        return redirect(url_for('frontend.serve_frontend', error='verification_failed'))

    return redirect(url_for('frontend.serve_frontend', verified='true'))

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

        if not unlock_token or (
            unlock_token.expires_at and unlock_token.expires_at < datetime.now(timezone.utc)
        ):
            unlock_token = _issue_user_token(user, 'account_unlock', ACCOUNT_UNLOCK_TOKEN_TTL)
            try:
                db.session.commit()
            except Exception as exc:
                db.session.rollback()
                current_app.logger.error("No se pudo refrescar token de desbloqueo: %s", exc)
            else:
                unlock_link = url_for('api.unlock_account', token=unlock_token.token, _external=True)
                _send_lockout_notification(user, unlock_link)

        return jsonify(error="Tu cuenta está bloqueada. Revisa tu correo para desbloquearla."), 423

    if not user.is_verified:
        return jsonify(error="Tu cuenta no ha sido verificada. Por favor, revisa tu correo."), 403 

    if not bcrypt.check_password_hash(user.password_hash, password):
        user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
        locked = False
        unlock_token = None

        if user.failed_login_attempts >= MAX_FAILED_LOGIN_ATTEMPTS:
            user.locked_until = datetime.now(timezone.utc)
            user.failed_login_attempts = 0
            locked = True
            unlock_token = _issue_user_token(user, 'account_unlock', ACCOUNT_UNLOCK_TOKEN_TTL)

        try:
            db.session.commit()
        except Exception as exc:
            db.session.rollback()
            current_app.logger.error("No se pudo registrar intento de login fallido: %s", exc)
            return jsonify(error="Error interno al procesar la solicitud."), 500

        if locked and unlock_token:
            unlock_link = url_for('api.unlock_account', token=unlock_token.token, _external=True)
            _send_lockout_notification(user, unlock_link)
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
        db.session.commit()

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al crear sesión: {e}")
        return jsonify(error="Error interno al iniciar sesión."), 500

    return jsonify(
        message=f"Inicio de sesión exitoso para {user.email}",
        session_token=session_token,
        user_id=user.id
    ), 200

@api.get("/unlock-account")
def unlock_account():
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

# Cerrar sesión 
@api.post("/logout")
@require_session
def logout_user():
    """Cierra la sesión actual (revoca el token usado en la petición)."""
    try:
        db.session.delete(g.current_session)
        db.session.commit()
        return jsonify(message="Sesión cerrada."), 200
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

    return jsonify({
        "id": str(user.id),
        "name": user.name,
        "email": user.email,
        "role": user.role.name,  
        "roles": [r.name for r in user.roles],
        "public_id": user.public_id,
        "is_verified": user.is_verified,
        "created_at": user.created_at.isoformat()
    }), 200

# Plot: guardar (1 o varias) 
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
    raw_tags = data.get('tags')

    provided_tags: list[str] = []
    if isinstance(raw_tags, (list, tuple, set)):
        provided_tags = [str(tag) for tag in raw_tags if str(tag).strip()]
    elif isinstance(raw_tags, str):
        tag = raw_tags.strip()
        if tag:
            provided_tags = [tag]

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
            tag_candidates = set(classify_expression(expr))
            if provided_tags:
                tag_candidates.update(provided_tags)
            apply_tags_to_history(item, tag_candidates, session=db.session)
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
        return jsonify(
            message="Expresiones guardadas en historial.",
            saved=len(items),
            items=response_items
        ), 201
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al guardar plot_history: {e}")
        return jsonify(error="No se pudo guardar el historial."), 500

# Historial: listar (paginado + filtro) 
@api.get("/plot/history")
@require_session
def plot_history_list():
    """
    Lista el historial del usuario autenticado.
    Query params:
      - limit: int (por defecto 50, máx 200)
      - offset: int (por defecto 0)
      - q: texto a buscar dentro de 'expression' (opcional, case-insensitive)
    """
    params = _history_query_params()
    query = _build_history_query(params)

    total = query.count()
    total_pages = math.ceil(total / params["page_size"]) if total else 0

    rows = []
    if total and params["offset"] < total:
        order_clause = asc(PlotHistory.created_at) if params["order"] == "asc" else desc(PlotHistory.created_at)
        rows = (
            query.order_by(order_clause, desc(PlotHistory.id))
            .offset(params["offset"])
            .limit(params["page_size"])
            .all()
        )

    data = [_serialize_history_item(row) for row in rows]

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


@api.get("/plot/history/export")
@require_session
def export_plot_history():
    params = _history_query_params()
    fmt = (request.args.get("format") or "csv").strip().lower()
    if fmt not in {"csv", "json"}:
        return jsonify(error="Formato no soportado. Usa 'csv' o 'json'."), 400

    query = _build_history_query(params)
    total = query.count()
    order_clause = asc(PlotHistory.created_at) if params["order"] == "asc" else desc(PlotHistory.created_at)

    limit = HISTORY_EXPORT_LIMIT
    rows = (
        query.order_by(order_clause, desc(PlotHistory.id))
        .limit(limit)
        .all()
    )

    data = [_serialize_history_item(row) for row in rows]
    truncated = total > len(data)
    generated_at = datetime.now(timezone.utc).strftime("%Y%m%d")

    if fmt == "json":
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

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["id", "uuid", "expression", "tags", "created_at", "deleted"])
    for item in data:
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
    buffer.seek(0)

    response = current_app.response_class(buffer.getvalue(), mimetype="text/csv")
    response.headers["Content-Disposition"] = f'attachment; filename=plot-history-{generated_at}.csv'
    if truncated:
        response.headers["X-Export-Truncated"] = "1"
    return response


@api.post("/account/requests")
@require_session
def create_request_ticket():
    data = request.get_json(silent=True) or {}
    ticket_type = (data.get('type') or '').strip().lower()
    title = (data.get('title') or '').strip()
    description = (data.get('description') or '').strip()

    errors = {}
    if not ticket_type or ticket_type not in TICKET_ALLOWED_TYPES:
        errors['type'] = 'Selecciona un tipo válido.'
    if len(title) < 4:
        errors['title'] = 'El título debe tener al menos 4 caracteres.'
    if len(description) < 10:
        errors['description'] = 'Describe tu solicitud con un poco más de detalle.'

    if errors:
        return jsonify(error='Datos inválidos', fields=errors), 400

    ticket = RequestTicket(
        user_id=g.current_user.id,
        type=ticket_type,
        title=title,
        description=description,
        status='pendiente',
    )
    db.session.add(ticket)
    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error('No se pudo crear el ticket: %s', exc)
        return jsonify(error='No se pudo registrar tu solicitud.'), 500

    _notify_ticket_status_change(ticket)
    return jsonify(message='Solicitud registrada.', ticket=_serialize_ticket(ticket)), 201


@api.get("/account/requests")
@require_session
def list_request_tickets():
    params = _ticket_query_params()

    query = db.session.query(RequestTicket).filter(RequestTicket.user_id == g.current_user.id)
    if params['status']:
        query = query.filter(RequestTicket.status == params['status'])

    total = query.count()
    rows = (
        query.order_by(desc(RequestTicket.created_at))
        .offset(params['offset'])
        .limit(params['page_size'])
        .all()
    )

    total_pages = math.ceil(total / params['page_size']) if total else 0
    data = [_serialize_ticket(row) for row in rows]

    return jsonify(
        {
            'data': data,
            'meta': {
                'page': params['page'],
                'page_size': params['page_size'],
                'total': total,
                'total_pages': total_pages,
                'status': params['status'],
            },
        }
    )


@api.get("/account/2fa/status")
@require_session
def two_factor_status():
    backup_count = (
        db.session.query(func.count(TwoFactorBackupCode.id))
        .filter(
            TwoFactorBackupCode.user_id == g.current_user.id,
            TwoFactorBackupCode.used_at.is_(None),
        )
        .scalar()
        or 0
    )
    return jsonify(
        enabled=bool(g.current_user.is_2fa_enabled),
        has_backup_codes=backup_count > 0,
    )


@api.post("/account/2fa/setup")
@require_session
def two_factor_setup():
    secret = _generate_totp_secret()
    g.current_user.totp_secret = secret
    g.current_user.is_2fa_enabled = False
    _store_backup_codes(g.current_user, [])

    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error('No se pudo preparar 2FA: %s', exc)
        return jsonify(error='No se pudo generar la configuración de 2FA.'), 500

    otpauth = _build_otpauth_url(g.current_user, secret)
    return jsonify(secret=secret, otpauth_url=otpauth)


@api.post("/account/2fa/enable")
@require_session
def two_factor_enable():
    data = request.get_json(silent=True) or {}
    code = (data.get('code') or data.get('otp') or '').strip()

    if not _verify_totp_code(g.current_user, code):
        return jsonify(error='El código proporcionado no es válido.'), 400

    backup_codes = _generate_backup_codes()
    _store_backup_codes(g.current_user, backup_codes)
    g.current_user.is_2fa_enabled = True

    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error('No se pudo activar 2FA: %s', exc)
        return jsonify(error='No se pudo activar la autenticación de dos pasos.'), 500

    return jsonify(message='Autenticación en dos pasos activada.', backup_codes=backup_codes)


def _verify_2fa_or_backup(user, code):
    if _verify_totp_code(user, code):
        return True, None
    entry = _verify_backup_code(user, code)
    if entry:
        _consume_backup_code(entry)
        return True, entry
    return False, None


@api.post("/account/2fa/disable")
@require_session
def two_factor_disable():
    data = request.get_json(silent=True) or {}
    code = (data.get('code') or '').strip()

    valid, _ = _verify_2fa_or_backup(g.current_user, code)
    if not valid:
        return jsonify(error='El código proporcionado no es válido.'), 400

    g.current_user.is_2fa_enabled = False
    g.current_user.totp_secret = None
    _store_backup_codes(g.current_user, [])

    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error('No se pudo desactivar 2FA: %s', exc)
        return jsonify(error='No se pudo desactivar la autenticación en dos pasos.'), 500

    return jsonify(message='Autenticación en dos pasos desactivada.')


@api.post("/account/2fa/backup-codes/regenerate")
@require_session
def regenerate_backup_codes():
    data = request.get_json(silent=True) or {}
    code = (data.get('code') or '').strip()

    valid, _ = _verify_2fa_or_backup(g.current_user, code)
    if not valid:
        return jsonify(error='El código proporcionado no es válido.'), 400

    new_codes = _generate_backup_codes()
    _store_backup_codes(g.current_user, new_codes)

    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error('No se pudieron regenerar los códigos de respaldo: %s', exc)
        return jsonify(error='No se pudieron regenerar los códigos de respaldo.'), 500

    return jsonify(message='Códigos de respaldo regenerados.', backup_codes=new_codes)


@api.get("/admin/stats/users")
@require_session
def admin_stats_users():
    guard = _require_admin_or_dev()
    if guard:
        return guard

    total = (
        db.session.query(func.count(Users.id))
        .filter(Users.deleted_at.is_(None))
        .scalar()
        or 0
    )

    seven_days_ago = datetime.now(timezone.utc) - timedelta(days=7)
    active = (
        db.session.query(func.count(func.distinct(UserSessions.user_id)))
        .filter(UserSessions.last_seen_at.isnot(None), UserSessions.last_seen_at >= seven_days_ago)
        .scalar()
        or 0
    )

    role_rows = (
        db.session.query(Roles.name, func.count(Users.id))
        .join(Users, Roles.id == Users.role_id)
        .filter(Users.deleted_at.is_(None))
        .group_by(Roles.name)
        .all()
    )
    role_map = {str(name or 'sin_rol'): int(count or 0) for name, count in role_rows}

    return jsonify(total=int(total), activos_7d=int(active), por_rol=role_map)


@api.get("/admin/stats/requests")
@require_session
def admin_stats_requests():
    guard = _require_admin_or_dev()
    if guard:
        return guard

    total = db.session.query(func.count(RoleRequest.id)).scalar() or 0
    pending = (
        db.session.query(func.count(RoleRequest.id))
        .filter(RoleRequest.status == 'pending')
        .scalar()
        or 0
    )
    resolved = (
        db.session.query(func.count(RoleRequest.id))
        .filter(RoleRequest.status.in_(("approved", "rejected")))
        .scalar()
        or 0
    )
    open_count = max(int(total) - int(resolved), 0)

    return jsonify(abiertas=open_count, pendientes=int(pending), atendidas=int(resolved))


@api.get("/admin/stats/plots")
@require_session
def admin_stats_plots():
    guard = _require_admin_or_dev()
    if guard:
        return guard

    now = datetime.now(timezone.utc)
    start_today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = now - timedelta(days=7)

    total = (
        db.session.query(func.count(PlotHistory.id))
        .filter(PlotHistory.deleted_at.is_(None))
        .scalar()
        or 0
    )
    today = (
        db.session.query(func.count(PlotHistory.id))
        .filter(PlotHistory.deleted_at.is_(None), PlotHistory.created_at >= start_today)
        .scalar()
        or 0
    )
    week = (
        db.session.query(func.count(PlotHistory.id))
        .filter(PlotHistory.deleted_at.is_(None), PlotHistory.created_at >= week_ago)
        .scalar()
        or 0
    )

    return jsonify(hoy=int(today), ultimos_7d=int(week), total=int(total))


@api.post("/groups")
@require_session
def create_group():
    guard = _require_teacher()
    if guard:
        return guard

    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    description = (data.get("description") or "").strip() or None

    if len(name) < 2:
        return jsonify(error="El nombre del grupo debe tener al menos 2 caracteres."), 400

    group = StudentGroup(
        teacher_id=g.current_user.id,
        name=name,
        description=description,
    )
    db.session.add(group)
    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("Error al crear grupo: %s", exc)
        return jsonify(error="No se pudo crear el grupo."), 500

    return jsonify(
        message="Grupo creado.",
        group={
            "id": str(group.id),
            "name": group.name,
            "description": group.description,
            "created_at": group.created_at.isoformat(),
        },
    ), 201


@api.get("/groups")
@require_session
def list_groups():
    guard = _require_teacher()
    if guard:
        return guard

    groups = (
        db.session.query(StudentGroup)
        .filter(StudentGroup.teacher_id == g.current_user.id)
        .order_by(desc(StudentGroup.created_at))
        .all()
    )

    payload = []
    for group in groups:
        payload.append({
            "id": str(group.id),
            "name": group.name,
            "description": group.description,
            "created_at": group.created_at.isoformat(),
            "members": [
                {
                    "id": str(member.id),
                    "student_visible_id": member.student_visible_id,
                    "student_name": member.student.name,
                    "student_email": member.student.email,
                }
                for member in group.members
            ],
        })

    return jsonify(groups=payload)


@api.post("/groups/<uuid:group_id>/members")
@require_session
def add_group_member(group_id):
    guard = _require_teacher()
    if guard:
        return guard

    group = db.session.query(StudentGroup).filter(
        StudentGroup.id == group_id,
        StudentGroup.teacher_id == g.current_user.id,
    ).first()

    if not group:
        return jsonify(error="Grupo no encontrado."), 404

    data = request.get_json() or {}
    visible_id = (data.get("visible_id") or "").strip()
    if not visible_id:
        return jsonify(error="Debes proporcionar el visible_id del estudiante."), 400

    student = db.session.query(Users).filter(Users.public_id == visible_id).first()
    if not student:
        return jsonify(error="No se encontró un usuario con ese visible_id."), 404

    student_roles = {role.name for role in student.roles}
    if student.id == g.current_user.id or student_roles.isdisjoint({"student", "user"}):
        return jsonify(error="Solo se pueden agregar estudiantes o usuarios estándar."), 400

    existing = db.session.query(GroupMember).filter(
        GroupMember.group_id == group.id,
        GroupMember.student_user_id == student.id,
    ).first()
    if existing:
        return jsonify(error="El estudiante ya forma parte de este grupo."), 409

    membership = GroupMember(
        group_id=group.id,
        student_user_id=student.id,
        student_visible_id=student.public_id,
    )
    db.session.add(membership)
    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("Error al agregar estudiante al grupo: %s", exc)
        return jsonify(error="No se pudo agregar el estudiante."), 500

    return jsonify(
        message="Estudiante agregado al grupo.",
        member={
            "id": str(membership.id),
            "student_visible_id": membership.student_visible_id,
            "student_name": student.name,
            "student_email": student.email,
        },
    ), 201


@api.delete("/groups/<uuid:group_id>/members/<string:visible_id>")
@require_session
def remove_group_member(group_id, visible_id):
    guard = _require_teacher()
    if guard:
        return guard

    group = db.session.query(StudentGroup).filter(
        StudentGroup.id == group_id,
        StudentGroup.teacher_id == g.current_user.id,
    ).first()

    if not group:
        return jsonify(error="Grupo no encontrado."), 404

    membership = db.session.query(GroupMember).filter(
        GroupMember.group_id == group.id,
        GroupMember.student_visible_id == visible_id,
    ).first()

    if not membership:
        return jsonify(error="El estudiante no pertenece a este grupo."), 404

    try:
        db.session.delete(membership)
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("Error al eliminar estudiante del grupo: %s", exc)
        return jsonify(error="No se pudo eliminar al estudiante."), 500

    return jsonify(message="Estudiante eliminado del grupo.")


@api.get("/teacher/groups/<uuid:group_id>/history")
@require_session
def group_history(group_id):
    guard = _require_roles({'teacher', 'admin', 'development'})
    if guard:
        return guard

    user_roles = {role.name for role in g.current_user.roles}

    group_query = db.session.query(StudentGroup).filter(StudentGroup.id == group_id)
    if user_roles.intersection({'admin', 'development'}):
        group = group_query.first()
    else:
        group = group_query.filter(StudentGroup.teacher_id == g.current_user.id).first()

    if not group:
        return jsonify(error="Grupo no encontrado."), 404

    members = (
        db.session.query(GroupMember)
        .options(selectinload(GroupMember.student).selectinload(Users.plot_history))
        .filter(GroupMember.group_id == group.id)
        .all()
    )

    history_payload = []
    for membership in members:
        student = membership.student
        if not student:
            continue
        history_entries = [
            {
                "id": str(entry.id),
                "expression": entry.expression,
                "created_at": entry.created_at.isoformat() if entry.created_at else None,
            }
            for entry in sorted(
                (h for h in student.plot_history if h and h.deleted_at is None),
                key=lambda item: item.created_at or datetime.min.replace(tzinfo=timezone.utc),
                reverse=True,
            )
        ]

        history_payload.append({
            "student_name": student.name,
            "student_visible_id": student.public_id,
            "entries": history_entries,
        })

    return jsonify(
        group={
            "id": str(group.id),
            "name": group.name,
            "description": group.description,
        },
        students=history_payload,
    )


@api.get("/admin/teachers")
@require_session
def admin_list_teachers():
    guard = _require_roles({'admin', 'development'})
    if guard:
        return guard

    teachers = (
        db.session.query(Users)
        .filter(Users.roles.any(Roles.name == 'teacher'))
        .order_by(Users.name)
        .all()
    )

    payload = [
        {
            "id": str(user.id),
            "name": user.name,
            "email": user.email,
            "public_id": user.public_id,
            "primary_role": user.role.name if user.role else None,
            "roles": [r.name for r in user.roles],
        }
        for user in teachers
    ]

    return jsonify(teachers=payload)


# Compatibilidad con versiones anteriores: sigue aceptando UUID en la ruta.
@api.post("/admin/users/<uuid:user_id>/assign-teacher")
@require_session
def admin_assign_teacher_by_uuid(user_id):
    guard = _require_roles({'admin', 'development'})
    if guard:
        return guard

    user = db.session.get(Users, user_id)
    if not user:
        return jsonify(error="Usuario no encontrado."), 404

    return _assign_teacher_role(user)


@api.post("/admin/users/assign-teacher")
@require_session
def admin_assign_teacher():
    guard = _require_roles({'admin', 'development'})
    if guard:
        return guard

    data = request.get_json() or {}
    user = None

    user_id = data.get("user_id")
    visible_id = data.get("visible_id")

    if user_id:
        try:
            user = db.session.get(Users, user_id)
        except Exception:
            user = None

    if not user and visible_id:
        user = db.session.query(Users).filter(Users.public_id == visible_id).first()

    if not user:
        return jsonify(error="Usuario no encontrado."), 404

    return _assign_teacher_role(user)


@api.get("/admin/teacher-groups")
@require_session
def admin_teacher_groups():
    guard = _require_roles({'admin', 'development'})
    if guard:
        return guard

    groups = (
        db.session.query(StudentGroup)
        .options(
            selectinload(StudentGroup.teacher),
            selectinload(StudentGroup.members).selectinload(GroupMember.student),
        )
        .order_by(desc(StudentGroup.created_at))
        .all()
    )

    payload = []
    for group in groups:
        teacher = group.teacher
        payload.append({
            "id": str(group.id),
            "name": group.name,
            "description": group.description,
            "created_at": group.created_at.isoformat(),
            "teacher": {
                "id": str(teacher.id),
                "name": teacher.name,
                "email": teacher.email,
                "public_id": teacher.public_id,
            } if teacher else None,
            "member_count": len(group.members),
        })

    return jsonify(groups=payload)


@api.post("/role-requests")
@require_session
def create_role_request():
    data = request.get_json() or {}
    requested_role = (data.get("role") or "").strip().lower()

    if requested_role != "admin":
        return jsonify(error="Solo se permite solicitar el rol 'admin'."), 400

    if 'admin' in {r.name for r in g.current_user.roles}:
        return jsonify(error="Ya cuentas con privilegios de administrador."), 400

    existing = db.session.query(RoleRequest).filter(
        RoleRequest.user_id == g.current_user.id,
        RoleRequest.requested_role == 'admin',
        RoleRequest.status == 'pending'
    ).first()
    if existing:
        return jsonify(error="Ya tienes una solicitud pendiente."), 409

    notes = (data.get("notes") or "").strip() or None
    req = RoleRequest(
        user_id=g.current_user.id,
        requested_role='admin',
        status='pending',
        notes=notes,
    )
    db.session.add(req)
    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("Error al registrar solicitud de rol: %s", exc)
        return jsonify(error="No se pudo registrar la solicitud."), 500
    else:
        _notify_role_request_created(g.current_user, req)

    return jsonify(
        message="Solicitud registrada. Enviamos un aviso al equipo de desarrollo para revisar tu caso.",
        request_id=str(req.id),
    ), 201


@api.get("/role-requests/me")
@require_session
def get_my_role_request_status():
    latest = (
        db.session.query(RoleRequest)
        .options(selectinload(RoleRequest.resolver))
        .filter(RoleRequest.user_id == g.current_user.id)
        .order_by(desc(RoleRequest.created_at))
        .first()
    )

    if not latest:
        return jsonify(request=None)

    resolver = latest.resolver
    return jsonify(
        request={
            "id": str(latest.id),
            "requested_role": latest.requested_role,
            "status": latest.status,
            "created_at": latest.created_at.isoformat() if latest.created_at else None,
            "resolved_at": latest.resolved_at.isoformat() if latest.resolved_at else None,
            "resolver": {
                "id": str(resolver.id),
                "name": resolver.name,
            } if resolver else None,
            "notes": latest.notes,
        }
    )


@api.get("/development/role-requests")
@require_session
def development_list_role_requests():
    guard = _require_roles({'development'})
    if guard:
        return guard

    requests = (
        db.session.query(RoleRequest)
        .options(selectinload(RoleRequest.user), selectinload(RoleRequest.resolver))
        .order_by(desc(RoleRequest.created_at))
        .all()
    )

    payload = []
    for req in requests:
        payload.append({
            "id": str(req.id),
            "user": {
                "id": str(req.user.id),
                "name": req.user.name,
                "email": req.user.email,
                "public_id": req.user.public_id,
            } if req.user else None,
            "requested_role": req.requested_role,
            "status": req.status,
            "notes": req.notes,
            "created_at": req.created_at.isoformat() if req.created_at else None,
            "resolved_at": req.resolved_at.isoformat() if req.resolved_at else None,
            "resolver": {
                "id": str(req.resolver.id),
                "name": req.resolver.name,
            } if req.resolver else None,
        })

    return jsonify(requests=payload)


def _assign_role_to_user(user, role_name):
    role = _get_role_by_name(role_name)
    if not role:
        raise ValueError(f"Rol '{role_name}' no existe.")
    if role not in user.roles:
        user.roles.append(role)
    user.role_id = role.id
    return role


def _remove_role_from_user(user, role_name, *, fallback_role="user"):
    role = _get_role_by_name(role_name)
    if not role:
        raise ValueError(f"Rol '{role_name}' no existe.")

    removed = False
    current_roles = list(user.roles or [])
    for assigned in current_roles:
        if assigned.id == role.id:
            user.roles.remove(assigned)
            removed = True

    if not removed:
        return False

    if user.role_id == role.id:
        replacement = next((r for r in user.roles if r.id != role.id), None)
        if not replacement and fallback_role:
            replacement = _get_role_by_name(fallback_role)
            if not replacement:
                raise ValueError(f"Rol '{fallback_role}' no existe.")
            if replacement not in user.roles:
                user.roles.append(replacement)
        if not replacement:
            raise ValueError("No hay un rol alternativo para el usuario.")
        user.role_id = replacement.id
        user.role = replacement

    return True


def _record_audit(action, *, target_entity_type=None, target_entity_id=None, details=None):
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
    except Exception as exc:
        current_app.logger.warning("No se pudo registrar auditoría (%s): %s", action, exc)


def _find_user_by_identifier(identifier):
    if not identifier:
        return None
    user = None
    try:
        user = db.session.get(Users, identifier)
    except Exception:
        user = None
    if user:
        return user
    return db.session.execute(
        db.select(Users).where(Users.public_id == identifier)
    ).scalar_one_or_none()


def _count_active_role_members(role_id):
    stmt = (
        db.select(func.count())
        .select_from(
            user_roles_table.join(Users, user_roles_table.c.user_id == Users.id)
        )
        .where(
            user_roles_table.c.role_id == role_id,
            Users.deleted_at.is_(None),
        )
    )
    return db.session.execute(stmt).scalar_one()


@api.post("/development/users/assign-admin")
@require_session
def development_assign_admin():
    guard = _require_roles({'development'})
    if guard:
        return guard

    data = request.get_json() or {}
    user_id = data.get("user_id")
    visible_id = data.get("visible_id")
    request_id = data.get("request_id")

    user = None
    if user_id:
        try:
            user = db.session.get(Users, user_id)
        except Exception:
            user = None
    if not user and visible_id:
        user = db.session.query(Users).filter(Users.public_id == visible_id).first()

    if not user:
        return jsonify(error="Usuario no encontrado."), 404

    pending_request = None
    if request_id:
        pending_request = db.session.get(RoleRequest, request_id)
        if pending_request and pending_request.user_id != user.id:
            return jsonify(error="La solicitud no corresponde al usuario indicado."), 400

    try:
        _assign_role_to_user(user, 'admin')
        db.session.flush()
        if pending_request:
            pending_request.status = 'approved'
            pending_request.resolver_id = g.current_user.id
            pending_request.resolved_at = datetime.now(timezone.utc)
        audit_details = {
            "target_public_id": user.public_id,
            "request_id": str(pending_request.id) if pending_request else None,
        }
        _record_audit(
            "role.admin.assigned",
            target_entity_type="user",
            target_entity_id=user.id,
            details={k: v for k, v in audit_details.items() if v is not None},
        )
    except ValueError as exc:
        db.session.rollback()
        current_app.logger.error("Error en asignación de admin: %s", exc)
        return jsonify(error=str(exc)), 500
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("Error en asignación admin: %s", exc)
        return jsonify(error="No se pudo asignar el rol admin."), 500
    else:
        db.session.commit()

    return jsonify(
        message="Rol 'admin' asignado.",
        user={
            "id": str(user.id),
            "name": user.name,
            "public_id": user.public_id,
            "roles": [r.name for r in user.roles],
            "primary_role": user.role.name if user.role else None,
        }
    )


@api.get("/development/admins")
@require_session
def development_list_admins():
    guard = _require_roles({'development'})
    if guard:
        return guard

    admin_role = _get_role_by_name('admin')
    if not admin_role:
        return jsonify(admins=[], total=0)

    stmt = (
        db.select(Users)
        .options(selectinload(Users.roles))
        .join(user_roles_table, user_roles_table.c.user_id == Users.id)
        .where(
            user_roles_table.c.role_id == admin_role.id,
            Users.deleted_at.is_(None),
        )
        .order_by(func.lower(Users.name))
    )

    rows = (
        db.session.execute(stmt)
        .scalars()
        .unique()
        .all()
    )

    total = len(rows)
    current_id = getattr(getattr(g, "current_user", None), "id", None)

    payload = []
    for row in rows:
        payload.append({
            "id": str(row.id),
            "public_id": row.public_id,
            "name": row.name,
            "email": row.email,
            "roles": [r.name for r in (row.roles or [])],
            "created_at": row.created_at.isoformat() if row.created_at else None,
            "removable": total > 1,
            "is_self": row.id == current_id,
        })

    return jsonify(admins=payload, total=total)


@api.delete("/development/users/<user_identifier>/roles/admin")
@require_session
def development_remove_admin(user_identifier):
    guard = _require_roles({'development'})
    if guard:
        return guard

    admin_role = _get_role_by_name('admin')
    if not admin_role:
        return jsonify(error="Rol 'admin' no está configurado."), 500

    user = _find_user_by_identifier(user_identifier)
    if not user or user.deleted_at:
        return jsonify(error="Usuario no encontrado."), 404

    if admin_role not in (user.roles or []):
        return jsonify(error="El usuario no tiene el rol admin."), 400

    total_admins = _count_active_role_members(admin_role.id)
    if total_admins <= 1:
        return jsonify(error="Debe permanecer al menos un administrador activo."), 409

    try:
        removed = _remove_role_from_user(user, 'admin')
        if not removed:
            return jsonify(error="El usuario no tiene el rol admin."), 400

        db.session.flush()
        remaining_admins = _count_active_role_members(admin_role.id)
        audit_details = {
            "target_public_id": user.public_id,
            "target_user_id": str(user.id),
            "remaining_admins": int(remaining_admins),
        }
        _record_audit(
            "role.admin.removed",
            target_entity_type="user",
            target_entity_id=user.id,
            details=audit_details,
        )
        db.session.commit()
    except ValueError as exc:
        db.session.rollback()
        return jsonify(error=str(exc)), 400
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("Error al remover rol admin: %s", exc)
        return jsonify(error="No se pudo remover el rol admin."), 500

    return jsonify(
        message="Rol 'admin' eliminado.",
        user={
            "id": str(user.id),
            "name": user.name,
            "public_id": user.public_id,
            "roles": [r.name for r in (user.roles or [])],
            "primary_role": user.role.name if user.role else None,
        },
        remaining_admins=int(remaining_admins),
    )


@api.post("/development/role-requests/<uuid:request_id>/resolve")
@require_session
def development_resolve_request(request_id):
    guard = _require_roles({'development'})
    if guard:
        return guard

    req = db.session.get(RoleRequest, request_id)
    if not req:
        return jsonify(error="Solicitud no encontrada."), 404

    data = request.get_json() or {}
    action = (data.get("action") or "").strip().lower()
    notes = (data.get("notes") or "").strip() or None

    if req.status != 'pending':
        return jsonify(error="La solicitud ya fue procesada."), 409

    if action not in {'approve', 'reject'}:
        return jsonify(error="Acción inválida. Usa 'approve' o 'reject'."), 400

    try:
        if action == 'approve':
            _assign_role_to_user(req.user, req.requested_role)
        req.status = 'approved' if action == 'approve' else 'rejected'
        req.notes = notes
        req.resolver_id = g.current_user.id
        req.resolved_at = datetime.now(timezone.utc)
        db.session.commit()
    except ValueError as exc:
        db.session.rollback()
        return jsonify(error=str(exc)), 400
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("Error al resolver solicitud: %s", exc)
        return jsonify(error="No se pudo procesar la solicitud."), 500

    return jsonify(message=f"Solicitud {req.status}.")


@api.post("/development/backups/run")
@require_session
def development_backup():
    guard = _require_roles({'development'})
    if guard:
        return guard

    data = request.get_json(silent=True) or {}
    backup_name = data.get("backup_name")

    try:
        metadata = run_backup(backup_name)
    except BackupError as exc:
        current_app.logger.error("Backup fallido: %s", exc)
        return jsonify(error=str(exc)), 500

    current_app.logger.info(
        "Backup '%s' generado por %s en %s",
        metadata.filename,
        g.current_user.email,
        metadata.path,
    )
    return jsonify(message="Backup generado con éxito.", backup=asdict(metadata)), 201


@api.post("/development/backups/restore")
@require_session
def development_restore():
    guard = _require_roles({'development'})
    if guard:
        return guard

    data = request.get_json(silent=True) or {}
    backup_name = (data.get("backup_name") or "").strip()
    if not backup_name:
        return jsonify(error="Debes indicar el nombre del backup."), 400

    try:
        metadata = restore_backup(backup_name)
    except FileNotFoundError:
        return jsonify(error="El backup solicitado no existe."), 404
    except RestoreError as exc:
        current_app.logger.error("Restore fallido: %s", exc)
        return jsonify(error=str(exc)), 500

    current_app.logger.info(
        "Backup '%s' restaurado por %s",
        metadata.filename,
        g.current_user.email,
    )
    return jsonify(message="Restauración completada.", backup=asdict(metadata))
