from .app import create_app
import click
from sqlalchemy.orm import selectinload

from .app.models import Roles, PlotHistory, PlotHistoryTags
from .app.extensions import db
from .app.plot_tags import apply_tags_to_history, classify_expression

app = create_app()

@app.cli.command("seed-roles")
def seed_roles():
    """
    Crea los roles iniciales en la base de datos si no existen.
    """
    print("Iniciando la siembra de roles...")
    
    # Roles que tu app necesita y que solicitaste
    roles_to_seed = [
        {'name': 'user', 'description': 'Rol base con acceso estándar a la plataforma.'},
        {'name': 'student', 'description': 'Funciones orientadas a estudiantes y prácticas guiadas.'},
        {'name': 'teacher', 'description': 'Permite gestionar clases, materiales y seguimiento de estudiantes.'},
        {'name': 'admin', 'description': 'Administración completa del sistema y moderación.'},
        {'name': 'development', 'description': 'Soporte técnico y labores de diagnóstico en entornos de prueba.'},
    ]
    
    roles_creados = 0
    for role_data in roles_to_seed:
        role_name = role_data['name']
        # Usamos 'Roles' como en tu models.py
        existing_role = Roles.query.filter_by(name=role_name).first() 
        
        if not existing_role:
            new_role = Roles(name=role_name, description=role_data['description'])
            db.session.add(new_role)
            print(f"Rol '{role_name}' creado.")
            roles_creados += 1
        else:
            print(f"Rol '{role_name}' ya existe.")
            
    if roles_creados > 0:
        db.session.commit()
        print(f"¡{roles_creados} roles nuevos añadidos a la base de datos!")
    else:
        print("No se crearon roles nuevos.")


@app.cli.command("backfill-plot-history-tags")
@click.option("--dry-run", is_flag=True, help="Procesa sin guardar cambios.")
def backfill_plot_history_tags(dry_run: bool = False):
    """Auto-etiqueta registros antiguos de historial que aún no tienen tags."""
    updated = 0
    entries = db.session.scalars(
        db.select(PlotHistory).options(
            selectinload(PlotHistory.tags_association).selectinload(PlotHistoryTags.tag)
        )
    )

    for history in entries:
        if history.tags_association:
            continue
        categories = classify_expression(history.expression)
        applied = apply_tags_to_history(history, categories, session=db.session)
        if applied:
            updated += 1

    if dry_run:
        db.session.rollback()
    else:
        db.session.commit()

    suffix = " (dry-run)" if dry_run else ""
    click.echo(f"Auto-etiquetados {updated} registros{suffix}.")

@app.shell_context_processor
def make_shell_context():
    
    from .app.extensions import db
    from .app.models import (
        Users, 
        Roles, 
        UserTokens,
        UserSessions, 
        PlotHistory,
        PlotPresets,
        Tags,
        PlotHistoryTags,
        AuditLog,
        StudentGroup,
        GroupMember,
        RoleRequest
        )
    
    return {
        "app": app,
        "db": db,
        "Users": Users,
        "Roles": Roles,
        "UserTokens": UserTokens,
        "UserSessions": UserSessions,
        "PlotHistory": PlotHistory,
        "PlotPresets": PlotPresets,
        "Tags": Tags,
        "PlotHistoryTags": PlotHistoryTags,
        "AuditLog": AuditLog,
        "StudentGroup": StudentGroup,
        "GroupMember": GroupMember,
        "RoleRequest": RoleRequest
    }


if __name__ == "__main__":
    app.run(debug=True)
    
