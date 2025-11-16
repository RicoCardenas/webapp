"""Application factory for the backend service."""
from pathlib import Path
from flask import Flask, g
from backend.config import Config, init_app_config

# Importamos las instancias de las extensiones
from .extensions import db, migrate, bcrypt, mail, cors, limiter
from .event_stream import events as event_bus
from .logging_config import configure_logging, setup_request_logging

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PUBLIC_DIR = PROJECT_ROOT / "frontend" / "public"
STATIC_DIR = PROJECT_ROOT / "frontend" / "src"


def init_sentry(app: Flask) -> None:
    """
    Inicializa Sentry para monitoreo de errores y rendimiento.
    
    Solo se activa si:
    - SENTRY_DSN está configurado
    - El entorno es 'production', 'staging', o 'development' con SENTRY_ENABLE_IN_DEV=true
    """
    sentry_dsn = app.config.get('SENTRY_DSN')
    if not sentry_dsn:
        app.logger.info("Sentry no inicializado: SENTRY_DSN no configurado")
        return
    
    runtime_env = app.config.get('APP_ENV', 'production')
    
    # Permitir Sentry en development solo si se habilita explícitamente
    enable_in_dev = app.config.get('SENTRY_ENABLE_IN_DEV', False)
    
    # Solo habilitar Sentry en producción, staging, o development (si está habilitado)
    if runtime_env not in {'production', 'staging'}:
        if runtime_env == 'development' and enable_in_dev:
            app.logger.info(f"Sentry habilitado en development (SENTRY_ENABLE_IN_DEV=true)")
        else:
            app.logger.info(f"Sentry no inicializado: entorno '{runtime_env}' no es production/staging")
            return
    
    try:
        import sentry_sdk
        from sentry_sdk.integrations.flask import FlaskIntegration
        from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
        
        # Determinar el entorno de Sentry
        sentry_environment = app.config.get('SENTRY_ENVIRONMENT') or runtime_env
        
        # Obtener configuración de muestreo
        traces_sample_rate = app.config.get('SENTRY_TRACES_SAMPLE_RATE', 0.1)
        enable_profiling = app.config.get('SENTRY_ENABLE_PROFILING', False)
        
        sentry_sdk.init(
            dsn=sentry_dsn,
            environment=sentry_environment,
            integrations=[
                FlaskIntegration(),
                SqlalchemyIntegration(),
            ],
            # Porcentaje de transacciones a monitorear (0.0 - 1.0)
            traces_sample_rate=traces_sample_rate,
            # Habilitar profiling si está configurado
            profiles_sample_rate=traces_sample_rate if enable_profiling else 0.0,
            # Enviar PII (Personally Identifiable Information) - ajustar según necesidades
            send_default_pii=False,
            # Versión de la aplicación (si está disponible)
            release=app.config.get('APP_VERSION'),
        )
        
        # Hook para agregar contexto adicional a los eventos de Sentry
        @app.before_request
        def add_sentry_context():
            """Agrega contexto del usuario y request a Sentry."""
            if hasattr(g, 'current_user') and g.current_user:
                sentry_sdk.set_user({
                    "id": str(g.current_user.id),
                    "email": g.current_user.email,
                    "username": g.current_user.name,
                })
            
            # Agregar tags personalizados
            sentry_sdk.set_tag("app_env", runtime_env)
        
        app.logger.info(
            f"Sentry inicializado correctamente "
            f"[environment={sentry_environment}, traces_sample_rate={traces_sample_rate}]"
        )
        
    except ImportError:
        app.logger.warning("Sentry SDK no está instalado. Ejecuta: pip install 'sentry-sdk[flask,sqlalchemy]'")
    except Exception as e:
        app.logger.error(f"Error al inicializar Sentry: {e}", exc_info=True)


def create_app(config_object=Config) -> Flask:
    """
    Fábrica de la aplicación Flask.
    Configura la app
    """
    app = Flask(
        __name__,
        static_folder=str(STATIC_DIR),
        static_url_path="/static",
        template_folder=str(PUBLIC_DIR),
    )

    app.config.from_object(config_object)
    init_app_config(app)

    # Configure structured logging early
    configure_logging(app)
    setup_request_logging(app)
    
    # Initialize Sentry for error and performance monitoring
    init_sentry(app)

    # Inicializar Extensiones
    # Vinculamos las instancias de 'extensions.py' con nuestra 'app'
    db.init_app(app)
    migrate.init_app(app, db)
    bcrypt.init_app(app)
    mail.init_app(app)
    runtime_env = app.config.get("APP_ENV", "production")
    cors_origins = app.config.get("CORS_ORIGINS") or []

    if runtime_env == "production":
        if not cors_origins:
            raise RuntimeError(
                "FATAL: CORS_ORIGINS no está configurado para producción. "
                "Define una lista de dominios permitidos antes de iniciar la aplicación."
            )
    if not cors_origins:
        cors_origins = "*"

    supports_credentials = bool(app.config.get("CORS_SUPPORTS_CREDENTIALS", False))

    cors.init_app(
        app,
        resources={r"/api/*": {"origins": cors_origins}},
        supports_credentials=supports_credentials,
    )

    # Initialize rate limiter
    # Note: storage_uri debe configurarse en el limiter object antes de init_app
    storage_uri = app.config.get("RATELIMIT_STORAGE_URI", "memory://")
    limiter.storage_uri = storage_uri
    limiter.init_app(app)

    event_bus.set_max_subscribers(app.config.get("SSE_MAX_CONNECTIONS_PER_USER", 3))

    with app.app_context():
        from . import models

    # Importar blueprints desde el paquete routes modular
    from .routes import api as api_blueprint
    from .routes import frontend as frontend_blueprint

    app.register_blueprint(frontend_blueprint)
    app.register_blueprint(api_blueprint, url_prefix="/api")

    return app
