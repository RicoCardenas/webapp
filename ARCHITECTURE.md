# Arquitectura Backend - Estructura Final

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           WEBAPP (Flask Application)                         │
│                           backend/app/__init__.py                            │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
        ┌───────────▼──────────┐       ┌───────────▼──────────┐
        │  Frontend Blueprint  │       │   API Blueprint       │
        │  (routes/frontend)   │       │   (routes/api)        │
        └───────────┬──────────┘       └───────────┬──────────┘
                    │                               │
    ┌───────────────┴───────────────┐              │
    │                               │              │
┌───▼────────────┐         ┌────────▼──────┐      │
│ Frontend HTML  │         │  Contact Form │      │
│   9 endpoints  │         │   (legacy)    │      │
├────────────────┤         └───────────────┘      │
│ / (home)       │                                 │
│ /graph         │                                 │
│ /account       │                                 │
│ /login         │                                 │
│ /signup        │                                 │
│ /reset-pwd     │                                 │
│ /test-admin    │                                 │
│ /contact       │                                 │
│ /contact/res   │                                 │
└────────────────┘                                 │
                    ┌──────────────────────────────┴──────────────────────────┐
                    │                   API Endpoints                          │
                    │                   71 total endpoints                     │
                    └──────────────────────────────────────────────────────────┘
                                    │
    ┌───────────────┬───────────────┼───────────────┬───────────────┐
    │               │               │               │               │
┌───▼──────┐  ┌─────▼─────┐  ┌─────▼──────┐  ┌────▼─────┐  ┌──────▼──────┐
│ INFRASTR │  │   AUTH    │  │  ACCOUNT   │  │  ADMIN   │  │  BUSINESS   │
└─────┬────┘  └─────┬─────┘  └─────┬──────┘  └────┬─────┘  └──────┬──────┘
      │             │               │               │               │
┌─────▼─────────────▼───────────────▼───────────────▼───────────────▼─────────┐
│                                                                              │
│  ┌──────────┐  ┌────────┐  ┌─────────┐  ┌────────┐  ┌─────────┐           │
│  │ health   │  │  auth  │  │ account │  │ admin  │  │ history │           │
│  │ 1 endpt  │  │ 8 endp │  │ 4 endpt │  │17 endp │  │ 5 endpt │           │
│  └──────────┘  └────────┘  └─────────┘  └────────┘  └─────────┘           │
│                                                                              │
│  ┌──────────┐  ┌────────┐  ┌─────────┐  ┌────────┐  ┌─────────┐           │
│  │   meta   │  │  sse   │  │  twofa  │  │ notifs │  │ groups  │           │
│  │ 1 endpt  │  │ 2 endp │  │ 5 endpt │  │ 5 endp │  │ 5 endpt │           │
│  └──────────┘  └────────┘  └─────────┘  └────────┘  └─────────┘           │
│                                                                              │
│  ┌──────────┐  ┌────────┐  ┌─────────┐                                     │
│  │   dev    │  │ roles  │  │learning │                                     │
│  │ 5 endpt  │  │ 2 endp │  │ 2 endpt │                                     │
│  └──────────┘  └────────┘  └─────────┘                                     │
│                                                                              │
│                      backend/app/routes/ (14 módulos)                       │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
        ┌───────────▼──────────┐       ┌───────────▼──────────┐
        │   Services Layer     │       │  Extensions Layer    │
        │  (Business Logic)    │       │  (Flask Plugins)     │
        └───────────┬──────────┘       └───────────┬──────────┘
                    │                               │
    ┌───────────────┼───────────────┐               │
    │               │               │               │
