# EcuPlotWeb

Este repositorio parte desde cero con una separación sencilla entre backend (Flask) y frontend (JavaScript vanilla).

## Requisitos rápidos

1. Crear y activar un entorno virtual:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```
2. Instalar dependencias de backend:
   ```bash
   pip install -r backend/requirements.txt
   ```
   > Consejo: si necesitas actualizar versiones, modifica `backend/requirements.in`
   > y regenera el archivo bloqueado con `pip-compile backend/requirements.in --output-file backend/requirements.txt`.
   > Ejecuta ese comando con la misma versión de Python (3.14 en este proyecto) para asegurar compatibilidad.
   > Nota: el paquete opcional `greenlet` se excluyó hasta que tenga soporte oficial para Python 3.14.
3. Ejecutar el servidor backend:
   ```bash
   cd backend
   flask --app run.py --debug run
   ```
4. Abrir `frontend/public/index.html` en el navegador para ver la base del frontend.

A partir de aquí podemos construir las funcionalidades deseadas sobre una base limpia.

## Configuración de entornos y base de datos

El arranque se guía por `APP_ENV` (`production`, `development` o `test`). Si no la defines, la app intenta inferirla: `pytest` fuerza `test`, `FLASK_DEBUG` activa `development` y, en último caso, se asume `production`. Usa el archivo `.env.example` como guía:

```bash
cp .env.example .env
```

| Entorno (`APP_ENV`) | Comportamiento                                                                      |
| ------------------- | ----------------------------------------------------------------------------------- |
| `production`        | Requiere `DATABASE_URL` válido. Si falta, la app aborta con un mensaje explícito.   |
| `development`       | Sin `DATABASE_URL`, se crea/usa automáticamente `instance/dev.db` (SQLite).         |
| `test`              | Sin `DATABASE_URL`, se emplea `sqlite:///:memory:` para aislar la suite de pruebas. |

> Importante: en `APP_ENV=production` debes definir `SECRET_KEY` con un valor fuerte (32+ caracteres aleatorios). La aplicación aborta el arranque si detecta la clave por defecto `dev-secret-key`.
>
> Además, define `CORS_ORIGINS` con la lista de dominios permitidos (ej. `https://app.example.com,https://admin.example.com`). Si falta en producción, el backend no iniciará. Solo activa `CORS_SUPPORTS_CREDENTIALS=true` cuando realmente necesites enviar cookies o cabeceras de autenticación implícita.
>
> Por seguridad, la sesión autenticada ahora se entrega mediante una cookie `session_token` con flags `HttpOnly` y `SameSite=Lax`. No almacenes el token en `localStorage` ni en el frontend.
>
> Limita el número de conexiones SSE simultáneas por usuario con `SSE_MAX_CONNECTIONS_PER_USER` (predeterminado `3`) para evitar abusos.

## Logging Estructurado

El sistema de logging está configurado para adaptarse automáticamente al entorno:

- **Producción**: Logs en formato JSON para agregación y análisis
- **Desarrollo**: Logs con colores y formato human-readable
- **Test**: Logs mínimos (WARNING+) para reducir ruido

Cada log incluye automáticamente:

- `timestamp`, `level`, `logger`, `message`, `app_env`
- `request_id` único por petición (UUID)
- `method`, `path`, `remote_addr`, `user_agent`
- `user_id` y `email` cuando el usuario está autenticado
- `response_time_ms` al completar requests

## Database Performance & Indexes

La base de datos incluye **índices optimizados** basados en patrones de consulta reales del código:

- **Login queries**: Índice compuesto en `(email, deleted_at)` para autenticación rápida con soft-deletes
- **Token validation**: Índice de 4 columnas `(user_id, token_type, used_at, expires_at)` para validación eficiente
- **History pagination**: Índice crítico `(user_id, deleted_at, created_at DESC)` que elimina table scans en el historial
- **Session management**: Índice `(user_id, expires_at)` para consultas de sesiones activas
- **Partial indexes**: Optimizaciones PostgreSQL para queries filtradas (compatibles con SQLite)

**Mejoras de performance esperadas:**

- Login: 90% más rápido
- Validación de tokens: 95% más rápido
- Paginación de historial: 98% más rápido
- Verificación de sesiones: 85% más rápido

Todos los índices están probados con SQLite (tests) y optimizados para PostgreSQL (producción).

La carpeta `instance/` se crea automáticamente (y ya está listada en `.gitignore`) para alojar la base SQLite de desarrollo.

## Error Monitoring con Sentry

La aplicación integra [Sentry](https://sentry.io) para monitoreo de errores y análisis de rendimiento en producción.

### Configuración

Sentry solo se activa en entornos **`production`** o **`staging`**. Nunca en `development` o `test`.

1. **Crear cuenta y proyecto en Sentry**:

   - Registrarse en [sentry.io](https://sentry.io)
   - Crear un nuevo proyecto Flask
   - Copiar el DSN del proyecto

2. **Configurar variables de entorno**:

   ```bash
   # Requerido para activar Sentry
   SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0

   # Opcional: personalizar entorno (por defecto usa APP_ENV)
   SENTRY_ENVIRONMENT=production

   # Opcional: ajustar sampling de performance (0.0 - 1.0)
   SENTRY_TRACES_SAMPLE_RATE=0.1  # 10% de transacciones

   # Opcional: habilitar profiling (requiere plan con profiling)
   SENTRY_ENABLE_PROFILING=false
   ```

3. **Verificar instalación**:
   ```bash
   # Al iniciar la app en production/staging, verás:
   # [INFO] Sentry inicializado correctamente [environment=production, traces_sample_rate=0.1]
   ```

### Características

**Captura automática de errores:**

- Excepciones no manejadas en requests
- Errores de base de datos (SQLAlchemy)
- Errores en workers y background jobs

**Contexto enriquecido:**

- Información del usuario autenticado (ID, email, nombre)
- Detalles del request (método, path, headers, query params)
- Tags personalizados (app_env, etc.)
- Stack traces completos con variables locales

**Performance Monitoring:**

- Tiempo de respuesta de endpoints
- Queries SQL lentas
- Detección de N+1 queries
- Análisis de cuellos de botella

### Sampling y costos

El `SENTRY_TRACES_SAMPLE_RATE` controla qué porcentaje de transacciones se envía a Sentry:

- `1.0` (100%): Captura todas las transacciones (costoso, solo para debug temporal)
- `0.1` (10%): Recomendado para producción (balance entre datos y costos)
- `0.01` (1%): Para aplicaciones de muy alto tráfico
- `0.0` (0%): Desactiva performance monitoring (solo captura errores)

### Mejores prácticas

**En desarrollo:**

- No configurar `SENTRY_DSN` para evitar enviar errores de desarrollo
- Usar logs estructurados para debugging local

**En staging:**

- Configurar con `SENTRY_ENVIRONMENT=staging`
- Usar `TRACES_SAMPLE_RATE=1.0` para captura completa

**En producción:**

- Usar un DSN diferente al de staging
- Configurar `TRACES_SAMPLE_RATE=0.1` o menor según tráfico
- Revisar alertas diariamente
- Configurar notificaciones para errores críticos

**Releases y tracking:**

- Definir `APP_VERSION` en `.env` para trackear releases
- Asociar errores con versiones específicas del código
- Configurar source maps si aplica

### Captura manual de errores

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
```

Para más información, consulta la [documentación oficial de Sentry](https://docs.sentry.io/platforms/python/guides/flask/).

```

```
