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

**Última actualización**: 10 de noviembre de 2024  
**Autor**: GitHub Copilot  
**Versión**: 1.0 (Consolidación completa)