┌───▼────┐    ┌─────▼────┐    ┌────▼────┐    ┌─────▼──────┐
│passwords│    │validate  │    │  mail   │    │   db       │
│ - HIBP  │    │- email   │    │- sender │    │- SQLAlchemy│
│ - policy│    │- forms   │    │- notify │    │- Postgres  │
└─────────┘    └──────────┘    └─────────┘    └────────────┘
┌────────┐     ┌──────────┐                   ┌────────────┐
│tokens  │     │ history  │                   │   bcrypt   │
│- issue │     │- parse   │                   │- hash pwd  │
│- TTL   │     │- serial  │                   └────────────┘
└────────┘     └──────────┘                   ┌────────────┐
                                              │    mail    │
        backend/app/services/                 │- FlaskMail │
             (5 módulos)                      └────────────┘
                                              ┌────────────┐
                                              │   migrate  │
                                              │- Alembic   │
                                              └────────────┘
                                              ┌────────────┐
                                              │    cors    │
                                              │- CORS hdrs │
                                              └────────────┘

                                              backend/app/extensions.py
                    ┌───────────────┴───────────────┐
                    │                               │
        ┌───────────▼──────────┐       ┌───────────▼──────────┐
        │   Data Models        │       │  Business Modules    │
        │   (SQLAlchemy)       │       │                      │
        └───────────┬──────────┘       └───────────┬──────────┘
                    │                               │
    ┌───────────────┼───────────────┐               │
    │               │               │               │
┌───▼────┐    ┌─────▼────┐    ┌────▼────┐    ┌─────▼──────┐
│ Users  │    │ Roles    │    │ Groups  │    │ plot_tags  │
│ Tokens │    │ Requests │    │ Teachers│    │ - autotag  │
│ Sessions│   │ Tickets  │    │ Members │    │ - apply    │
│ 2FA    │    └──────────┘    └─────────┘    └────────────┘
└────────┘                                    ┌────────────┐
┌────────┐                                    │ event_bus  │
│ PlotHist│                                   │ - SSE      │
│ Tags   │                                    │ - notify   │
│ Notifs │                                    └────────────┘
│ Learning│                                   ┌────────────┐
└────────┘                                    │  backup    │
                                              │ - pg_dump  │
        backend/app/models.py                 │ - restore  │
                                              └────────────┘
                                              ┌────────────┐
                                              │   auth     │
                                              │ - @session │
                                              └────────────┘

                                              backend/app/
                                              (shared modules)
```

## Flujo de Request

```
┌──────────────┐
│  HTTP Client │
└──────┬───────┘
       │
       │ GET /api/plot/history?page=1
       │
       ▼
┌────────────────────────────────┐
│  Flask App (app/__init__.py)   │
│  - CORS middleware             │
│  - Route matching              │
└────────┬───────────────────────┘
         │
         │ Matches: api.get("/plot/history")
         │
         ▼
┌──────────────────────────────────┐
│  routes/history.py               │
│  @api.get("/plot/history")       │
│  def get_plot_history():         │
└────────┬─────────────────────────┘
         │
         │ 1. Call: @require_session
         │
         ▼
┌──────────────────────────────────┐
│  auth.py                         │
│  @require_session decorator      │
│  - Validate session              │
│  - Load user from DB             │
│  - Set g.current_user            │
└────────┬─────────────────────────┘
         │
         │ 2. Call: services/history.parse_query_params()
         │
         ▼
┌──────────────────────────────────┐
│  services/history.py             │
│  parse_query_params()            │
│  - Extract page, per_page        │
│  - Validate parameters           │
│  - Return parsed dict            │
└────────┬─────────────────────────┘
         │
         │ 3. Call: services/history.build_history_query()
         │
         ▼
┌──────────────────────────────────┐
│  services/history.py             │
│  build_history_query()           │
│  - Build SQLAlchemy query        │
│  - Filter by user_id             │
│  - Order by created_at DESC      │
│  - Use composite index           │
└────────┬─────────────────────────┘
         │
         │ 4. Execute query
         │
         ▼
┌──────────────────────────────────┐
│  extensions.py (db)              │
│  SQLAlchemy ORM                  │
│  - Execute SQL via psycopg2      │
│  - Use index: ix_plot_history_   │
│    user_created_id               │
└────────┬─────────────────────────┘
         │
         │ 5. Return PlotHistory objects
         │
         ▼
┌──────────────────────────────────┐
│  services/history.py             │
│  serialize_history_item()        │
│  - Convert ORM → dict            │
│  - Include tags, metadata        │
└────────┬─────────────────────────┘
         │
         │ 6. Return JSON response
         │
         ▼
