"""Application configuration values."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
INSTANCE_PATH = BASE_DIR / "instance"


class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key")
    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL",
        f"sqlite:///{INSTANCE_PATH / 'app.db'}",
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
