# ECU Plot reiniciado

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

| Entorno (`APP_ENV`) | Comportamiento                                                                              |
|---------------------|---------------------------------------------------------------------------------------------|
| `production`        | Requiere `DATABASE_URL` válido. Si falta, la app aborta con un mensaje explícito.           |
| `development`       | Sin `DATABASE_URL`, se crea/usa automáticamente `instance/dev.db` (SQLite).                 |
| `test`              | Sin `DATABASE_URL`, se emplea `sqlite:///:memory:` para aislar la suite de pruebas.         |

La carpeta `instance/` se crea automáticamente (y ya está listada en `.gitignore`) para alojar la base SQLite de desarrollo.