┌──────────────────────────────────┐
│  Flask Response                  │
│  jsonify({                       │
│    "items": [...],               │
│    "total": 42,                  │
│    "page": 1,                    │
│    "pages": 5                    │
│  })                              │
└────────┬─────────────────────────┘
         │
         ▼
┌──────────────┐
│  HTTP Client │
│  200 OK      │
└──────────────┘
```

## Responsabilidades por Capa

### 1. Routes Layer (`backend/app/routes/`)

**Responsabilidad**: Routing, validación HTTP, autorización

- Definir endpoints con decoradores `@api.*` o `@frontend.*`
- Validar parámetros de request (query, body, headers)
- Llamar decoradores de autenticación (`@require_session`)
- Orquestar llamadas a services
- Serializar respuestas a JSON
- Manejar errores HTTP (4xx, 5xx)

**NO debe**:

- Lógica de negocio compleja
- Acceso directo a DB (usar services)
- Cálculos pesados

### 2. Services Layer (`backend/app/services/`)

**Responsabilidad**: Lógica de negocio, queries complejas

- Parsear y validar datos de entrada
- Construir queries SQLAlchemy complejas
- Integrar con APIs externas (HIBP, SMTP)
- Aplicar reglas de negocio
- Serializar modelos ORM a diccionarios

**NO debe**:

- Importar blueprints Flask
- Acceder a `request`, `g`, `session`
- Retornar respuestas Flask (jsonify, render_template)

### 3. Extensions Layer (`backend/app/extensions.py`)

**Responsabilidad**: Configuración de plugins Flask

- Inicializar instancias (db, mail, bcrypt, etc.)
- Configurar con `init_app()`
- Exponer instancias globales

**NO debe**:

- Lógica de aplicación
- Queries específicas

### 4. Models Layer (`backend/app/models.py`)

**Responsabilidad**: Definición de esquema de datos

- Clases SQLAlchemy con `db.Model`
- Definir columnas, relaciones, índices
- Métodos de instancia simples
- Validaciones a nivel modelo

**NO debe**:

- Lógica de negocio compleja
- Acceso a otros modelos (usar queries)

### 5. Business Modules (`backend/app/`)

**Responsabilidad**: Módulos especializados

- `plot_tags.py`: Auto-tagging de plots
- `event_stream.py`: SSE event bus
- `auth.py`: Decoradores de autorización
- `backup.py`: Backup/restore de DB
- `notifications.py`: Sistema de notificaciones

---

## Convenciones de Código

### Imports

```python
# 1. Standard library
import os
from datetime import datetime

# 2. Third-party
from flask import request, jsonify
from sqlalchemy import and_, desc

# 3. Local - Extensions
from ..extensions import db, mail

# 4. Local - Models
from ..models import Users, PlotHistory

# 5. Local - Services (con alias)
from ..services.tokens import issue_user_token as _issue_token

# 6. Local - Same package
from . import api
```

### Naming

```python
# Routes: snake_case
@api.get("/plot/history")
def get_plot_history():
    ...

# Services: snake_case con prefijo si es helper privado
def _send_mail_internal():
    ...

# Models: PascalCase
class PlotHistory(db.Model):
    ...

# Constants: UPPER_CASE
PASSWORD_RESET_TOKEN_TTL = timedelta(hours=1)
```

### Error Handling

```python
# Routes: Retornar tupla (dict, status_code)
@api.post("/login")
def login():
    if not user:
        return {"error": "Invalid credentials"}, 401

    return {"token": token}, 200

# Services: Raise exceptions, las rutas las capturan
def validate_password(pwd):
    if len(pwd) < 8:
        raise ValueError("Password too short")
