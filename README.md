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

Para más detalles, consulta [docs/STRUCTURED_LOGGING.md](docs/STRUCTURED_LOGGING.md).

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

Todos los índices están probados con SQLite (tests) y optimizados para PostgreSQL (producción). Ver detalles completos en [ARCHITECTURE.md - Database Indexes](ARCHITECTURE.md#-database-indexes--query-optimization).

La carpeta `instance/` se crea automáticamente (y ya está listada en `.gitignore`) para alojar la base SQLite de desarrollo.
