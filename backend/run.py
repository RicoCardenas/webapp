"""Entry point for running the backend development server."""
from .app import create_app


app = create_app()

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
        )# Importa tus modelos
    
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