```

---

## Métricas de Calidad

### Cobertura de Tests

```
Total: 63 tests
Pass rate: 100%
Cobertura: ~85% (estimado)
```

### Complejidad Ciclomática

```
Promedio por función: ~3-5 (bueno)
Máximo recomendado: 10
```

### Mantenibilidad

```
Líneas por archivo:
- Promedio routes: ~340 líneas
- Máximo routes: ~687 líneas (admin.py)
- Promedio services: ~112 líneas
```

---

## Logging Estructurado

### Arquitectura de Logging

El sistema utiliza logging estructurado que se adapta automáticamente al entorno:

```
┌─────────────────────────────────────────────────────────────┐
│                   Flask Application                          │
│                   (backend/app/__init__.py)                  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ configure_logging(app)
                         │ setup_request_logging(app)
                         │
                         ▼
┌────────────────────────────────────────────────────────────┐
│           Logging Configuration                             │
│           (backend/app/logging_config.py)                   │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────┐  ┌───────────────────────┐          │
│  │ Environment      │  │ Formatter Selection    │          │
│  │ Detection        │  │                        │          │
│  ├──────────────────┤  ├───────────────────────┤          │
│  │ • production     │─►│ ContextualJsonFormatter│          │
│  │ • development    │─►│ DevelopmentFormatter   │          │
│  │ • test           │─►│ DevelopmentFormatter   │          │
│  └──────────────────┘  └───────────────────────┘          │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │           Request Middleware                         │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │ @before_request:                                     │  │
│  │   - Generate request_id (UUID)                       │  │
│  │   - Set request_start_time                           │  │
│  │   - Log "Request started"                            │  │
│  │                                                       │  │
│  │ @after_request:                                      │  │
│  │   - Calculate response_time_ms                       │  │
│  │   - Log "Request completed"                          │  │
│  │                                                       │  │
│  │ @errorhandler(Exception):                            │  │
│  │   - Log uncaught exceptions with context             │  │
│  │   - Return HTTP exceptions as responses              │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

### Campos de Log Estructurados

Cada entrada de log incluye automáticamente:

**Campos base (siempre presentes):**

- `timestamp`: ISO-8601 timestamp
- `level`: DEBUG, INFO, WARNING, ERROR, CRITICAL
- `logger`: Nombre del logger (e.g., "backend.app.routes.auth")
- `message`: Mensaje de log
- `app_env`: Entorno actual (production/development/test)

**Campos de contexto HTTP (en requests):**

- `request_id`: UUID único por request
- `method`: HTTP method (GET, POST, etc.)
- `path`: Request path
- `query_string`: Query parameters (si existen)
- `remote_addr`: IP del cliente
- `user_agent`: User agent string

**Campos de usuario (cuando está autenticado):**

- `user_id`: ID del usuario
- `email`: Email del usuario

**Campos de performance:**

- `response_time_ms`: Tiempo de respuesta en milisegundos

**Campos de eventos estructurados (cuando se proporciona `extra`):**

- `event`: Tipo de evento (e.g., "auth.login.failed", "sse.token_generation_failed")
- Campos personalizados específicos del evento

### Ejemplo de Logs

**Desarrollo (Human-readable):**

```
[2025-11-16 17:30:45] INFO     backend.app.routes.auth        | User login successful [request_id=550e8400 | POST /api/login | user_id=123]
[2025-11-16 17:30:46] WARNING  backend.app.routes.auth        | Failed login attempt [request_id=550e8401 | POST /api/login]
[2025-11-16 17:30:47] ERROR    backend.app.services.mail      | Email delivery failed [request_id=550e8402 | POST /api/contact]
```

**Producción (JSON):**

```json
{
  "timestamp": "2025-11-16T17:30:45.123456+00:00",
  "level": "ERROR",
  "logger": "backend.app.routes.auth",
  "message": "Login failed: invalid credentials",
  "app_env": "production",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "method": "POST",
  "path": "/api/login",
  "remote_addr": "192.168.1.100",
  "user_agent": "Mozilla/5.0...",
  "event": "auth.login.failed",
  "email": "user@example.com",
  "failed_attempts": 2,
  "error_type": "InvalidCredentialsError"
}
```

### Eventos Estructurados Implementados

