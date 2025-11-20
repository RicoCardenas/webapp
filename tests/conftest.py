# tests/conftest.py
import os
import sys
import pathlib
import importlib
import uuid
import ast
import inspect
import re
import textwrap
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Optional

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
    APP_ENV = "test"
    LOG_LEVEL = None  # Auto-detect per APP_ENV during tests
    SECRET_KEY = "testing-secret"
    SQLALCHEMY_DATABASE_URI = "sqlite:///./test_ecuplot.sqlite"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    MAIL_SUPPRESS_SEND = True
    MAIL_SERVER = "localhost"
    MAIL_PORT = 1025
    MAIL_USERNAME = "test@example.com"
    MAIL_PASSWORD = "dummy"
    MAIL_DEFAULT_SENDER = "noreply@ecuplot.test"
    # Rate limiting - límites muy altos para tests (no queremos que interfieran)
    RATELIMIT_STORAGE_URI = "memory://"
    RATELIMIT_LOGIN = "100 per minute"
    RATELIMIT_REGISTER = "100 per minute"
    RATELIMIT_PASSWORD_RESET = "100 per minute"
    RATELIMIT_EMAIL_VERIFY = "100 per minute"
    RATELIMIT_CONTACT = "100 per minute"
    RATELIMIT_UNLOCK_ACCOUNT = "100 per minute"

@pytest.fixture(scope="session", autouse=True)
def _clean_env():
    """
    Limpia variables de entorno peligrosas antes de ejecutar tests.
    
    CRÍTICO: Esto previene que los tests usen accidentalmente la base de datos
    de producción y la eliminen con db.drop_all().
    """
    # Guardar valores originales
    original_database_url = os.environ.get("DATABASE_URL")
    original_sqlalchemy_uri = os.environ.get("SQLALCHEMY_DATABASE_URI")
    
    # REMOVER variables que apunten a PostgreSQL de producción
    os.environ.pop("DATABASE_URL", None)
    os.environ.pop("SQLALCHEMY_DATABASE_URI", None)
    
    # Forzar entorno de testing
    os.environ["APP_ENV"] = "test"
    os.environ["TESTING"] = "true"
    
    yield
    
    # Restaurar valores originales después de los tests
    if original_database_url:
        os.environ["DATABASE_URL"] = original_database_url
    if original_sqlalchemy_uri:
        os.environ["SQLALCHEMY_DATABASE_URI"] = original_sqlalchemy_uri

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
        # PROTECCIÓN CRÍTICA: Verificar que NO estamos usando PostgreSQL de producción
        db_uri = app.config.get("SQLALCHEMY_DATABASE_URI", "")
        if "postgresql" in db_uri.lower():
            raise RuntimeError(
                f"🔴 ALERTA DE SEGURIDAD: Los tests intentan usar PostgreSQL de producción!\n"
                f"   URI detectada: {db_uri}\n"
                f"   Los tests DEBEN usar SQLite para evitar eliminar datos de producción.\n"
                f"   Revisa TestConfig en conftest.py y la función init_app_config()."
            )
        
        # Solo si es SQLite, proceder con drop_all (seguro)
        if "sqlite" not in db_uri.lower():
            raise RuntimeError(
                f"🔴 Base de datos desconocida en tests: {db_uri}\n"
                f"   Solo se permite SQLite en tests."
            )
        
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
    # Use raise_server_exceptions=False para que 404, 400, etc. retornen respuestas
    # en lugar de levantar excepciones en los tests
    return app.test_client(use_cookies=True)

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

# ---------- Narrativa automática de pruebas ----------
HTTP_METHODS = {"get", "post", "put", "delete", "patch", "options"}
FEATURE_PREFIX = "tests"
_TEST_NARRATIVES = {}
_TERMINAL_REPORTER = None
_SUMMARY_DATA = {
    "total": 0,
    "outcomes": Counter(),
    "features": defaultdict(
        lambda: {
            "total": 0,
            "outcomes": Counter(),
            "scopes": set(),
            "methods": set(),
            "descriptions": [],
        }
    ),
}

