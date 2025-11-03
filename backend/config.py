"""Application configuration values."""
import os
import sys
import json
from typing import List, Optional
from pathlib import Path
from dotenv import load_dotenv


# --- Cargar variables de entorno ---
load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
INSTANCE_DIR = PROJECT_ROOT / "instance"

_ENV_ALIASES = {
    "dev": "development",
    "development": "development",
    "prod": "production",
    "production": "production",
    "testing": "test",
    "tests": "test",
    "pytest": "test",
    "test": "test",
}


def _normalize_env(value: str) -> str:
    normalized = _ENV_ALIASES.get(value.strip().lower(), value.strip().lower())
    return normalized or "production"


def detect_runtime_env() -> str:
    """Determina el entorno actual (production, development, test)."""
    explicit = (
        os.getenv("APP_ENV")
        or os.getenv("FLASK_ENV")
        or os.getenv("ENV")
        or ""
    ).strip()
    if explicit:
        return _normalize_env(explicit)

    if os.getenv("PYTEST_CURRENT_TEST") or any("pytest" in arg for arg in sys.argv):
        return "test"

    debug_flag = os.getenv("FLASK_DEBUG", "").strip().lower()
    if debug_flag in {"1", "true", "on", "yes"}:
        return "development"

    return "production"


def _fallback_database_uri(runtime_env: str) -> Optional[str]:
    """Determina la URI según entorno cuando DATABASE_URL no está definida."""
    if runtime_env == "test":
        return "sqlite:///:memory:"
    if runtime_env == "development":
        INSTANCE_DIR.mkdir(parents=True, exist_ok=True)
        sqlite_path = INSTANCE_DIR / "dev.db"
        return f"sqlite:///{sqlite_path}"
    return None


def init_app_config(app) -> None:
    """Aplica valores derivados del entorno sin forzar evaluación temprana."""
    runtime_env = _normalize_env(
        str(app.config.get("APP_ENV", "") or app.config.get("ENV", "")).strip()
        or detect_runtime_env()
    )
    app.config["APP_ENV"] = runtime_env
    app.config["ENV"] = runtime_env

    if "TESTING" not in app.config:
        app.config["TESTING"] = runtime_env == "test"
    if "DEBUG" not in app.config:
        app.config["DEBUG"] = runtime_env == "development"

    db_uri = app.config.get("SQLALCHEMY_DATABASE_URI") or os.getenv("DATABASE_URL")
    if not db_uri:
        db_uri = _fallback_database_uri(runtime_env)

    if not db_uri:
        raise RuntimeError(
            "FATAL: DATABASE_URL no está configurada y no existe fallback para producción. "
            "Establece DATABASE_URL con la cadena de conexión de PostgreSQL antes de iniciar en producción."
        )

    app.config["SQLALCHEMY_DATABASE_URI"] = db_uri

    # Asegura opciones base sin compartir referencias mutables
    engine_options = dict(app.config.get("SQLALCHEMY_ENGINE_OPTIONS") or {})
    if db_uri.startswith("sqlite:///"):
        engine_options.setdefault("connect_args", {"check_same_thread": False})
    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = engine_options


def parse_list_env(name: str) -> List[str]:
    raw = os.getenv(name, "").strip()
    if not raw:
        return []
    if raw.startswith("["):
        try:
            return [str(s) for s in json.loads(raw)]
        except Exception:
            return []
    return [item.strip() for item in raw.split(",") if item.strip()]


class Config:
    # clave secreta de flask
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key")

    # --- configuracion de base de datos ---
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = None

    _runtime = detect_runtime_env()
    TESTING = _runtime == "test"
    ENV = _runtime
    DEBUG = _runtime == "development"

    # configuracion para correo ---
    MAIL_SERVER = os.getenv('MAIL_SERVER')
    MAIL_PORT = int(os.getenv('MAIL_PORT', 587))
    MAIL_USE_TLS = os.getenv('MAIL_USE_TLS', 'true').lower() == 'true'
    MAIL_USE_SSL = os.getenv('MAIL_USE_SSL', 'false').lower() == 'true'
    MAIL_USERNAME = os.getenv('MAIL_USERNAME')
    MAIL_PASSWORD = os.getenv('MAIL_PASSWORD')

    MAIL_DEFAULT_SENDER = os.getenv('MAIL_DEFAULT_SENDER', os.getenv('MAIL_USERNAME'))

    # CORS & contacto
    CORS_ORIGINS = parse_list_env('CORS_ORIGINS')
    CONTACT_RECIPIENTS = parse_list_env('CONTACT_RECIPIENTS')
    CONTACT_RECIPIENT = CONTACT_RECIPIENTS[0] if CONTACT_RECIPIENTS else None
    ROLE_REQUEST_RECIPIENTS = parse_list_env('ROLE_REQUEST_RECIPIENTS') or CONTACT_RECIPIENTS

    # --- backups ---
    BACKUP_DIR = os.getenv('BACKUP_DIR', str(PROJECT_ROOT / "BackupsDB"))
    PG_DUMP_BIN = os.getenv('PG_DUMP_BIN', 'pg_dump')
    PG_RESTORE_BIN = os.getenv('PG_RESTORE_BIN', 'pg_restore')
