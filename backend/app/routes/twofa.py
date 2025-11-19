"""Autenticación de dos factores (TOTP)."""

import base64

import secrets
import string
from datetime import datetime, timezone
from io import BytesIO
import base64

from flask import current_app, jsonify, request, g
from sqlalchemy import delete, func

from . import api
from ..extensions import db, bcrypt
from ..models import TwoFactorBackupCode
from ..auth import require_session
from ..notifications import create_notification


# Importar funciones helper de auth.py que ya contiene las funciones TOTP
from .auth import (
    _verify_totp_code,
    _verify_backup_code,
    _consume_backup_code,
    _verify_2fa_or_backup,
    _record_audit,
)


TOTP_ISSUER = 'EcuPlot'
TOTP_PERIOD = 30
TOTP_DIGITS = 6
BACKUP_CODE_COUNT = 8


def _generate_backup_codes(count=BACKUP_CODE_COUNT):
    """Genera códigos de respaldo aleatorios para 2FA."""
    alphabet = string.ascii_uppercase + string.digits
    codes = []
    for _ in range(count):
        code = ''.join(secrets.choice(alphabet) for _ in range(10))
        codes.append(code)
    return codes


def _store_backup_codes(user, codes):
    """Almacena códigos de respaldo hasheados para el usuario."""
    db.session.execute(
        delete(TwoFactorBackupCode).where(TwoFactorBackupCode.user_id == user.id)
    )
    for code in codes:
        hashed = bcrypt.generate_password_hash(code).decode('utf-8')
        db.session.add(TwoFactorBackupCode(user_id=user.id, code_hash=hashed))


def _generate_totp_secret():
    """Genera un secreto TOTP base32 para 2FA."""
    import base64
    return base64.b32encode(secrets.token_bytes(20)).decode('utf-8').rstrip('=')


def _build_otpauth_url(user, secret):
    """Construye la URL otpauth:// para QR codes."""
    from urllib.parse import quote
    label_name = user.email or user.public_id or 'usuario'
    label = quote(f"{TOTP_ISSUER}:{label_name}")
    issuer = quote(TOTP_ISSUER)
    return f'otpauth://totp/{label}?secret={secret}&issuer={issuer}&digits={TOTP_DIGITS}&period={TOTP_PERIOD}'


def _build_qr_data_url(otpauth_url: str) -> str | None:
    """Genera un data URL de un QR PNG a partir de la URL otpauth."""
    try:
        import qrcode
    except ImportError:
        current_app.logger.warning("qrcode no está instalado; 2FA QR no se generará.")
        return None

    try:
        qr = qrcode.QRCode(border=1, box_size=6)
        qr.add_data(otpauth_url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")
        buf = BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        encoded = base64.b64encode(buf.read()).decode("ascii")
        return f"data:image/png;base64,{encoded}"
    except Exception as exc:  # pragma: no cover - defensivo
        current_app.logger.error("No se pudo generar QR para 2FA: %s", exc)
        return None


@api.get("/account/2fa/status")
@require_session
def two_factor_status():
    """Retorna el estado de 2FA del usuario actual."""
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


@api.route("/account/2fa/setup", methods=["GET", "POST"])
@require_session
def two_factor_setup():
    """Genera un nuevo secreto TOTP para configurar 2FA."""
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
    qr_url = _build_qr_data_url(otpauth)
    return jsonify(secret=secret, otpauth_url=otpauth, qr=qr_url)


@api.post("/account/2fa/enable")
@require_session
def two_factor_enable():
    """Activa 2FA después de verificar el código TOTP."""
    data = request.get_json(silent=True) or {}
    code = (data.get('code') or data.get('otp') or '').strip()

    if not _verify_totp_code(g.current_user, code):
        return jsonify(error='El código proporcionado no es válido.'), 400

    backup_codes = _generate_backup_codes()
    _store_backup_codes(g.current_user, backup_codes)
    g.current_user.is_2fa_enabled = True

    _record_audit(
        "security.2fa.enabled",
        target_entity_type="user",
        target_entity_id=g.current_user.id,
        details={
            "backup_codes_issued": len(backup_codes),
            "method": "totp",
        },
    )

    try:
        create_notification(
            g.current_user.id,
            category="security",
            title="Autenticación en dos pasos activada",
            body="La verificación en dos pasos quedó habilitada para tu cuenta.",
            payload={
                "backup_codes": backup_codes,
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error('No se pudo activar 2FA: %s', exc)
        return jsonify(error='No se pudo activar la autenticación de dos pasos.'), 500

    return jsonify(message='Autenticación en dos pasos activada.', backup_codes=backup_codes)


@api.post("/account/2fa/disable")
@require_session
def two_factor_disable():
    """Desactiva 2FA después de verificar el código."""
    data = request.get_json(silent=True) or {}
    code = (data.get('code') or '').strip()

    valid, _ = _verify_2fa_or_backup(g.current_user, code)
    if not valid:
        return jsonify(error='El código proporcionado no es válido.'), 400

    g.current_user.is_2fa_enabled = False
    g.current_user.totp_secret = None
    _store_backup_codes(g.current_user, [])

    _record_audit(
        "security.2fa.disabled",
        target_entity_type="user",
        target_entity_id=g.current_user.id,
        details={
            "method": "totp",
        },
    )

    try:
        create_notification(
            g.current_user.id,
            category="security",
            title="Autenticación en dos pasos desactivada",
            body="La verificación en dos pasos se deshabilitó. Te recomendamos reactivarla cuanto antes.",
            payload={
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error('No se pudo desactivar 2FA: %s', exc)
        return jsonify(error='No se pudo desactivar la autenticación en dos pasos.'), 500

    return jsonify(message='Autenticación en dos pasos desactivada.')


@api.post("/account/2fa/backup-codes/regenerate")
@require_session
def regenerate_backup_codes():
    """Regenera los códigos de respaldo de 2FA."""
    data = request.get_json(silent=True) or {}
    code = (data.get('code') or '').strip()

    valid, _ = _verify_2fa_or_backup(g.current_user, code)
    if not valid:
        return jsonify(error='El código proporcionado no es válido.'), 400

    new_codes = _generate_backup_codes()
    _store_backup_codes(g.current_user, new_codes)

    _record_audit(
        "security.2fa.backup_regenerated",
        target_entity_type="user",
        target_entity_id=g.current_user.id,
        details={
            "count": len(new_codes),
        },
    )

    try:
        create_notification(
            g.current_user.id,
            category="security",
            title="Códigos de respaldo regenerados",
            body="Generaste un nuevo set de códigos de respaldo para 2FA.",
            payload={
                "created_at": datetime.now(timezone.utc).isoformat(),
                "codes": new_codes,
            },
        )
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error('No se pudieron regenerar los códigos de respaldo: %s', exc)
        return jsonify(error='No se pudieron regenerar los códigos de respaldo.'), 500

    return jsonify(message='Códigos de respaldo regenerados.', backup_codes=new_codes)


# Alias routes for backward compatibility with tests
@api.route("/2fa/totp/setup", methods=["GET", "POST"])
@require_session
def totp_setup_alias():
    """Alias para /account/2fa/setup (compatibilidad)."""
    return two_factor_setup()


@api.post("/2fa/totp/verify")
@require_session
def totp_verify_alias():
    """Alias para /account/2fa/enable (compatibilidad)."""
    return two_factor_enable()
