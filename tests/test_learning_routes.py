"""
Tests para backend/app/routes/learning.py
Ejercicios de aprendizaje.
"""
import pytest
from backend.app.models import LearningProgress
from backend.app.extensions import db


class TestLearningExercises:
    """Tests para rutas de ejercicios de aprendizaje."""
    
    def test_list_exercises_empty_progress(self, app, client, session_token_factory):
        """Debe listar ejercicios sin progreso."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            response = client.get('/api/learning/exercises', headers=headers)
            
            assert response.status_code == 200
            data = response.json
            assert 'exercises' in data
            assert isinstance(data['exercises'], list)
            # Todos deben estar incompletos
            for exercise in data['exercises']:
                assert exercise['completed'] is False
                assert exercise['completed_at'] is None
    
    def test_list_exercises_with_progress(self, app, client, session_token_factory):
        """Debe mostrar ejercicios completados."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            # Marcar un ejercicio como completado
            from backend.app.routes.learning import LEARNING_EXERCISES
            first_exercise_id = LEARNING_EXERCISES[0]['id']
            
            progress = LearningProgress(
                user_id=user.id,
                exercise_id=first_exercise_id
            )
            db.session.add(progress)
            db.session.commit()
            
            response = client.get('/api/learning/exercises', headers=headers)
            
            assert response.status_code == 200
            data = response.json
            # El primer ejercicio debe aparecer como completado
            completed = [ex for ex in data['exercises'] if ex['completed']]
            assert len(completed) >= 1
            assert completed[0]['id'] == first_exercise_id
            assert completed[0]['completed_at'] is not None
    
    def test_complete_exercise(self, app, client, session_token_factory):
        """Debe marcar un ejercicio como completado."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            from backend.app.routes.learning import LEARNING_EXERCISES
            exercise_id = LEARNING_EXERCISES[0]['id']
            
            response = client.post(
                f'/api/learning/exercises/{exercise_id}/complete',
                headers=headers
            )
            
            assert response.status_code in [200, 201]
            data = response.json
            assert 'message' in data or 'exercise' in data
    
    def test_complete_nonexistent_exercise(self, app, client, session_token_factory):
        """Debe retornar 404 con ejercicio inexistente."""
        with app.app_context():
            token, user = session_token_factory()
            headers = {"Authorization": f"Bearer {token}"}
            
            response = client.post(
                '/api/learning/exercises/nonexistent_id/complete',
                headers=headers
            )
            
            assert response.status_code == 404
            data = response.json
            assert 'error' in data
    
    def test_exercises_requires_auth(self, client):
        """Debe requerir autenticación."""
        response = client.get('/api/learning/exercises')
        assert response.status_code == 401
