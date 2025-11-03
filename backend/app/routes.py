import re
import secrets
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from flask import Blueprint, current_app, jsonify, send_from_directory, request, redirect, url_for, g
from .extensions import db, bcrypt, mail
from .models import Users, Roles, UserTokens, UserSessions, PlotHistory, StudentGroup, GroupMember, RoleRequest
from flask_mail import Message
from sqlalchemy import and_, desc, cast, String, or_, delete
from sqlalchemy.orm import selectinload

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

    errors = {}
    if len(name) < 2:
        errors['name'] = 'Ingresa tu nombre (mínimo 2 caracteres).'
    if not email or '@' not in email:
        errors['email'] = 'Proporciona un correo válido.'
    if len(message) < 10:
        errors['message'] = 'El mensaje debe tener al menos 10 caracteres.'

    if errors:
        return jsonify(error="Datos inválidos", fields=errors), 400

    recipient = current_app.config.get('CONTACT_RECIPIENT')
    sender = current_app.config.get('MAIL_DEFAULT_SENDER') or current_app.config.get('MAIL_USERNAME')

    try:
        if recipient and sender:
            msg = Message(
                subject='Nuevo contacto de EcuPlot',
                sender=sender,
                recipients=[recipient],
                body=f"Nombre: {name}\nEmail: {email}\n\n{message}",
            )
            mail.send(msg)
        else:
            current_app.logger.info('Contacto recibido sin destinatario configurado: %s', data)
    except Exception as exc:
        current_app.logger.error('No se pudo reenviar el contacto: %s', exc)
        return jsonify(error='No se pudo enviar el mensaje en este momento.'), 502

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

    items = []
    try:
        for expr in expressions:
            item = PlotHistory(
                user_id=g.current_user.id,
                expression=expr,
                plot_parameters=plot_parameters,
                plot_metadata=plot_metadata
            )
            db.session.add(item)
            items.append(item)
        db.session.commit()
        return jsonify(
            message="Expresiones guardadas en historial.",
            saved=len(items),
            items=[{"id": str(x.id), "expression": x.expression, "created_at": x.created_at.isoformat()} for x in items]
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
    try:
        limit = min(max(int(request.args.get("limit", 50)), 1), 200)
    except Exception:
        limit = 50
    try:
        offset = max(int(request.args.get("offset", 0)), 0)
    except Exception:
        offset = 0

    q = (request.args.get("q") or "").strip()

    base_q = db.session.query(PlotHistory).filter(PlotHistory.user_id == g.current_user.id)
    if q:
        terms = {q}
        if " " in q:
            terms.add(q.replace(" ", "+"))
        if "+" in q:
            terms.add(q.replace("+", " "))
        filters = [PlotHistory.expression.ilike(f"%{term}%") for term in terms if term]
        if filters:
            base_q = base_q.filter(or_(*filters))

    total = base_q.count()
    rows = base_q.order_by(desc(PlotHistory.created_at)).offset(offset).limit(limit).all()

    return jsonify({
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": str(r.id),
                "expression": r.expression,
                "created_at": r.created_at.isoformat()
            }
            for r in rows
        ],
    })


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
