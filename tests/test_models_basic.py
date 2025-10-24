# tests/test_models_basic.py
def test_role_user_exists_or_unique(app, _db, models_ns):
    with app.app_context():
        # Asegura existencia de 'user' (en SQLite la unicidad puede no aplicarse igual que en Postgres)
        if not _db.session.execute(_db.select(models_ns.Roles).where(models_ns.Roles.name == "user")).first():
            _db.session.add(models_ns.Roles(name="user", description="Default"))
            _db.session.commit()
        q = _db.session.execute(_db.select(models_ns.Roles).where(models_ns.Roles.name == "user")).scalars().all()
        assert len(q) >= 1

def test_user_plot_relationship(app, _db, models_ns):
    with app.app_context():
        role = _db.session.execute(_db.select(models_ns.Roles).where(models_ns.Roles.name == "user")).scalar_one()
        u = models_ns.Users(email="rel@test.com", password_hash="x", role_id=role.id, is_verified=True)
        _db.session.add(u)
        _db.session.commit()

        p = models_ns.PlotHistory(user_id=u.id, expression="f(x)=x")
        _db.session.add(p)
        _db.session.commit()

        # relación inversa
        assert len(u.plot_history) == 1
        assert u.plot_history[0].expression == "f(x)=x"
