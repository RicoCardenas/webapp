import secrets
from datetime import datetime, timedelta, timezone
from flask import Blueprint, current_app, jsonify, send_from_directory, request, redirect, url_for, g
from .extensions import db, bcrypt, mail
from .models import Users, Roles, UserTokens, UserSessions, PlotHistory
from flask_mail import Message
from sqlalchemy import and_, desc 

from .auth import require_session

# --- Blueprints ---
api = Blueprint("api", __name__)
frontend = Blueprint("frontend", __name__)

# --- Rutas del Frontend ---
@frontend.get("/")
def serve_frontend():
    """Sirve el index.html principal."""
    return send_from_directory(current_app.template_folder, "index.html")

@frontend.get("/graph")
def graph():
    # sirve /graph y /graph.html -> graph.html
    return send_from_directory(current_app.template_folder, "graph.html")


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
    email = (data.get('email') or '').strip()
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
        base_q = base_q.filter(PlotHistory.expression.ilike(f"%{q}%"))

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
