import uuid

import pytest

from backend.app.models import Roles, Users, AuditLog


@pytest.fixture()
def ensure_role(app, _db):
    def _ensure(name: str, description: str | None = None):
        with app.app_context():
            role = Roles.query.filter_by(name=name).first()
            if role:
                return role
            role = Roles(name=name, description=description or name.title())
            _db.session.add(role)
            _db.session.commit()
            return role
    return _ensure


def _reload_user(user_id):
    session = Users.query.session
    return session.get(Users, user_id)


def _apply_role(user, role):
    if role not in user.roles:
        user.roles.append(role)
    user.role_id = role.id


def _remove_role_names(user):
    return {role.name for role in user.roles}


def test_development_admin_list_requires_role(client, auth_headers):
    res = client.get('/api/development/admins', headers=auth_headers)
    assert res.status_code == 403


def test_development_admin_list_success(app, client, user_factory, session_token_factory, ensure_role):
    with app.app_context():
        session = Users.query.session
        Users.query.delete()
        session.commit()
        dev_role = ensure_role('development')
        admin_role = ensure_role('admin')
        ensure_role('user')

        dev_user = user_factory(email='dev@example.com')
        dev_user = _reload_user(dev_user.id)
        _apply_role(dev_user, dev_role)
        session.commit()

        admin_user = user_factory(email='admin@example.com')
        admin_user = _reload_user(admin_user.id)
        _apply_role(admin_user, admin_role)
        session.commit()

        token, _ = session_token_factory(user=dev_user)

    res = client.get('/api/development/admins', headers={'Authorization': f'Bearer {token}'})
    assert res.status_code == 200
    payload = res.get_json()
    assert isinstance(payload, dict)
    admins = payload.get('admins', [])
    assert len(admins) == 1
    admin_entry = admins[0]
    assert admin_entry['email'] == 'admin@example.com'
    assert admin_entry['removable'] is False
    assert payload.get('total') == 1


def test_development_remove_admin_success(app, client, user_factory, session_token_factory, ensure_role):
    with app.app_context():
        session = Users.query.session
        Users.query.delete()
        session.commit()
        dev_role = ensure_role('development')
        admin_role = ensure_role('admin')
        fallback_role = ensure_role('user')

        dev_user = user_factory(email='dev2@example.com')
        dev_user = _reload_user(dev_user.id)
        _apply_role(dev_user, dev_role)
        session.commit()

        admin_user = user_factory(email='admin2@example.com')
        admin_user = _reload_user(admin_user.id)
        _apply_role(admin_user, admin_role)
        session.commit()

        backup_admin = user_factory(email='backup-admin@example.com')
        backup_admin = _reload_user(backup_admin.id)
        _apply_role(backup_admin, admin_role)
        session.commit()

        token, _ = session_token_factory(user=dev_user)

    res = client.delete(f'/api/development/users/{admin_user.id}/roles/admin', headers={'Authorization': f'Bearer {token}'})
    assert res.status_code == 200
    data = res.get_json()
    assert data['remaining_admins'] == 1
    assert 'admin' not in data['user']['roles']

    with app.app_context():
        refreshed = _reload_user(admin_user.id)
        role_names = _remove_role_names(refreshed)
        assert 'admin' not in role_names
        assert fallback_role.name in role_names
        audit_entries = AuditLog.query.filter_by(action='role.admin.removed').all()
        assert audit_entries, 'Expected audit log entry for removal'


def test_development_remove_admin_blocks_last_admin(app, client, user_factory, session_token_factory, ensure_role):
    with app.app_context():
        session = Users.query.session
        Users.query.delete()
        session.commit()
        dev_role = ensure_role('development')
        admin_role = ensure_role('admin')
        ensure_role('user')

        dev_user = user_factory(email='dev3@example.com')
        dev_user = _reload_user(dev_user.id)
        _apply_role(dev_user, dev_role)
        session.commit()

        only_admin = user_factory(email='only-admin@example.com')
        only_admin = _reload_user(only_admin.id)
        _apply_role(only_admin, admin_role)
        session.commit()

        token, _ = session_token_factory(user=dev_user)
        only_admin_id = only_admin.id

    res = client.delete(f'/api/development/users/{only_admin_id}/roles/admin', headers={'Authorization': f'Bearer {token}'})
    assert res.status_code == 409
    payload = res.get_json()
    assert 'al menos un administrador' in payload.get('error', '').lower()


def test_development_remove_admin_unknown_user(client, session_token_factory, user_factory, ensure_role, app):
    with app.app_context():
        session = Users.query.session
        Users.query.delete()
        session.commit()
        dev_role = ensure_role('development')
        dev_user = user_factory(email='dev4@example.com')
        dev_user = _reload_user(dev_user.id)
        _apply_role(dev_user, dev_role)
        session.commit()
        token, _ = session_token_factory(user=dev_user)

    unknown_id = uuid.uuid4()
    res = client.delete(f'/api/development/users/{unknown_id}/roles/admin', headers={'Authorization': f'Bearer {token}'})
    assert res.status_code == 404