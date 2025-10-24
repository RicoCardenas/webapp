# tests/conftest.py
import os
import sys
import pathlib
import importlib
import uuid
from datetime import datetime, timedelta, timezone
import pytest

# ---------- PATH raíz del repo ----------
THIS = pathlib.Path(__file__).resolve()
ROOT = THIS.parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# ---------- Helpers ----------
def _try_import(*names):
    last = None
    for n in names:
        try:
            return importlib.import_module(n)
        except ModuleNotFoundError as e:
            last = e
    if last:
        raise last

def _get(mod, attr):
    return getattr(mod, attr) if hasattr(mod, attr) else None

# ---------- Detecta tu layout (backend/app/...) ----------
PKG_BASE = "backend"
PKG_APP = "backend.app"  # <- donde están extensions.py y models.py en tu árbol

# Fábrica / instancia Flask (probamos en orden más probable)
create_app = None
app_instance = None
for modname in (f"{PKG_APP}", f"{PKG_BASE}", f"{PKG_BASE}.run"):
    try:
        mod = importlib.import_module(modname)
    except ModuleNotFoundError:
        continue
    if callable(_get(mod, "create_app")):
        create_app = getattr(mod, "create_app")
        break
    if _get(mod, "app") is not None and app_instance is None:
        app_instance = getattr(mod, "app")

# Extensiones y modelos (EN backend/app/)
extensions = _try_import(f"{PKG_APP}.extensions")
models = _try_import(f"{PKG_APP}.models")

db = _get(extensions, "db")
bcrypt = _get(extensions, "bcrypt")
mail = _get(extensions, "mail")

Roles = _get(models, "Roles")
Users = _get(models, "Users")
UserTokens = _get(models, "UserTokens")
UserSessions = _get(models, "UserSessions")
PlotHistory = _get(models, "PlotHistory")

# ---------- Config de pruebas ----------
class TestConfig:
    TESTING = True
    SECRET_KEY = "testing-secret"
    SQLALCHEMY_DATABASE_URI = "sqlite:///./test_ecuplot.sqlite"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    MAIL_SUPPRESS_SEND = True
    MAIL_SERVER = "localhost"
    MAIL_PORT = 1025
    MAIL_USERNAME = "test@example.com"
    MAIL_PASSWORD = "dummy"
    MAIL_DEFAULT_SENDER = "noreply@ecuplot.test"

@pytest.fixture(scope="session", autouse=True)
def _clean_env():
    os.environ.pop("DATABASE_URL", None)
    yield

@pytest.fixture(scope="session")
def app():
    if create_app:
        app = create_app(TestConfig)
    elif app_instance:
        app = app_instance
        app.config.from_object(TestConfig)
    else:
        raise AttributeError(
            "No encuentro 'create_app' ni 'app' en backend/ ni backend/app/. "
            "Define create_app(...) en backend/__init__.py o backend/app/__init__.py"
        )

    if db is None:
        raise RuntimeError("No se pudo importar 'db' desde backend/app/extensions.py")

    with app.app_context():
        db.drop_all()
        db.create_all()
        if Roles and not db.session.execute(db.select(Roles).where(Roles.name == "user")).first():
            db.session.add(Roles(name="user", description="Default user role"))
            db.session.commit()
    yield app

    with app.app_context():
        db.session.remove()
        db.drop_all()

@pytest.fixture()
def client(app):
    return app.test_client()

@pytest.fixture()
def _db(app):
    return db

@pytest.fixture()
def models_ns():
    class NS: ...
    n = NS()
    n.Roles = Roles
    n.Users = Users
    n.UserTokens = UserTokens
    n.UserSessions = UserSessions
    n.PlotHistory = PlotHistory
    return n

@pytest.fixture()
def user_factory(app):
    def _mk_user(email="u@test.com", password="Password.123", verified=True):
        if bcrypt is None:
            raise RuntimeError("Falta 'bcrypt' en extensions.")
        with app.app_context():
            role = db.session.execute(db.select(Roles).where(Roles.name == "user")).scalar_one()
            pwd = bcrypt.generate_password_hash(password).decode("utf-8")
            u = Users(email=email, password_hash=pwd, role_id=role.id, is_verified=verified)
            if verified:
                u.verified_at = datetime.now(timezone.utc)
            db.session.add(u)
            db.session.commit()
            return u
    return _mk_user

@pytest.fixture()
def session_token_factory(app, user_factory):
    def _mk_session(user=None, ttl_days=7):
        with app.app_context():
            if user is None:
                user = user_factory()
            token = uuid.uuid4().hex + uuid.uuid4().hex
            s = UserSessions(
                session_token=token,
                user_id=user.id,
                expires_at=datetime.now(timezone.utc) + timedelta(days=ttl_days),
                ip_address="127.0.0.1",
                user_agent="pytest",
            )
            db.session.add(s)
            db.session.commit()
            return token, user
    return _mk_session

@pytest.fixture()
def auth_headers(session_token_factory):
    token, _ = session_token_factory()
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture()
def make_token(app, user_factory):
    def _mk(user=None, token_type="verify_email", ttl_hours=24):
        with app.app_context():
            if user is None:
                user = user_factory(verified=False)
            t = UserTokens(
                user_id=user.id,
                token=uuid.uuid4().hex,
                token_type=token_type,
                expires_at=datetime.now(timezone.utc) + timedelta(hours=ttl_hours),
            )
            db.session.add(t)
            db.session.commit()
            return t, user
    return _mk

@pytest.fixture()
def mail_outbox(monkeypatch):
    sent = []
    if mail is None:
        return sent
    def fake_send(message):
        sent.append(message)
    monkeypatch.setattr(mail, "send", fake_send)
    return sent
