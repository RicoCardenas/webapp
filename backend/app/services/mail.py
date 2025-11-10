"""
Servicio de correo electrónico.

Funciones:
- resolve_mail_sender: Determina el remitente de correo configurado
- send_contact_notification: Envía notificación de formulario de contacto
"""

from flask import current_app
from flask_mail import Message

# Constante de error
MAIL_SENDER_MISSING_ERROR = "Servicio de correo no disponible. Intenta más tarde."


def resolve_mail_sender():
    """
    Determina el remitente de correo configurado.
    
    Prioriza MAIL_DEFAULT_SENDER sobre MAIL_USERNAME.
    Soporta strings individuales o tuplas (email, nombre).
    
    Returns:
        Remitente configurado (str o tuple) o None si no está disponible
    """
    sender = current_app.config.get('MAIL_DEFAULT_SENDER')

    if isinstance(sender, str):
        stripped = sender.strip()
        if stripped:
            return stripped
    elif isinstance(sender, (list, tuple)):
        cleaned = []
        for part in sender:
            if isinstance(part, str):
                part = part.strip()
            if part:
                cleaned.append(part)
        if cleaned:
            return tuple(cleaned)

    fallback = current_app.config.get('MAIL_USERNAME')
    if isinstance(fallback, str):
        fallback = fallback.strip()
        if fallback:
            return fallback
    return None


def send_contact_notification(name, email, message, mail):
    """
    Envía una notificación de contacto al administrador configurado.
    
    Args:
        name: Nombre del contacto
        email: Email del contacto
        message: Mensaje del contacto
        mail: Instancia de flask_mail.Mail
        
    Returns:
        None si el envío fue exitoso, mensaje de error en caso contrario
    """
    recipient = current_app.config.get('CONTACT_RECIPIENT')
    if not recipient:
        current_app.logger.info('Contacto recibido sin destinatario configurado: %s <%s>', name, email)
        return None

    sender = resolve_mail_sender()
    if not sender:
        current_app.logger.error('No se pudo reenviar contacto: remitente de correo no configurado.')
        return MAIL_SENDER_MISSING_ERROR

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