@dataclass(frozen=True)
class TestNarrative:
    feature: str
    description: str
    methodology: str
    scope: str
    detail: Optional[str] = None

def pytest_runtest_setup(item):
    """
    Antes de cada prueba, imprime información contextual para facilitar
    la lectura del reporte de pytest.
    """
    global _TERMINAL_REPORTER
    if _TERMINAL_REPORTER is None:
        _TERMINAL_REPORTER = item.config.pluginmanager.get_plugin("terminalreporter")
    info = _build_test_narrative(item)
    _TEST_NARRATIVES[item.nodeid] = info

def pytest_runtest_logreport(report):
    if report.when != "call":
        return
    info = _TEST_NARRATIVES.pop(report.nodeid, None)
    if info is None:
        return
    outcome = {
        "passed": "PASÓ",
        "failed": "FALLÓ",
        "skipped": "SE OMITIÓ",
    }.get(report.outcome, report.outcome.upper())
    block = [
        f"[Prueba] {report.nodeid}",
        f"  Resultado    : {outcome}",
        f"  Funcionalidad: {info.feature}",
        f"  Descripción  : {info.description}",
        f"  Clasificación: {info.scope} | {info.methodology}",
    ]
    if info.detail:
        block.append(f"  Cobertura    : {info.detail}")
    message = "\n".join(block)
    if _TERMINAL_REPORTER:
        _TERMINAL_REPORTER.write_line(message)
    else:
        print(message)
    _record_summary(info, report.outcome)

def _build_test_narrative(item) -> TestNarrative:
    fixtures = set(getattr(item, "fixturenames", []))
    http_calls = _extract_http_calls(item.function)

    feature = _infer_feature_name(item)
    description = _resolve_description(item, feature, http_calls)
    methodology = _infer_methodology(fixtures)
    scope = _infer_scope(fixtures)
    detail = _format_http_calls(http_calls)

    return TestNarrative(
        feature=feature,
        description=description,
        methodology=methodology,
        scope=scope,
        detail=detail,
    )

def _infer_feature_name(item):
    try:
        rel = pathlib.Path(str(item.fspath)).resolve().relative_to(ROOT)
    except ValueError:
        rel = pathlib.Path(str(item.fspath)).name
    slug = str(rel)
    if slug.startswith(f"{FEATURE_PREFIX}/"):
        slug = slug[len(FEATURE_PREFIX) + 1 :]
    slug = slug.replace("test_", "").replace(".py", "")
    parts = [segment for segment in slug.split(os.sep) if segment]
    formatted = []
    for segment in parts:
        tokens = segment.replace("_", " ").split()
        pretty = " ".join(_title_case(token) for token in tokens)
        formatted.append(pretty or segment)
    return " > ".join(formatted) or "Suite de pruebas"

def _title_case(word):
    if not word:
        return word
    if word.isupper():
        return word
    if len(word) <= 3:
        return word.upper()
    return word.capitalize()

def _resolve_description(item, feature, http_calls):
    doc = inspect.getdoc(getattr(item, "function", None)) or ""
    if doc:
        return doc.strip().splitlines()[0]
    human_name = _humanize_identifier(getattr(item, "originalname", item.name))
    if http_calls:
        if len(http_calls) == 1:
            method, path = http_calls[0]
            return (
                f"Verifica que la petición {method} {path} responda correctamente "
                f"dentro de la funcionalidad de {feature.lower()}."
            )
        summary = ", ".join(f"{m} {p}" for m, p in http_calls)
        return f"Encadena llamadas ({summary}) para validar comportamientos de {feature.lower()}."
    return f"Valida el escenario '{human_name}' dentro de {feature.lower()}."

