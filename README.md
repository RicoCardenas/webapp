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
