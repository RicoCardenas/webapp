from datetime import datetime, timedelta, timezone

from sqlalchemy import func

from backend.app.models import Roles, Users, UserSessions, PlotHistory, RoleRequest


def _ensure_role(db, name):
    role = db.session.execute(db.select(Roles).where(Roles.name == name)).scalar_one_or_none()
    if role:
        return role
    role = Roles(name=name, description=f'Rol {name}')
    db.session.add(role)
    db.session.commit()
    return role


def _prepare_admin_data(app, db, user_factory):
    with app.app_context():
        admin_role = _ensure_role(db, 'admin')
        user_role = _ensure_role(db, 'user')

        admin_user = user_factory(email='admin@example.com')
        admin_user = db.session.get(Users, admin_user.id)
        admin_user.role_id = admin_role.id
        admin_user.roles = [admin_role]

        regular_user = user_factory(email='regular@example.com')
        regular_user = db.session.get(Users, regular_user.id)
        regular_user.role_id = user_role.id
        regular_user.roles = [user_role]

        now = datetime.now(timezone.utc)

        db.session.add_all(
            [
                UserSessions(
                    session_token='admintoken',
                    user_id=admin_user.id,
                    expires_at=now + timedelta(days=7),
                    last_seen_at=now,
                ),
                UserSessions(
                    session_token='usertoken',
                    user_id=regular_user.id,
                    expires_at=now + timedelta(days=7),
                    last_seen_at=now - timedelta(days=10),
                ),
            ]
        )

        db.session.add_all(
            [
                PlotHistory(user_id=admin_user.id, expression='f(x)=x', created_at=now),
                PlotHistory(user_id=admin_user.id, expression='g(x)=x^2', created_at=now - timedelta(days=3)),
                PlotHistory(user_id=admin_user.id, expression='h(x)=x^3', created_at=now - timedelta(days=20)),
                PlotHistory(
                    user_id=admin_user.id,
                    expression='deprecated',
                    created_at=now - timedelta(days=1),
                    deleted_at=now,
                ),
            ]
        )

        db.session.add_all(
            [
                RoleRequest(user_id=regular_user.id, requested_role='admin', status='pending'),
                RoleRequest(user_id=regular_user.id, requested_role='teacher', status='approved'),
                RoleRequest(user_id=regular_user.id, requested_role='teacher', status='rejected'),
            ]
        )

        db.session.commit()

        return admin_user


def test_admin_stats_endpoints(client, app, _db, user_factory, session_token_factory):
    now = datetime.now(timezone.utc)
    start_today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = now - timedelta(days=7)

    with app.app_context():
        baseline_user_total = (
            _db.session.query(func.count(Users.id))
            .filter(Users.deleted_at.is_(None))
            .scalar()
            or 0
        )
        baseline_admin_users = (
            _db.session.query(func.count(Users.id))
            .join(Roles, Users.role_id == Roles.id)
            .filter(Users.deleted_at.is_(None), Roles.name == 'admin')
            .scalar()
            or 0
        )
        baseline_active = (
            _db.session.query(func.count(func.distinct(UserSessions.user_id)))
            .filter(UserSessions.last_seen_at.isnot(None), UserSessions.last_seen_at >= week_ago)
            .scalar()
            or 0
        )

        baseline_requests_total = _db.session.query(func.count(RoleRequest.id)).scalar() or 0
        baseline_requests_pending = (
            _db.session.query(func.count(RoleRequest.id))
            .filter(RoleRequest.status == 'pending')
            .scalar()
            or 0
        )
        baseline_requests_resolved = (
            _db.session.query(func.count(RoleRequest.id))
            .filter(RoleRequest.status.in_(('approved', 'rejected')))
            .scalar()
            or 0
        )
        baseline_requests_open = max(baseline_requests_total - baseline_requests_resolved, 0)

        baseline_plots_total = (
            _db.session.query(func.count(PlotHistory.id))
            .filter(PlotHistory.deleted_at.is_(None))
            .scalar()
            or 0
        )
        baseline_plots_week = (
            _db.session.query(func.count(PlotHistory.id))
            .filter(PlotHistory.deleted_at.is_(None), PlotHistory.created_at >= week_ago)
            .scalar()
            or 0
        )
        baseline_plots_today = (
            _db.session.query(func.count(PlotHistory.id))
            .filter(PlotHistory.deleted_at.is_(None), PlotHistory.created_at >= start_today)
            .scalar()
            or 0
        )

    admin_user = _prepare_admin_data(app, _db, user_factory)
    token, _ = session_token_factory(user=admin_user)
    headers = {"Authorization": f"Bearer {token}"}

    users_stats = client.get("/api/admin/stats/users", headers=headers)
    assert users_stats.status_code == 200
    users_payload = users_stats.get_json()
    assert users_payload["total"] >= baseline_user_total + 2
    assert users_payload["activos_7d"] >= baseline_active + 1
    assert users_payload["por_rol"].get("admin", 0) >= baseline_admin_users + 1

    requests_stats = client.get("/api/admin/stats/requests", headers=headers)
    assert requests_stats.status_code == 200
    requests_payload = requests_stats.get_json()
    assert requests_payload["pendientes"] >= baseline_requests_pending + 1
    assert requests_payload["atendidas"] >= baseline_requests_resolved + 2
    assert requests_payload["abiertas"] >= baseline_requests_open + 1

    plots_stats = client.get("/api/admin/stats/plots", headers=headers)
    assert plots_stats.status_code == 200
    plots_payload = plots_stats.get_json()
    assert plots_payload["total"] >= baseline_plots_total + 3
    assert plots_payload["hoy"] >= baseline_plots_today + 1
    assert plots_payload["ultimos_7d"] >= baseline_plots_week + 2
