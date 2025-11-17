"""Frontend routes - serve HTML pages."""
from flask import (
    current_app,
    request,
    redirect,
    send_from_directory,
    url_for,
    flash,
    get_flashed_messages,
    render_template,
)

# Importar el blueprint desde el paquete routes
from . import frontend
from ..extensions import limiter
from ..services.validate import (
    normalize_email as _normalize_email,
    validate_contact_submission as _validate_contact_submission,
)


def _send_contact_notification(name, email, message):
    """Send contact notification email."""
    from flask_mail import Message as MailMessage
    from ..extensions import mail
    
    recipient = current_app.config.get('CONTACT_RECIPIENT')
    if not recipient:
        current_app.logger.info('Contacto recibido sin destinatario configurado: %s <%s>', name, email)
        return None

    sender = current_app.config.get('MAIL_DEFAULT_SENDER')
    if not sender:
        sender = current_app.config.get('MAIL_USERNAME')
    if not sender:
        current_app.logger.error('No se pudo reenviar contacto: remitente de correo no configurado.')
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
        current_app.logger.error('No se pudo reenviar el contacto: %s', exc)
        return 'No se pudo enviar el mensaje en este momento.'
    return None


@frontend.get("/")
def serve_frontend():
    """Sirve el index.html principal."""
    return send_from_directory(current_app.template_folder, "index.html")


@frontend.get("/graph")
def graph():
    """Sirve /graph y /graph.html -> graph.html"""
    return send_from_directory(current_app.template_folder, "graph.html")


@frontend.get("/account")
def account():
    """Sirve /account -> account.html"""
    return send_from_directory(current_app.template_folder, "account.html")


@frontend.get("/test-admin-delete")
def test_admin_delete():
    """Página de test para eliminar roles admin."""
    return send_from_directory(current_app.template_folder, "test-admin-delete.html")


@frontend.get("/reset-password")
def reset_password_page():
    """Sirve página de reset de contraseña."""
    return send_from_directory(current_app.template_folder, "reset-password.html")


@frontend.get("/login")
def login_page():
    """Sirve página de login."""
    return send_from_directory(current_app.template_folder, "login.html")


@frontend.get("/signup")
def signup_page():
    """Sirve página de registro."""
    return send_from_directory(current_app.template_folder, "signup.html")


@frontend.post("/contact")
@limiter.limit(lambda: current_app.config.get("RATELIMIT_CONTACT", "5 per hour"))
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