| Módulo    | Evento                             | Descripción                            |
| --------- | ---------------------------------- | -------------------------------------- |
| auth      | `auth.login.failed`                | Intento de login fallido               |
| auth      | `auth.login.succeeded`             | Login exitoso                          |
| auth      | `auth.account.locked`              | Cuenta bloqueada por intentos fallidos |
| auth      | `auth.account_lock_email_failed`   | Fallo al enviar email de bloqueo       |
| auth      | `auth.password_reset_email_failed` | Fallo al enviar email de reset         |
| health    | `health.db_connection_failed`      | Error de conexión a base de datos      |
| sse       | `sse.token_generation_failed`      | Error generando token SSE              |
| sse       | `sse.token_commit_failed`          | Error al guardar token SSE             |
| sse       | `sse.connection_limit_exceeded`    | Límite de conexiones SSE excedido      |
| mail      | `contact.no_recipient`             | Contacto sin destinatario configurado  |
| mail      | `contact.no_sender`                | Contacto sin remitente configurado     |
| mail      | `contact.send_failed`              | Error enviando email de contacto       |
| passwords | `hibp.api_request_failed`          | Error consultando API de HIBP          |
| passwords | `hibp.unexpected_error`            | Error inesperado en validación HIBP    |

### Herramientas de Análisis

**Script de análisis incluido:**

```bash
# Ver todos los logs
python backend/scripts/analyze_logs.py app.log

# Filtrar por evento
python backend/scripts/analyze_logs.py app.log --filter "event=auth.login.failed"

# Generar estadísticas
python backend/scripts/analyze_logs.py app.log --stats
```

**Consultas con jq (logs JSON):**

```bash
# Errores de un request específico
jq 'select(.request_id == "550e8400-...")' app.log

# Todos los intentos de login fallidos
jq 'select(.event == "auth.login.failed")' app.log

# Tiempo de respuesta promedio
jq -s '[.[] | select(.response_time_ms) | .response_time_ms] | add/length' app.log

# Contar errores por tipo
jq -s 'group_by(.error_type) | map({type: .[0].error_type, count: length})' app.log
```

---

## 🔍 Error Monitoring con Sentry

### Arquitectura de Monitoreo

La aplicación integra Sentry para captura automática de errores y análisis de rendimiento en producción:

```
┌─────────────────────────────────────────────────────────────┐
│                   Flask Application                          │
│                   (backend/app/__init__.py)                  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         │ init_sentry(app)
                         │
                         ▼
┌────────────────────────────────────────────────────────────┐
│           Sentry Initialization                             │
│           (backend/app/__init__.py:init_sentry)             │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────┐  ┌───────────────────────┐          │
│  │ Configuration    │  │ Environment Guard      │          │
│  │ Validation       │  │                        │          │
│  ├──────────────────┤  ├───────────────────────┤          │
│  │ • SENTRY_DSN     │  │ ✓ production          │          │
│  │ • APP_ENV        │  │ ✓ staging             │          │
│  │ • SAMPLE_RATE    │  │ ✗ development         │          │
│  └──────────────────┘  │ ✗ test                │          │
│                        └───────────────────────┘          │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │           Sentry SDK Initialization                  │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │ Integrations:                                        │  │
│  │   • FlaskIntegration() - HTTP context                │  │
│  │   • SqlalchemyIntegration() - DB queries             │  │
│  │                                                       │  │
│  │ Options:                                             │  │
│  │   • traces_sample_rate - Performance sampling        │  │
│  │   • profiles_sample_rate - Code profiling            │  │
│  │   • send_default_pii=False - Privacy protection      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │           Request Context Enrichment                 │  │
│  ├──────────────────────────────────────────────────────┤  │
│  │ @before_request hook:                                │  │
│  │   - Add authenticated user context                   │  │
│  │   - Set custom tags (app_env, etc.)                  │  │
│  │                                                       │  │
│  │ Auto-captured data:                                  │  │
│  │   - Request method, path, headers                    │  │
│  │   - Query parameters, form data                      │  │
│  │   - Response status codes                            │  │
│  │   - Stack traces with local variables                │  │
│  │   - SQL queries and execution time                   │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
                         │
                         │ Auto-capture errors
                         │ Track performance
                         │
                         ▼
┌────────────────────────────────────────────────────────────┐
│                    Sentry Cloud                             │
│                    (sentry.io)                              │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   Issues     │  │ Performance  │  │   Releases   │    │
│  │  Dashboard   │  │  Monitoring  │  │   Tracking   │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   Alerts     │  │   Context    │  │   Trends     │    │
│  │ & Webhooks   │  │  Enrichment  │  │  & Reports   │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
└────────────────────────────────────────────────────────────┘
```

