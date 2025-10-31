"""Helpers to run database backup and restore operations."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from flask import current_app
from sqlalchemy.engine import make_url


class BackupError(RuntimeError):
    """Raised when a backup operation cannot be completed."""


class RestoreError(RuntimeError):
    """Raised when a restore operation cannot be completed."""


@dataclass
class BackupMetadata:
    name: str
    filename: str
    path: str
    created_at: str
    engine: str


def _get_backup_dir() -> Path:
    base = current_app.config.get("BACKUP_DIR")
    if not base:
        fallback = Path(current_app.instance_path).parent / "BackupsDB"
        base = str(fallback)
        current_app.logger.warning(
            "BACKUP_DIR no está configurado; se usará el directorio por defecto %s.", base
        )

    path = Path(base).expanduser()
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise BackupError(f"No se pudo preparar el directorio de backups: {exc}.") from exc
    return path.resolve()


def _sanitize_name(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    sanitized = re.sub(r"[^A-Za-z0-9_-]+", "_", value.strip())
    return sanitized or None


def _unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    base = path.stem
    suffix = path.suffix
    counter = 1
    while True:
        candidate = path.with_name(f"{base}-{counter}{suffix}")
        if not candidate.exists():
            return candidate
        counter += 1


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _sqlite_backup(parsed_url, destination: Path) -> BackupMetadata:
    database_path = parsed_url.database
    if not database_path or database_path == ":memory":
        raise BackupError("No se puede respaldar una base SQLite en memoria.")

    src = Path(database_path).expanduser().resolve()
    if not src.exists():
        raise BackupError("El archivo de la base SQLite no existe.")

    destination = _unique_path(destination)
    try:
        shutil.copy2(src, destination)
    except OSError as exc:
        raise BackupError(f"No se pudo copiar la base SQLite: {exc}.") from exc

    return BackupMetadata(
        name=destination.stem,
        filename=destination.name,
        path=str(destination),
        created_at=_timestamp(),
        engine="sqlite",
    )


def _postgres_backup(parsed_url, destination: Path) -> BackupMetadata:
    destination = _unique_path(destination)
    pg_dump_bin = current_app.config.get("PG_DUMP_BIN", "pg_dump")

    env = os.environ.copy()
    if parsed_url.password:
        env.setdefault("PGPASSWORD", parsed_url.password)

    # Build a DSN without password so we do not leak it via argv.
    dsn_url = parsed_url.set(drivername="postgresql", password=None)
    dsn = dsn_url.render_as_string(hide_password=False)

    cmd = [
        pg_dump_bin,
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--file",
        str(destination),
        "--dbname",
        dsn,
    ]

    try:
        subprocess.run(cmd, check=True, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except FileNotFoundError as exc:
        raise BackupError("No se encontró el comando 'pg_dump'.") from exc
    except subprocess.CalledProcessError as exc:
        raise BackupError("pg_dump devolvió un error al generar el backup.") from exc

    return BackupMetadata(
        name=destination.stem,
        filename=destination.name,
        path=str(destination),
        created_at=_timestamp(),
        engine="postgresql",
    )


def run_backup(backup_name: Optional[str] = None) -> BackupMetadata:
    """Run a backup for the configured SQLAlchemy database."""
    backup_dir = _get_backup_dir()
    parsed_url = make_url(current_app.config["SQLALCHEMY_DATABASE_URI"])

    sanitized = _sanitize_name(backup_name)
    if parsed_url.get_backend_name().startswith("postgresql"):
        suffix = ".dump"
        filename = sanitized or f"backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
        destination = backup_dir / f"{filename}{suffix}"
        return _postgres_backup(parsed_url, destination)

    if parsed_url.get_backend_name().startswith("sqlite"):
        suffix = ".sqlite"
        filename = sanitized or f"backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
        destination = backup_dir / f"{filename}{suffix}"
        return _sqlite_backup(parsed_url, destination)

    raise BackupError("El motor de base de datos configurado no admite backups automáticos.")


def _resolve_backup_file(backup_dir: Path, backup_name: str) -> Path:
    candidate = Path(backup_name)
    if candidate.is_absolute() and candidate.exists():
        return candidate

    target = backup_dir / candidate.name
    if target.exists():
        return target

    # Try common suffixes if the caller omitted the extension.
    for suffix in (".dump", ".sql", ".sqlite", ".bak"):
        alt = target.with_suffix(suffix)
        if alt.exists():
            return alt

    raise FileNotFoundError(f"No se encontró el backup '{backup_name}'.")


def _sqlite_restore(parsed_url, backup_file: Path) -> BackupMetadata:
    database_path = parsed_url.database
    if not database_path or database_path == ":memory":
        raise RestoreError("No se puede restaurar una base SQLite en memoria.")

    destination = Path(database_path).expanduser().resolve()
    if destination.exists():
        previous = destination.with_suffix(destination.suffix + ".prev")
        try:
            shutil.copy2(destination, previous)
        except OSError as exc:
            raise RestoreError(f"No se pudo crear la copia previa de seguridad: {exc}.") from exc

    try:
        shutil.copy2(backup_file, destination)
    except OSError as exc:
        raise RestoreError(f"No se pudo restaurar el archivo SQLite: {exc}.") from exc

    return BackupMetadata(
        name=backup_file.stem,
        filename=backup_file.name,
        path=str(backup_file.resolve()),
        created_at=_timestamp(),
        engine="sqlite",
    )


def _postgres_restore(parsed_url, backup_file: Path) -> BackupMetadata:
    pg_restore_bin = current_app.config.get("PG_RESTORE_BIN", "pg_restore")

    env = os.environ.copy()
    if parsed_url.password:
        env.setdefault("PGPASSWORD", parsed_url.password)

    dsn_url = parsed_url.set(drivername="postgresql", password=None)
    dsn = dsn_url.render_as_string(hide_password=False)

    cmd = [
        pg_restore_bin,
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        "--dbname",
        dsn,
        str(backup_file),
    ]

    try:
        subprocess.run(cmd, check=True, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except FileNotFoundError as exc:
        raise RestoreError("No se encontró el comando 'pg_restore'.") from exc
    except subprocess.CalledProcessError as exc:
        raise RestoreError("pg_restore devolvió un error al restaurar el backup.") from exc

    return BackupMetadata(
        name=backup_file.stem,
        filename=backup_file.name,
        path=str(backup_file.resolve()),
        created_at=_timestamp(),
        engine="postgresql",
    )


def restore_backup(backup_name: str) -> BackupMetadata:
    if not backup_name:
        raise RestoreError("Debes indicar el nombre del backup a restaurar.")

    backup_dir = _get_backup_dir()
    backup_file = _resolve_backup_file(backup_dir, backup_name)
    parsed_url = make_url(current_app.config["SQLALCHEMY_DATABASE_URI"])

    if parsed_url.get_backend_name().startswith("postgresql"):
        return _postgres_restore(parsed_url, backup_file)

    if parsed_url.get_backend_name().startswith("sqlite"):
        return _sqlite_restore(parsed_url, backup_file)

    raise RestoreError("El motor de base de datos configurado no admite restauraciones automáticas.")

