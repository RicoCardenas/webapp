"""
Servicio de gestión de tokens de usuario.

Funciones:
- issue_user_token: Crea tokens únicos para verificación de email, reset de password, etc.
"""

import secrets
from datetime import datetime, timezone, timedelta

from sqlalchemy import delete

from ..extensions import db
from ..models import UserTokens

# Constantes de TTL para tokens
ACCOUNT_UNLOCK_TOKEN_TTL = timedelta(hours=24)
PASSWORD_RESET_TOKEN_TTL = timedelta(hours=1)
SSE_STREAM_TOKEN_TTL = timedelta(minutes=5)


def issue_user_token(user, token_type, expires_delta):
    """
    Crea un token único para el usuario, reemplazando los anteriores del mismo tipo.
    
    Los tokens previos del mismo tipo que no han sido usados son eliminados
    para evitar múltiples tokens activos simultáneos.
    
    Args:
        user: Instancia de Users
        token_type: Tipo de token ('email_verification', 'password_reset', 'unlock_account', etc.)
        expires_delta: timedelta indicando cuándo expira el token
        
    Returns:
        Instancia de UserTokens creada (no committeada)
    """
    token_value = secrets.token_urlsafe(48)
    expiry = datetime.now(timezone.utc) + expires_delta

    # Eliminar tokens previos del mismo tipo no usados
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