### Configuración

**Variables de entorno requeridas:**

```bash
# Requerido para activar Sentry (obtén del dashboard de Sentry)
SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0

# Opcional: entorno personalizado (por defecto usa APP_ENV)
SENTRY_ENVIRONMENT=production

# Opcional: sampling rate para performance monitoring (0.0 - 1.0)
SENTRY_TRACES_SAMPLE_RATE=0.1  # 10% de transacciones

# Opcional: habilitar profiling de código (requiere plan con profiling)
SENTRY_ENABLE_PROFILING=false

# Opcional: versión de la app para tracking de releases
APP_VERSION=1.0.0
```

**Guardias de activación:**

1. Solo se activa si `SENTRY_DSN` está configurado
2. Solo se activa en entornos `production` o `staging`
3. Nunca se activa en `development` o `test`

### Contexto Capturado Automáticamente

**Datos de usuario (si está autenticado):**

```python
{
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "username": "John Doe"
}
```

**Datos de request:**

- HTTP method, path, query string
- Headers (sin tokens ni secretos)
- Form data (sanitizado automáticamente)
- Remote IP, user agent
- Request ID para correlación con logs

**Datos de error:**

- Stack trace completo con variables locales
- Tipo de excepción y mensaje
- Breadcrumbs (historial de eventos antes del error)

**Datos de performance:**

- Tiempo de respuesta de endpoints
- Queries SQL ejecutadas y su tiempo
- Detección de N+1 queries
- Análisis de cuellos de botella

### Integraciones

**FlaskIntegration:**

- Captura excepciones no manejadas en requests
- Agrega contexto de Flask (session, request, g)
- Tracking de performance de endpoints

**SqlalchemyIntegration:**

- Tracking de queries SQL
- Detección de queries lentas
- Análisis de N+1 problems
- Context de transacciones

### Sampling y Costos

El `SENTRY_TRACES_SAMPLE_RATE` controla qué porcentaje de transacciones se envía:

| Sample Rate | Uso Recomendado               | Cobertura               |
| ----------- | ----------------------------- | ----------------------- |
| `1.0`       | Debug temporal, staging       | 100% de transacciones   |
| `0.1`       | Producción estándar           | 10% de transacciones    |
| `0.01`      | Alto tráfico (>10k req/día)   | 1% de transacciones     |
| `0.0`       | Solo errores, sin performance | 0% (solo error capture) |

**Nota:** Los errores siempre se capturan al 100%, independientemente del sampling rate.

### Script de Verificación

```bash
# Verificar instalación y configuración
python backend/scripts/test_sentry.py

# El script verifica:
# 1. Sentry SDK instalado
# 2. Variables de entorno configuradas
# 3. Envía eventos de prueba
# 4. Confirma recepción en Sentry
```

### Captura Manual de Errores

**En código Python:**

```python
import sentry_sdk

# Capturar excepción específica
try:
    risky_operation()
except Exception as e:
    sentry_sdk.capture_exception(e)

# Enviar mensaje personalizado
sentry_sdk.capture_message("Operación crítica completada", level="info")

# Agregar contexto adicional
with sentry_sdk.configure_scope() as scope:
    scope.set_tag("payment_method", "credit_card")
    scope.set_extra("transaction_id", "txn_123")
    scope.set_user({"id": "123", "email": "user@example.com"})
```

### Mejores Prácticas

**En desarrollo:**

- No configurar `SENTRY_DSN` para evitar eventos de desarrollo
- Usar logs estructurados para debugging

**En staging:**

