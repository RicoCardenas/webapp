"""Meta endpoints - app metadata."""
import json
from pathlib import Path
from flask import jsonify, current_app, request, Response, url_for

from . import api
from ..extensions import limiter
from ..services.validate import normalize_email as _normalize_email, validate_contact_submission as _validate_contact_submission


@api.get("/meta/env")
def meta_env():
    """Retorna el entorno de ejecución."""
    env = (current_app.config.get("APP_ENV") or current_app.config.get("ENV") or "production").lower()
    return jsonify({
        "env": env,
        "demo_mode": env in {"development", "test"},
    })


@api.errorhandler(429)
def handle_rate_limit(e):
    """Retorna respuestas JSON consistentes para errores de rate limit en la API."""
    retry_after = getattr(e, "retry_after", None)
    try:
        headers = dict(e.get_headers()) if hasattr(e, "get_headers") else dict(e.headers or {})
        retry_after = retry_after or headers.get("Retry-After")
    except Exception:
        retry_after = None

    if retry_after is None:
        # Fallback for determinism in tests when flask-limiter doesn't populate header
        limit = getattr(e, "limit", None)
        try:
            retry_after = str(int(getattr(limit, "reset_at", 1))) if limit else "1"
        except Exception:
            retry_after = "1"

    limit = getattr(e, "limit", None)
    details = {"message": getattr(e, "description", "Too many requests.")}
    if limit:
        details["limit"] = str(limit)
    if retry_after:
        details["retry_after"] = retry_after

    response = jsonify(error="Too Many Requests", details=details)
    if retry_after:
        response.headers["Retry-After"] = retry_after
    return response, 429


def _load_openapi_spec():
    """Carga el archivo OpenAPI desde docs/."""
    root_path = Path(current_app.root_path).resolve()
    candidates = [
        root_path / "docs",
        root_path.parent / "docs",
        root_path.parents[1] / "docs" if len(root_path.parents) > 1 else None,
    ]
    docs_dir = next((c for c in candidates if c and c.exists()), root_path / "docs")
    spec_path = docs_dir / "openapi.yaml"
    if not spec_path.exists():
        return {}

    try:
        with spec_path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except json.JSONDecodeError:
        try:
            import yaml  # type: ignore
            with spec_path.open("r", encoding="utf-8") as fh:
                return yaml.safe_load(fh) or {}
        except Exception:
            current_app.logger.warning("No se pudo parsear openapi.yaml")
    return {}


@api.get("/openapi.json")
def openapi_json():
    """Retorna el esquema OpenAPI."""
    spec = _load_openapi_spec()
    if not spec:
        return jsonify(error="OpenAPI spec not found"), 404
    return jsonify(spec)


@api.get("/docs")
def api_docs():
    """Sirve la página de documentación Swagger UI."""
    spec_url = url_for("api.openapi_json", _external=False)
    html = f"""
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <title>EcuPlot API Docs</title>
        <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
      </head>
      <body>
        <div id="swagger-ui"></div>
        <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
        <script>
          window.onload = () => {{
            SwaggerUIBundle({{
              url: "{spec_url}",
              dom_id: '#swagger-ui',
              presets: [SwaggerUIBundle.presets.apis],
              layout: "BaseLayout",
            }});
          }};
        </script>
      </body>
    </html>
    """
    return Response(html, mimetype="text/html")


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
