"""Application configuration values."""
import os
import json
from typing import List
from pathlib import Path
from dotenv import load_dotenv


# --- Cargar variables de entorno ---
load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
INSTANCE_DIR = PROJECT_ROOT / "instance"

def _detect_runtime_env() -> str:
    """Determina el entorno actual (production, development, test)."""
    explicit = (
        os.getenv("APP_ENV")
        or os.getenv("FLASK_ENV")
        or os.getenv("ENV")
        or ""
    ).strip().lower()

    if not explicit and os.getenv("PYTEST_CURRENT_TEST"):
        return "test"
    if explicit in {"testing"}:
        return "test"
    if explicit in {"dev"}:
        return "development"
    if explicit:
        return explicit
    if os.getenv("FLASK_DEBUG"):
        return "development"
    return "production"


RUNTIME_ENV = _detect_runtime_env()

def _resolve_database_uri() -> str:
    """Selecciona la URI de base de datos según el entorno."""
    db_url = os.getenv("DATABASE_URL")
    if db_url:
        return db_url

    if RUNTIME_ENV in {"test"}:
        return "sqlite:///:memory:"

    if RUNTIME_ENV in {"development"}:
        INSTANCE_DIR.mkdir(parents=True, exist_ok=True)
        sqlite_path = INSTANCE_DIR / "dev.db"
        return f"sqlite:///{sqlite_path}"

    raise RuntimeError(
        "FATAL: DATABASE_URL no está configurada. "
        "Establece DATABASE_URL con la cadena de conexión de PostgreSQL antes de iniciar en producción."
    )

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
    SQLALCHEMY_DATABASE_URI = _resolve_database_uri()
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {}
    if SQLALCHEMY_DATABASE_URI.startswith("sqlite:///"):
        SQLALCHEMY_ENGINE_OPTIONS["connect_args"] = {"check_same_thread": False}

    TESTING = RUNTIME_ENV == "test"
    ENV = RUNTIME_ENV
    DEBUG = RUNTIME_ENV == "development"

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
    
