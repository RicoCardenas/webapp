"""Sistema de ejercicios interactivos con seguimiento."""

from flask import jsonify, g, request

from datetime import datetime, timezone

from flask import current_app, jsonify, g
from sqlalchemy.exc import IntegrityError

from . import api
from ..extensions import db
from ..models import LearningProgress
from ..auth import require_session
from ..event_stream import events as event_bus

# Catálogo de ejercicios disponibles
LEARNING_EXERCISES = [
    {
        "id": "sine-wave",
        "title": "Onda seno",
        "expression": "y = sin(x)",
        "description": "Explora la oscilación de la función seno entre -1 y 1.",
    },
    {
        "id": "parabola-basic",
        "title": "Parábola desplazada",
        "expression": "y = (x - 1)^2 - 3",
        "description": "Analiza cómo se traslada una parábola respecto al origen.",
    },
    {
        "id": "exponential-growth",
        "title": "Crecimiento exponencial",
        "expression": "y = e^(0.3 * x)",
        "description": "Visualiza una función exponencial de crecimiento suave.",
    },
]


@api.get("/learning/exercises")
@require_session
def learning_exercise_catalog():
    """Catálogo de ejercicios con progreso del usuario actual."""
    progress_rows = db.session.execute(
        db.select(
            LearningProgress.exercise_id,
            LearningProgress.completed_at,
        ).where(LearningProgress.user_id == g.current_user.id)
    ).all()
    progress_map = {
        row.exercise_id: row.completed_at for row in progress_rows
    }
    payload = []
    for exercise in LEARNING_EXERCISES:
        item = dict(exercise)
        completed_at = progress_map.get(exercise["id"])
        item["completed"] = completed_at is not None
        item["completed_at"] = (
            completed_at.isoformat() if completed_at else None
        )
        payload.append(item)
    return jsonify(exercises=payload)


@api.post("/learning/exercises/<exercise_id>/complete")
@require_session
def learning_exercise_complete(exercise_id):
    """Marca un ejercicio como completado para el usuario actual."""
    exercise = next((item for item in LEARNING_EXERCISES if item["id"] == exercise_id), None)
    if not exercise:
        return jsonify(error="Ejercicio no encontrado."), 404

    existing = db.session.execute(
        db.select(LearningProgress).where(
            LearningProgress.user_id == g.current_user.id,
            LearningProgress.exercise_id == exercise_id,
        )
    ).scalar_one_or_none()

    if existing:
        return jsonify(
            message="Ejercicio ya registrado.",
            completed=True,
            completed_at=existing.completed_at.isoformat() if existing.completed_at else None,
        ), 200

    entry = LearningProgress(user_id=g.current_user.id, exercise_id=exercise_id)
    db.session.add(entry)

    try:
        db.session.flush()
    except IntegrityError:
        db.session.rollback()
        existing = db.session.execute(
            db.select(LearningProgress).where(
                LearningProgress.user_id == g.current_user.id,
                LearningProgress.exercise_id == exercise_id,
            )
        ).scalar_one_or_none()
        if existing:
            return jsonify(
                message="Ejercicio ya registrado.",
                completed=True,
                completed_at=existing.completed_at.isoformat() if existing.completed_at else None,
            ), 200
        current_app.logger.error("Conflicto al registrar ejercicio (duplicado no encontrado): %s", exercise_id)
        return jsonify(error="No se pudo registrar el progreso."), 500

    completed_at = entry.completed_at or datetime.now(timezone.utc)
    completed_iso = completed_at.isoformat()

    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        current_app.logger.error("No se pudo registrar ejercicio (%s): %s", exercise_id, exc)
        return jsonify(error="No se pudo registrar el progreso."), 500

    event_bus.publish(
        g.current_user.id,
        channel="learning",
        event_type="learning:completed",
        data={
            "exercise_id": exercise_id,
            "completed": True,
            "completed_at": completed_iso,
        },
    )

    return jsonify(
        message="Ejercicio completado.",
        completed=True,
        completed_at=completed_iso,
    ), 201
