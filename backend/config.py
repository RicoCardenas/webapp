"""Application configuration values."""
import os
import json
from typing import List
from pathlib import Path
from dotenv import load_dotenv


# --- Cargar variables de entorno ---
load_dotenv()

BASE_DIR = Path(__file__).resolve().parent

def parse_list_env(name: str) -> List[str]:

    raw = os.getenv(name, "").strip()
    if not raw:
        return []
    if raw.startswith("["):
        try:
            return [str(s) for s in json.loads(raw)]
        except Exception:
            return []
    return [item.strip() for item in raw.split(",") if item.strip()]

class Config:
    # clave secreta de flask
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key")
    
    # --- configuracion de base de datos ---
    db_url = os.getenv("DATABASE_URL")
    
    if not db_url:
        raise RuntimeError(
            "FATAL: DATABASE_URL no está configurada. "
            "Asegúrate de que exista un archivo .env con la URL de PostgreSQL."
        )
        
    SQLALCHEMY_DATABASE_URI = db_url
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # configuracion para correo ---
    MAIL_SERVER = os.getenv('MAIL_SERVER')
    MAIL_PORT = int(os.getenv('MAIL_PORT', 587))
    MAIL_USE_TLS = os.getenv('MAIL_USE_TLS', 'true').lower() == 'true'
    MAIL_USE_SSL = os.getenv('MAIL_USE_SSL', 'false').lower() == 'true'
    MAIL_USERNAME = os.getenv('MAIL_USERNAME')
    MAIL_PASSWORD = os.getenv('MAIL_PASSWORD')
    
    MAIL_DEFAULT_SENDER = os.getenv('MAIL_DEFAULT_SENDER', os.getenv('MAIL_USERNAME'))

    # CORS & contacto
    CORS_ORIGINS = parse_list_env('CORS_ORIGINS')
    CONTACT_RECIPIENTS = parse_list_env('CONTACT_RECIPIENTS')
    CONTACT_RECIPIENT = CONTACT_RECIPIENTS[0]
    