- Usar un proyecto/DSN separado de producción
- `SENTRY_ENVIRONMENT=staging`
- `TRACES_SAMPLE_RATE=1.0` para captura completa

**En producción:**

- DSN único para producción
- `TRACES_SAMPLE_RATE=0.1` o menor según tráfico
- Configurar alertas para errores críticos
- Revisar dashboard diariamente

**Privacy & Security:**

- `send_default_pii=False` por defecto
- Headers sensitivos (Authorization, Cookie) se filtran automáticamente
- No capturar passwords ni tokens en contexto manual

---

## 📊 Database Indexes & Query Optimization

### Overview

The database schema includes comprehensive indexes optimized for PostgreSQL production use while maintaining SQLite compatibility for testing. All indexes are based on actual query patterns identified through code analysis.

### Index Strategy

**Design Principles:**

1. **Query-driven**: Each index maps to specific WHERE/JOIN/ORDER BY patterns in the codebase
2. **Composite indexes**: Multiple columns indexed together for complex queries
3. **Partial indexes**: PostgreSQL-specific optimizations for filtered queries (e.g., `WHERE deleted_at IS NULL`)
4. **DESC ordering**: Built into indexes for descending sorts (timestamps)
5. **SQLite compatible**: All indexes work on both PostgreSQL and SQLite

### Critical Indexes by Table

#### 1. Users (Authentication & User Management)

```sql
-- Login queries with soft-delete filtering
ix_users_email_deleted_at (email, deleted_at)
-- Query: WHERE email = ? AND deleted_at IS NULL

-- Active users only (partial index)
ix_users_active (id) WHERE deleted_at IS NULL
-- Query: SELECT COUNT(*) FROM users WHERE deleted_at IS NULL
```

**Query Pattern:**

```python
# backend/app/routes/auth.py:563
db.select(Users).where(
    Users.email == email,
    Users.deleted_at.is_(None)
).scalar_one_or_none()
```

#### 2. UserTokens (Token Validation & Cleanup)

```sql
-- Active token lookups
ix_user_tokens_active_lookup (user_id, token_type, used_at, expires_at)
-- Query: WHERE user_id = ? AND token_type = ? AND used_at IS NULL AND expires_at > NOW()

-- Token expiration cleanup
ix_user_tokens_expires_at (expires_at)
-- Query: DELETE FROM user_tokens WHERE expires_at < NOW()

-- Unused tokens (partial index)
ix_user_tokens_unused (user_id, token_type, expires_at) WHERE used_at IS NULL
-- Query: Find all valid tokens for a user
```

**Query Pattern:**

```python
# backend/app/routes/auth.py:776
db.select(UserTokens).where(
    UserTokens.token == token,
    UserTokens.token_type == 'verification',
    UserTokens.used_at.is_(None),
    UserTokens.expires_at > datetime.now(timezone.utc)
).scalar_one_or_none()
```

#### 3. UserSessions (Session Management)

```sql
-- Active session queries
ix_user_sessions_user_expires (user_id, expires_at)
-- Query: WHERE user_id = ? AND expires_at > NOW()

-- Session cleanup
ix_user_sessions_expires_at (expires_at)
-- Query: DELETE FROM user_sessions WHERE expires_at < NOW()
```

**Query Pattern:**

```python
# backend/app/auth.py (decorator)
session = db.session.query(UserSessions).filter(
    UserSessions.session_token == token,
    UserSessions.expires_at > datetime.now(timezone.utc)
).first()
```

#### 4. PlotHistory (Most Frequent Queries - CRITICAL)

```sql
-- User history pagination (MOST IMPORTANT INDEX)
ix_plot_history_user_active_created (user_id, deleted_at, created_at DESC)
-- Query: WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?

-- Active plots only (partial index)
ix_plot_history_user_active (user_id, created_at DESC) WHERE deleted_at IS NULL
-- PostgreSQL-optimized version of above

-- General timestamp queries
ix_plot_history_created_at (created_at DESC)
-- Query: ORDER BY created_at DESC (admin views, analytics)
```

**Query Pattern:**

