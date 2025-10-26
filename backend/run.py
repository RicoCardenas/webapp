from .app import create_app
import click
from .app.models import Roles
from .app.extensions import db

app = create_app()

@app.cli.command("seed-roles")
def seed_roles():
    """
    Crea los roles iniciales en la base de datos si no existen.
    """
    print("Iniciando la siembra de roles...")
    
    # Roles que tu app necesita y que solicitaste
    roles_to_seed = [
        # Este es el rol que tu ruta register_user busca
        {'name': 'user', 'description': 'Rol de usuario estándar.'},
        {'name': 'Profesor', 'description': 'Acceso para gestionar grupos o recursos.'},
        {'name': 'Administrador', 'description': 'Acceso total al sistema.'}
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
        AuditLog
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
        "AuditLog": AuditLog
    }


if __name__ == "__main__":
    app.run(debug=True)
    
