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

## Configuración de base de datos

El backend espera la variable `DATABASE_URL` apuntando a tu base de datos de producción (por ejemplo, PostgreSQL). Usa el archivo `.env.example` como guía:

```bash
cp .env.example .env
```

| Entorno          | Comportamiento                                                            |
|------------------|---------------------------------------------------------------------------|
| Producción       | Requiere `DATABASE_URL` válido. Si falta, la app aborta el arranque.      |
| Desarrollo local | Si `DATABASE_URL` no está definido, se usa automáticamente `instance/dev.db` (SQLite). |
| Pruebas (`pytest`)| Se utiliza una base SQLite en memoria para aislar los tests.             |

La carpeta `instance/` se crea automáticamente (y ya está listada en `.gitignore`) para alojar la base SQLite de desarrollo.
