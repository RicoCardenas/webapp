import pytest


@pytest.mark.usefixtures("client")
class TestLearningProgress:
    def test_learning_endpoints_require_auth(self, client):
        res_get = client.get('/api/learning/exercises')
        assert res_get.status_code == 401

        res_post = client.post('/api/learning/exercises/sine-wave/complete')
        assert res_post.status_code == 401

    def test_learning_completion_flow(self, client, auth_headers):
        # Initial catalog request returns defaults with pending status
        catalog = client.get('/api/learning/exercises', headers=auth_headers)
        assert catalog.status_code == 200
        payload = catalog.get_json() or {}
        exercises = payload.get('exercises') or []
        assert isinstance(exercises, list)
        assert any(item.get('id') == 'sine-wave' for item in exercises)

        # First completion creates a new progress record
        first = client.post('/api/learning/exercises/sine-wave/complete', headers=auth_headers)
        assert first.status_code == 201
        first_payload = first.get_json() or {}
        assert first_payload.get('completed') is True
        completed_at = first_payload.get('completed_at')
        assert isinstance(completed_at, str) and completed_at

        # Duplicate completion is idempotent and reuses the same timestamp
        duplicate = client.post('/api/learning/exercises/sine-wave/complete', headers=auth_headers)
        assert duplicate.status_code == 200
        duplicate_payload = duplicate.get_json() or {}
        assert duplicate_payload.get('completed') is True
        assert duplicate_payload.get('completed_at') == completed_at

        # Catalog reflects completion state
        refreshed = client.get('/api/learning/exercises', headers=auth_headers)
        assert refreshed.status_code == 200
        refreshed_payload = refreshed.get_json() or {}
        refreshed_list = refreshed_payload.get('exercises') or []
        sine_wave = next((item for item in refreshed_list if item.get('id') == 'sine-wave'), None)
        assert sine_wave is not None
        assert sine_wave.get('completed') is True
        assert sine_wave.get('completed_at') == completed_at
