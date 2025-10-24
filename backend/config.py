"""Application configuration values."""
import os
from pathlib import Path
from dotenv import load_dotenv

# --- Cargar variables de entorno ---
load_dotenv()

BASE_DIR = Path(__file__).resolve().parent

class Config:
    # clave secreta de flask
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key")
    
    # --- configuracion de base de datos (Estricta) ---
    db_url = os.getenv("DATABASE_URL")
    
    if not db_url:
        raise RuntimeError(
            "FATAL: DATABASE_URL no está configurada. "
            "Asegúrate de que exista un archivo .env con la URL de PostgreSQL."
        )
        
    SQLALCHEMY_DATABASE_URI = db_url
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # configuracion para correo (esto para la verificacion) ---
    MAIL_SERVER = os.getenv('MAIL_SERVER')
    MAIL_PORT = int(os.getenv('MAIL_PORT', 587))
    MAIL_USE_TLS = os.getenv('MAIL_USE_TLS', 'true').lower() == 'true'
    MAIL_USE_SSL = os.getenv('MAIL_USE_SSL', 'false').lower() == 'true'
    MAIL_USERNAME = os.getenv('MAIL_USERNAME')
    MAIL_PASSWORD = os.getenv('MAIL_PASSWORD')
    
    # ¡Kira 2.0: Cambio! 
    # Hacemos que MAIL_DEFAULT_SENDER sea solo el email.
    # Si no está en el .env, usa MAIL_USERNAME como fallback.
    MAIL_DEFAULT_SENDER = os.getenv('MAIL_DEFAULT_SENDER', os.getenv('MAIL_USERNAME'))