def _humanize_identifier(name):
    if not name:
        return "sin nombre"
    name = re.sub(r"^test_", "", name)
    name = re.sub(r"[_\s]+", " ", name)
    return name.strip()

def _infer_methodology(fixtures):
    if "client" in fixtures:
        return "Caja negra (interacción HTTP)"
    if fixtures & {"app", "_db", "models_ns", "user_factory", "session_token_factory"}:
        return "Caja blanca (capas internas controladas)"
    return "Caja blanca (lógica aislada)"

def _infer_scope(fixtures):
    if "client" in fixtures:
        return "Prueba funcional / integración"
    if fixtures & {"app", "_db", "models_ns", "user_factory", "session_token_factory", "mail_outbox"}:
        return "Prueba de integración"
    return "Prueba unitaria"

def _format_http_calls(http_calls):
    if not http_calls:
        return None
    unique = []
    for method, path in http_calls:
        label = f"{method} {path}"
        if label not in unique:
            unique.append(label)
    return "Interacciones HTTP: " + ", ".join(unique)

@lru_cache(maxsize=None)
def _extract_http_calls(func):
    if func is None:
        return ()
    try:
        source = inspect.getsource(func)
    except (OSError, TypeError):
        return ()
    source = textwrap.dedent(source)
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return ()
    visitor = _HTTPVisitor()
    visitor.visit(tree)
    return tuple(visitor.calls)

class _HTTPVisitor(ast.NodeVisitor):
    def __init__(self):
        self.calls = []

    def visit_Call(self, node):
        func = node.func
        if (
            isinstance(func, ast.Attribute)
            and isinstance(func.value, ast.Name)
            and func.value.id == "client"
            and func.attr.lower() in HTTP_METHODS
            and node.args
            and isinstance(node.args[0], ast.Constant)
            and isinstance(node.args[0].value, str)
        ):
            method = func.attr.upper()
            path = node.args[0].value
            self.calls.append((method, path))
        self.generic_visit(node)

def _record_summary(info, outcome):
    _SUMMARY_DATA["total"] += 1
    _SUMMARY_DATA["outcomes"][outcome] += 1
    bucket = _SUMMARY_DATA["features"][info.feature]
    bucket["total"] += 1
    bucket["outcomes"][outcome] += 1
    bucket["scopes"].add(info.scope)
    bucket["methods"].add(info.methodology)
    if len(bucket["descriptions"]) < 3 and info.description not in bucket["descriptions"]:
        bucket["descriptions"].append(info.description)

def pytest_terminal_summary(terminalreporter, exitstatus, config):
    if not _SUMMARY_DATA["total"]:
        return
    total = _SUMMARY_DATA["total"]
    outcomes = _SUMMARY_DATA["outcomes"]
    terminalreporter.write_sep("-", "Resumen general de pruebas")
    terminalreporter.write_line(
        f"Total: {total} | Pasaron: {outcomes.get('passed', 0)} | "
        f"Fallaron: {outcomes.get('failed', 0)} | Omitidas: {outcomes.get('skipped', 0)}"
    )
    terminalreporter.write_line("Cobertura por secciones:")
    for feature in sorted(_SUMMARY_DATA["features"]):
        bucket = _SUMMARY_DATA["features"][feature]
        desc = bucket["descriptions"][0] if bucket["descriptions"] else "Escenarios variados."
        scopes = ", ".join(sorted(bucket["scopes"]))
        methods = ", ".join(sorted(bucket["methods"]))
        terminalreporter.write_line(
            f" - {feature}: {bucket['total']} pruebas "
            f"(P:{bucket['outcomes'].get('passed', 0)} "
            f"F:{bucket['outcomes'].get('failed', 0)} "
            f"S:{bucket['outcomes'].get('skipped', 0)}) | "
            f"Alcance: {scopes} | Metodologías: {methods}"
        )
        terminalreporter.write_line(f"   Ejemplo: {desc}")
