# ECU Plot Web

Nueva iteración del proyecto ECU Plot orientada a una aplicación web con backend en Flask y frontend estático (HTML, CSS y JavaScript). Incluye una base de datos MySQL gestionada con SQLAlchemy.

## Estructura

```
webapp/
├── backend/
│   ├── app/
│   │   ├── config.py
│   │   ├── __init__.py
│   │   ├── database/
│   │   │   ├── __init__.py
│   │   │   └── models.py
│   │   ├── routes/
│   │   │   ├── __init__.py
│   │   │   └── charts.py
│   │   └── services/
│   │       ├── __init__.py
│   │       └── chart_service.py
│   ├── requirements.txt
│   └── wsgi.py
├── frontend/
│   └── public/
│       ├── app.js
│       ├── index.html
│       └── styles.css
└── .env.example
```

## Primeros pasos

1. Copia `.env.example` como `.env` y ajusta las variables de entorno.
2. Crea un entorno virtual y instala dependencias del backend:

   ```bash
   cd webapp/backend
   python -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

3. Inicializa la base de datos MySQL y aplica las migraciones que definas.
4. Ejecuta el backend en modo desarrollo:

   ```bash
   flask --app wsgi run --debug
   ```

5. Abre `webapp/frontend/public/index.html` en tu navegador o sirve el directorio con tu herramienta favorita.

## Próximos pasos sugeridos

- Añadir autenticación y control de acceso a la API.
- Implementar migraciones con Flask-Migrate.
- Integrar frameworks de frontend o un bundler según necesidades del proyecto.
# webapp
