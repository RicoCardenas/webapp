import uuid
from datetime import datetime, timezone
from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate
from flask_bcrypt import Bcrypt
from flask_mail import Mail
from flask_cors import CORS
from flask_limiter import Limiter
from sqlalchemy import event
from sqlalchemy.engine import Engine
from .services.request_utils import get_client_ip


db = SQLAlchemy(session_options={"expire_on_commit": False})
migrate = Migrate()
bcrypt = Bcrypt()
mail = Mail()
cors = CORS()
limiter = Limiter(
    key_func=get_client_ip,
    default_limits=[],  # No default limits, only explicit per-endpoint
    storage_uri="memory://",  # In-memory storage by default
)


@event.listens_for(Engine, "connect")
def _register_sqlite_functions(dbapi_connection, _):
	# Permite usar gen_random_uuid en SQLite durante pruebas.
	if dbapi_connection.__class__.__module__ == "sqlite3":
		dbapi_connection.create_function(
			"gen_random_uuid", 0, lambda: str(uuid.uuid4())
		)
		dbapi_connection.create_function(
			"utcnow", 0, lambda: datetime.now(timezone.utc).isoformat()
		)
