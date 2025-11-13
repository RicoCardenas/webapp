"""
Servicio de validación de contraseñas.
"""

import hashlib
import re
import urllib.request as urllib_request
import urllib.error as urllib_error
from functools import lru_cache

from flask import current_app

# Constantes de configuración
HIBP_API_RANGE_URL = "https://api.pwnedpasswords.com/range/"
HIBP_USER_AGENT = "EcuPlotPasswordChecker/1.0"
PASSWORD_POLICY_MESSAGE = (
    "La contraseña debe tener al menos 8 caracteres, con una letra mayúscula, "
    "una letra minúscula, un número y un carácter especial."
)


def _log_warning(message: str, *args) -> None:
    """Helper para logging seguro."""
    try:
        current_app.logger.warning(message, *args)
    except Exception:
        pass


@lru_cache(maxsize=512)
def hibp_fetch_range(prefix: str) -> dict[str, int]:
    """
    Recupera el mapa de sufijos SHA1 -> número de apariciones desde HIBP.
    
    Args:
        prefix: Primeros 5 caracteres del hash SHA1 en hexadecimal
        
    Returns:
        Diccionario con sufijos (35 caracteres) como claves y conteos como valores
    """
    prefix = (prefix or "").strip().upper()
    if len(prefix) != 5 or not prefix.isalnum():
        return {}

    url = f"{HIBP_API_RANGE_URL}{prefix}"
    request = urllib_request.Request(url, headers={"User-Agent": HIBP_USER_AGENT})

    try:
        with urllib_request.urlopen(request, timeout=3.0) as response:
            if getattr(response, "status", 200) >= 400:
                _log_warning("HIBP devolvió estado inesperado (%s)", getattr(response, "status", "unknown"))
                return {}
            payload = response.read().decode("utf-8", errors="ignore")
    except (urllib_error.URLError, urllib_error.HTTPError) as exc:
        _log_warning("No se pudo consultar HIBP: %s", exc)
        return {}
    except Exception as exc:  # pragma: no cover - ruta defensiva
        _log_warning("Fallo inesperado consultando HIBP: %s", exc)
        return {}

    results: dict[str, int] = {}
    for line in payload.splitlines():
        if not line or ":" not in line:
            continue
        suffix, count = line.split(":", 1)
        suffix = suffix.strip().upper()
        if len(suffix) != 35:
            continue
        try:
            results[suffix] = int(count.strip())
        except ValueError:
            continue
    return results


def password_is_compromised(password: str, minimum_count: int) -> bool:
    """
    Verifica si una contraseña aparece en bases de datos filtradas (HIBP).
    
    Args:
        password: Contraseña a verificar
        minimum_count: Número mínimo de apariciones para considerar comprometida
        
    Returns:
        True si la contraseña está comprometida, False en caso contrario
    """
    if not password:
        return False
    digest = hashlib.sha1(password.encode("utf-8")).hexdigest().upper()
    prefix, suffix = digest[:5], digest[5:]
    matches = hibp_fetch_range(prefix)
    count = matches.get(suffix, 0)
    return count >= max(1, minimum_count)


def password_strength_error(password: str | None) -> str | None:
    """
    Valida que una contraseña cumpla con la política de seguridad.
    
    Requisitos:
    - Mínimo 8 caracteres
    - Al menos una mayúscula
    - Al menos una minúscula
    - Al menos un dígito
    - Al menos un carácter especial
    - No debe estar en bases de datos filtradas (si HIBP está habilitado)
    
    Args:
        password: Contraseña a validar
        
    Returns:
        Mensaje de error si no cumple la política, None si es válida
    """
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
    
    # Verificación opcional contra HIBP
    if current_app.config.get("HIBP_PASSWORD_CHECK_ENABLED"):
        threshold = current_app.config.get("HIBP_PASSWORD_MIN_COUNT", 1)
        try:
            threshold_value = int(threshold)
        except (TypeError, ValueError):
            threshold_value = 1
        if password_is_compromised(password, threshold_value):
            return "Esta contraseña aparece en bases de datos filtradas. Usa una contraseña distinta."
    
    return None
