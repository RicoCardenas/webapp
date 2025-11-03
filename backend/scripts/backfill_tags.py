#!/usr/bin/env python
"""
Herramienta de consola para recalcular etiquetas de historial.

Uso:
    python backend/scripts/backfill_tags.py [--dry-run] [--force]
"""
from __future__ import annotations

import argparse

from backend.app import create_app
from backend.app.extensions import db
from backend.app.models import PlotHistory, PlotHistoryTags
from backend.app.plot_tags import auto_tag_history
from sqlalchemy.orm import selectinload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Auto-etiqueta entradas de historial.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Procesa sin guardar cambios.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Recalcula incluso si la entrada ya tiene tags.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    app = create_app()
    with app.app_context():
        query = db.session.scalars(
            db.select(PlotHistory).options(
                selectinload(PlotHistory.tags_association).selectinload(PlotHistoryTags.tag)
            )
        )
        updated = 0
        processed = 0
        for history in query:
            processed += 1
            if history.tags_association and not args.force:
                continue
            applied = auto_tag_history(history, session=db.session, replace=True)
            if applied:
                updated += 1

        if args.dry_run:
            db.session.rollback()
        else:
            db.session.commit()

        suffix = " (dry-run)" if args.dry_run else ""
        print(f"Procesadas {processed} entradas. {updated} actualizadas{suffix}.")


if __name__ == "__main__":
    main()
