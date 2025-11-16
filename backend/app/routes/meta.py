"""Meta endpoints - app metadata."""
from flask import jsonify, current_app, request

from . import api
from ..extensions import limiter


@api.get("/meta/env")
def meta_env():
    """Retorna el entorno de ejecución."""
    env = (current_app.config.get("APP_ENV") or current_app.config.get("ENV") or "production").lower()
    return jsonify({
        "env": env,
        "demo_mode": env in {"development", "test"},
    })


def _normalize_email(value):
    """Normalize email to lowercase."""
    return (value or "").strip().lower()


def _validate_contact_submission(name, email, message):
    """Validate contact form fields."""
    errors = {}
    if len(name) < 2:
        errors['name'] = 'Ingresa tu nombre (mínimo 2 caracteres).'
    if not email or '@' not in email:
        errors['email'] = 'Proporciona un correo válido.'
    if len(message) < 10:
        errors['message'] = 'El mensaje debe tener al menos 10 caracteres.'
    return errors


def _send_contact_notification(name, email, message):
    """Send contact notification email."""
    from flask_mail import Message as MailMessage
    from ..extensions import mail
    
    recipient = current_app.config.get('CONTACT_RECIPIENT')
    if not recipient:
        current_app.logger.warning(
            'Contacto recibido sin destinatario configurado',
            extra={'event': 'contact.no_recipient', 'sender_email': email, 'sender_name': name}
        )
        return None

    sender = current_app.config.get('MAIL_DEFAULT_SENDER')
    if not sender:
        sender = current_app.config.get('MAIL_USERNAME')
    if not sender:
        current_app.logger.error(
            'No se pudo reenviar contacto: remitente de correo no configurado',
            extra={'event': 'contact.no_sender'}
        )
        return 'Servicio de correo no disponible. Intenta más tarde.'

    try:
        msg = MailMessage(
            subject='Nuevo contacto de EcuPlot',
            sender=sender,
            recipients=[recipient],
            body=f"Nombre: {name}\nEmail: {email}\n\n{message}",
        )
        mail.send(msg)
    except Exception as exc:
        current_app.logger.error(
            'No se pudo reenviar el contacto: %s',
            exc,
            extra={'event': 'contact.send_failed', 'error': str(exc)}
        )
        return 'No se pudo enviar el mensaje en este momento.'
    return None


@api.post("/contact")
@limiter.limit(lambda: current_app.config.get("RATELIMIT_CONTACT", "5 per hour"))
def contact_json():
    """API endpoint para formulario de contacto (JSON)."""
    try:
        data = request.get_json() or {}
    except Exception:
        return jsonify(error='Datos inválidos.'), 400
    
    name = (data.get('name') or '').strip()
    email = _normalize_email(data.get('email'))
    message = (data.get('message') or '').strip()

    errors = _validate_contact_submission(name, email, message)
    if errors:
        return jsonify(
            success=False,
            message='No pudimos enviar tu mensaje. Revisa los campos.',
            errors=errors
        ), 400

    delivery_error = _send_contact_notification(name, email, message)
    if delivery_error:
        return jsonify(
            success=False,
            message=delivery_error,
            errors={}
        ), 502

    return jsonify(
        success=True,
        message='Mensaje enviado. Gracias por escribirnos.',
        errors={}
    ), 200