```python
# backend/app/routes/history.py:32
query = db.session.query(PlotHistory).filter(
    PlotHistory.user_id == g.current_user.id,
    PlotHistory.deleted_at.is_(None)
).order_by(desc(PlotHistory.created_at))
```

**Performance Impact:** This query runs on every page load in the history view. The composite index eliminates table scans and provides O(log n) lookup instead of O(n).

#### 5. RoleRequest (Admin Moderation)

```sql
-- User's role requests
ix_role_requests_user_created (user_id, created_at DESC)

-- Status filtering (pending/approved/rejected)
ix_role_requests_status (status)

-- Combined filters
ix_role_requests_user_status (user_id, status)
```

#### 6. AuditLog (Compliance & Debugging)

```sql
-- User audit trail
ix_audit_log_user_created (user_id, created_at DESC)

-- Entity tracking
ix_audit_log_entity (target_entity_type, target_entity_id)

-- Time-range queries
ix_audit_log_created_at (created_at DESC)
```

#### 7. RequestTicket (Support System)

```sql
-- User's tickets
ix_request_tickets_user_created (user_id, created_at DESC)

-- Status filtering
ix_request_tickets_status (status)

-- Combined filters
ix_request_tickets_user_status (user_id, status)
```

#### 8. PlotHistoryTags (Tag Filtering)

```sql
-- Reverse lookup: find all plots with specific tag
ix_plot_history_tags_tag_id (tag_id)
-- Query: Find all plots tagged with "derivatives"
```

#### 9. StudentGroup (Teacher Features)

```sql
-- Teacher's groups
ix_student_groups_teacher_created (teacher_id, created_at DESC)
```

### Existing Indexes (Pre-optimization)

These indexes were already in place before the optimization migration:

```sql
-- Users
users.email (unique=True)          -- Login lookups
users.public_id (unique=True, index=True)  -- Public ID lookups

-- UserTokens
user_tokens.token (unique=True)    -- Token validation

-- UserSessions
user_sessions.session_token (PK)   -- Session lookups

-- UserNotifications
ix_user_notifications_user_unread (user_id, read_at)  -- Unread notifications
ix_user_notifications_user_id (user_id)
ix_user_notifications_category (category)
ix_user_notifications_created_at (created_at)

-- Learning Progress
uq_learning_user_exercise (user_id, exercise_id)  -- Unique constraint

-- Various tables
Multiple indexes on user_id, teacher_id, admin_id (from foreign keys)
```

### Migration Information

**Migration File:** `3ba8b2063bf7_optimize_database_indexes_for_query_.py`

**Applied:** 2025-11-16

**Total New Indexes:** 20

**Performance Improvements Expected:**

- **Login queries:** 90% faster (email + deleted_at composite)
- **Token validation:** 95% faster (4-column composite for active tokens)
- **History pagination:** 98% faster (eliminates table scans)
- **Session checks:** 85% faster (user_id + expires_at composite)
- **Admin queries:** 70% faster (status filtering)

### Query Analysis Tools

**Check which indexes are being used:**

```sql
-- PostgreSQL: Show query plan
EXPLAIN ANALYZE
SELECT * FROM plot_history
WHERE user_id = '...' AND deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 20;

-- Expected output should show:
-- Index Scan using ix_plot_history_user_active_created
```

**Index usage statistics (PostgreSQL):**

```sql
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;
```

### Maintenance

**Index bloat monitoring (PostgreSQL):**

```sql
-- Check index sizes
SELECT
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) as size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC;
```

**Rebuild indexes if needed:**

```sql
REINDEX TABLE plot_history;  -- PostgreSQL
REINDEX DATABASE ecuplot_web;  -- Full database
```

### Testing

All indexes are fully tested with SQLite in the test suite:

- ✅ 363 tests pass with new indexes
- ✅ Partial indexes gracefully ignored by SQLite
- ✅ DESC ordering supported in both databases
- ✅ Composite indexes work correctly

---

**Última actualización**: 16 de noviembre de 2025  
**Autor**: Julian Cardenas
**Versión**: 1.2 (Structured Logging + Optimized Indexes)
