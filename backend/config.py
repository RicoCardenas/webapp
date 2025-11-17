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

    # Verifica la clave secreta en producción para evitar valores inseguros.
    secret_key = app.config.get("SECRET_KEY") or os.getenv("SECRET_KEY")
    if runtime_env == "production":
        if not secret_key or secret_key == "dev-secret-key":
            raise RuntimeError(
                "FATAL: SECRET_KEY no está definida para producción. "
                "Establece SECRET_KEY con un valor aleatorio y seguro antes de iniciar la aplicación."
            )
    if secret_key:
        app.config["SECRET_KEY"] = secret_key

    db_uri = app.config.get("SQLALCHEMY_DATABASE_URI") or os.getenv("DATABASE_URL")
    
    # PROTECCIÓN CRÍTICA: En tests, NUNCA usar PostgreSQL de producción
    if runtime_env == "test" or app.config.get("TESTING"):
        # Si estamos en tests pero db_uri apunta a PostgreSQL, forzar SQLite
        if db_uri and db_uri.startswith("postgresql"):
            app.logger.warning(
                f"⚠️  TESTS intentando usar PostgreSQL - FORZANDO SQLite para proteger producción"
            )
            db_uri = "sqlite:///:memory:"
        # Si no hay db_uri en tests, usar memoria
        elif not db_uri:
            db_uri = "sqlite:///:memory:"
    elif not db_uri:
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

    try:
        max_sse = int(app.config.get("SSE_MAX_CONNECTIONS_PER_USER", 3))
    except (TypeError, ValueError):
        max_sse = 3
    app.config["SSE_MAX_CONNECTIONS_PER_USER"] = max(1, max_sse)

    hibp_flag = app.config.get("HIBP_PASSWORD_CHECK_ENABLED", os.getenv("HIBP_PASSWORD_CHECK_ENABLED", "false"))
    hibp_normalized = str(hibp_flag).strip().lower() in {"1", "true", "yes", "on"}
    app.config["HIBP_PASSWORD_CHECK_ENABLED"] = hibp_normalized

    hibp_threshold_raw = app.config.get("HIBP_PASSWORD_MIN_COUNT", os.getenv("HIBP_PASSWORD_MIN_COUNT", "1"))
    try:
        hibp_threshold = int(hibp_threshold_raw)
    except (TypeError, ValueError):
        hibp_threshold = 1
    app.config["HIBP_PASSWORD_MIN_COUNT"] = max(1, hibp_threshold)


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
    CORS_SUPPORTS_CREDENTIALS = os.getenv('CORS_SUPPORTS_CREDENTIALS', 'false').lower() == 'true'

    try:
        _sse_limit = int(os.getenv('SSE_MAX_CONNECTIONS_PER_USER', '3'))
    except ValueError:
        _sse_limit = 3
    SSE_MAX_CONNECTIONS_PER_USER = max(1, _sse_limit)
    del _sse_limit

    # --- backups ---
    BACKUP_DIR = os.getenv('BACKUP_DIR', str(PROJECT_ROOT / "BackupsDB"))
    PG_DUMP_BIN = os.getenv('PG_DUMP_BIN', 'pg_dump')
    PG_RESTORE_BIN = os.getenv('PG_RESTORE_BIN', 'pg_restore')

    HIBP_PASSWORD_CHECK_ENABLED = os.getenv('HIBP_PASSWORD_CHECK_ENABLED', 'false').lower() in {'1', 'true', 'yes', 'on'}
    try:
        _hibp_threshold = int(os.getenv('HIBP_PASSWORD_MIN_COUNT', '1'))
    except ValueError:
        _hibp_threshold = 1
    HIBP_PASSWORD_MIN_COUNT = max(1, _hibp_threshold)
    del _hibp_threshold

    # --- Rate Limiting Configuration ---
    RATELIMIT_STORAGE_URI = os.getenv('RATELIMIT_STORAGE_URI', 'memory://')
    # Per-endpoint rate limits (configurable via environment)
    RATELIMIT_LOGIN = os.getenv('RATELIMIT_LOGIN', '10 per 5 minutes')
    RATELIMIT_REGISTER = os.getenv('RATELIMIT_REGISTER', '5 per hour')
    RATELIMIT_PASSWORD_RESET = os.getenv('RATELIMIT_PASSWORD_RESET', '3 per hour')
    RATELIMIT_EMAIL_VERIFY = os.getenv('RATELIMIT_EMAIL_VERIFY', '5 per hour')
    RATELIMIT_CONTACT = os.getenv('RATELIMIT_CONTACT', '5 per hour')
    RATELIMIT_UNLOCK_ACCOUNT = os.getenv('RATELIMIT_UNLOCK_ACCOUNT', '3 per hour')

    # --- Logging Configuration ---
    LOG_LEVEL = os.getenv('LOG_LEVEL', None)  # None = auto-detect based on APP_ENV
    LOG_JSON_ENABLED = None  # None = auto-detect (True for production, False otherwise)
    _log_json_env = os.getenv('LOG_JSON_ENABLED', '').strip().lower()
    if _log_json_env in {'1', 'true', 'yes', 'on'}:
        LOG_JSON_ENABLED = True
    elif _log_json_env in {'0', 'false', 'no', 'off'}:
        LOG_JSON_ENABLED = False
    del _log_json_env

    # --- Sentry Configuration ---
    SENTRY_DSN = os.getenv('SENTRY_DSN')
    SENTRY_ENVIRONMENT = os.getenv('SENTRY_ENVIRONMENT')  # None = auto-detect from APP_ENV
    
    # Sentry traces sample rate (0.0 to 1.0)
    # 1.0 = 100% of transactions, 0.1 = 10% of transactions
    try:
        _traces_sample_rate = float(os.getenv('SENTRY_TRACES_SAMPLE_RATE', '0.1'))
    except ValueError:
        _traces_sample_rate = 0.1
    SENTRY_TRACES_SAMPLE_RATE = max(0.0, min(1.0, _traces_sample_rate))
    del _traces_sample_rate
    
    # Enable/disable Sentry profiling
    _sentry_profiling = os.getenv('SENTRY_ENABLE_PROFILING', 'false').strip().lower()
    SENTRY_ENABLE_PROFILING = _sentry_profiling in {'1', 'true', 'yes', 'on'}
    del _sentry_profiling
    
    # Enable Sentry in development (for testing only)
    _sentry_enable_in_dev = os.getenv('SENTRY_ENABLE_IN_DEV', 'false').strip().lower()
    SENTRY_ENABLE_IN_DEV = _sentry_enable_in_dev in {'1', 'true', 'yes', 'on'}
    del _sentry_enable_in_dev
