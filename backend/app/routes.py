"""HTTP endpoints exposed by the backend service."""
import secrets
from datetime import datetime, timedelta, timezone
from flask import Blueprint, current_app, jsonify, send_from_directory, request, redirect, url_for, g
from .extensions import db, bcrypt, mail
from .models import Users, Roles, UserTokens, UserSessions, PlotHistory
from flask_mail import Message
from sqlalchemy import and_

# Intentamos importar el decorador desde auth.py (recomendado)
try:
    from .auth import require_session
except Exception:
    # Fallback si aún no existe auth.py
    from functools import wraps
    def require_session(fn):
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

# --- Blueprints ---
api = Blueprint("api", __name__)
frontend = Blueprint("frontend", __name__)


# --- Rutas del Frontend ---
@frontend.get("/")
def serve_frontend():
    """Sirve el index.html principal."""
    return send_from_directory(current_app.template_folder, "index.html")


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


@api.post("/register")
def register_user():
    """Registro de nuevo usuario (envía correo de verificación)."""
    data = request.get_json()
    if not data:
        return jsonify(error="No se proporcionaron datos JSON."), 400
        
    email = data.get('email')
    password = data.get('password')
    terms = data.get('terms')

    if not email or not password:
        return jsonify(error="Email y contraseña son requeridos."), 400

    if not terms:
        return jsonify(error="Debes aceptar los términos y condiciones para registrarte."), 400

    existing_user = db.session.execute(
        db.select(Users).where(Users.email == email)
    ).scalar_one_or_none()
    
    if existing_user:
        return jsonify(error="El correo electrónico ya está registrado."), 409

    user_role = db.session.execute(
        db.select(Roles).where(Roles.name == 'user')
    ).scalar_one_or_none()
    
    if not user_role:
        current_app.logger.error("Error crítico: No se encontró el rol 'user' en la DB.")
        return jsonify(error="Error interno del servidor al configurar el usuario."), 500

    hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')

    try:
        new_user = Users(
            email=email,
            password_hash=hashed_password,
            role_id=user_role.id
        )
        db.session.add(new_user)
        
        token_value = secrets.token_urlsafe(32)
        expires = datetime.now(timezone.utc) + timedelta(hours=24) 
        
        verification_token = UserTokens(
            user=new_user, 
            token=token_value,
            token_type='verify_email',
            expires_at=expires
        )
        db.session.add(verification_token)

        verification_link = url_for('api.verify_email', token=token_value, _external=True)
        sender = current_app.config.get('MAIL_DEFAULT_SENDER') or current_app.config.get('MAIL_USERNAME')

        msg = Message(
            subject="¡Bienvenido a EcuPlot! Verifica tu correo.",
            sender=sender,
            recipients=[email]
        )
        msg.body = f"""¡Hola!

Gracias por registrarte en EcuPlot.

Para activar tu cuenta, por favor haz clic en el siguiente enlace:
{verification_link}

El enlace es válido por 24 horas.

Si no te registraste, por favor ignora este correo.

Saludos,
El equipo de EcuPlot
"""
        mail.send(msg)
        current_app.logger.info(f"Correo de verificación enviado exitosamente a {email}")

        db.session.commit()

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al registrar usuario o enviar correo: {e}")
        return jsonify(error="No se pudo completar el registro, intente más tarde."), 500

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

    if token_obj.expires_at < datetime.now(timezone.utc):
        return redirect(url_for('frontend.serve_frontend', error='token_expired'))

    try:
        user = token_obj.user
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

    email = data.get('email')
    password = data.get('password')

    if not email or not password:
        return jsonify(error="Email y contraseña son requeridos."), 400

    user = db.session.execute(
        db.select(Users).where(
            Users.email == email,
            Users.deleted_at == None 
        )
    ).scalar_one_or_none()

    if not user:
        return jsonify(error="Credenciales inválidas."), 401 

    if not user.is_verified:
        return jsonify(error="Tu cuenta no ha sido verificada. Por favor, revisa tu correo."), 403 

    if not bcrypt.check_password_hash(user.password_hash, password):
        return jsonify(error="Credenciales inválidas."), 401 
    
    session_token = secrets.token_urlsafe(64)
    expires = datetime.now(timezone.utc) + timedelta(days=7)
    
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


# -------------------- Cerrar sesión --------------------
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


# -------------------- Rutas protegidas de ejemplo --------------------
@api.post("/plot")
@require_session
def create_plot():
    """Crea un registro en plot_history para el usuario autenticado."""
    data = request.get_json() or {}
    expression = data.get('expression')
    plot_parameters = data.get('plot_parameters')
    plot_metadata = data.get('plot_metadata')

    if not expression or not isinstance(expression, str):
        return jsonify(error="Falta 'expression' (string)."), 400

    try:
        item = PlotHistory(
            user_id=g.current_user.id,
            expression=expression,
            plot_parameters=plot_parameters,
            plot_metadata=plot_metadata
        )
        db.session.add(item)
        db.session.commit()
        return jsonify(
            id=str(item.id),
            message="Expresión guardada en historial."
        ), 201
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f"Error al guardar plot_history: {e}")
        return jsonify(error="No se pudo guardar el historial."), 500