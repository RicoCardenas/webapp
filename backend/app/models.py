from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from .extensions import db

# --- Modelo de Roles ---
class Roles(db.Model):
    __tablename__ = 'roles'

    id = db.Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    name = db.Column(db.Text, nullable=False, unique=True)
    description = db.Column(db.Text)
    
    # Relación inversa: Un rol puede tener muchos usuarios
    users = db.relationship('Users', back_populates='role')

# --- Modelo de Usuarios ---
class Users(db.Model):
    __tablename__ = 'users'

    id = db.Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    role_id = db.Column(UUID(as_uuid=True), db.ForeignKey('roles.id'), nullable=False)
    
    email = db.Column(db.String(255), nullable=False, unique=True) # Usamos String en el ORM, citext en la DB
    password_hash = db.Column(db.Text, nullable=False)
    
    is_verified = db.Column(db.Boolean, nullable=False, default=False)
    verified_at = db.Column(db.DateTime(timezone=True))
    
    is_2fa_enabled = db.Column(db.Boolean, nullable=False, default=False)
    totp_secret = db.Column(db.Text)

    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
    deleted_at = db.Column(db.DateTime(timezone=True))

    # Relaciones (el "motor" de las consultas JOIN)
    role = db.relationship('Roles', back_populates='users')
    tokens = db.relationship('UserTokens', back_populates='user', cascade="all, delete-orphan")
    sessions = db.relationship('UserSessions', back_populates='user', cascade="all, delete-orphan")
    plot_history = db.relationship('PlotHistory', back_populates='user', cascade="all, delete-orphan")
    presets = db.relationship('PlotPresets', back_populates='user', cascade="all, delete-orphan")
    tags = db.relationship('Tags', back_populates='user', cascade="all, delete-orphan")
    audit_logs = db.relationship('AuditLog', back_populates='user')

# --- Modelo de Tokens (Verificación, Reseteo) ---
class UserTokens(db.Model):
    __tablename__ = 'user_tokens'

    id = db.Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    user_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.id'), nullable=False)
    
    token = db.Column(db.Text, nullable=False, unique=True)
    token_type = db.Column(db.Text, nullable=False) # 'verify_email' o 'reset_password'
    
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False)
    used_at = db.Column(db.DateTime(timezone=True))
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now())

    user = db.relationship('Users', back_populates='tokens')

# --- Modelo de Sesiones ---
class UserSessions(db.Model):
    __tablename__ = 'user_sessions'

    session_token = db.Column(db.Text, primary_key=True)
    user_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.id'), nullable=False)
    
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False)
    ip_address = db.Column(db.String(45)) # Para IPv4 e IPv6 mapeadas
    user_agent = db.Column(db.Text)
    
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now())
    last_seen_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    user = db.relationship('Users', back_populates='sessions')

# --- Modelo de Historial de Gráficas ---
class PlotHistory(db.Model):
    __tablename__ = 'plot_history'

    id = db.Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    user_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.id'), nullable=False)
    
    expression = db.Column(db.Text, nullable=False)
    plot_parameters = db.Column(JSONB)
    
    # --- ESTA ES LA LÍNEA CORREGIDA ---
    # Renombramos 'metadata' a 'plot_metadata' para evitar el conflicto
    # con la palabra reservada de SQLAlchemy.
    plot_metadata = db.Column(JSONB)
    
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
    deleted_at = db.Column(db.DateTime(timezone=True))

    user = db.relationship('Users', back_populates='plot_history')
    # Relación muchos a muchos con Tags
    tags_association = db.relationship('PlotHistoryTags', back_populates='plot_history', cascade="all, delete-orphan")

# --- Modelo de Presets ---
class PlotPresets(db.Model):
    __tablename__ = 'plot_presets'

    id = db.Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    user_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.id'), nullable=False)
    
    name = db.Column(db.Text, nullable=False)
    settings = db.Column(JSONB, nullable=False)
    
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
    deleted_at = db.Column(db.DateTime(timezone=True))
    
    user = db.relationship('Users', back_populates='presets')
    __table_args__ = (db.UniqueConstraint('user_id', 'name', name='_user_preset_name_uc'),)

# --- Modelo de Tags ---
class Tags(db.Model):
    __tablename__ = 'tags'

    id = db.Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    user_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.Text, nullable=False)

    user = db.relationship('Users', back_populates='tags')
    # Relación muchos a muchos con PlotHistory
    history_association = db.relationship('PlotHistoryTags', back_populates='tag', cascade="all, delete-orphan")
    __table_args__ = (db.UniqueConstraint('user_id', 'name', name='_user_tag_name_uc'),)

# --- Modelo de Unión (Tags <-> Historial) ---
class PlotHistoryTags(db.Model):
    __tablename__ = 'plot_history_tags'

    plot_history_id = db.Column(UUID(as_uuid=True), db.ForeignKey('plot_history.id'), primary_key=True)
    tag_id = db.Column(UUID(as_uuid=True), db.ForeignKey('tags.id'), primary_key=True)

    plot_history = db.relationship('PlotHistory', back_populates='tags_association')
    tag = db.relationship('Tags', back_populates='history_association')

# --- Modelo de Auditoría ---
class AuditLog(db.Model):
    __tablename__ = 'audit_log'

    id = db.Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    user_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.id'), nullable=True) # Nulo si la acción es del sistema
    
    action = db.Column(db.Text, nullable=False)
    target_entity_type = db.Column(db.Text)
    target_entity_id = db.Column(UUID(as_uuid=True))
    
    details = db.Column(JSONB)
    ip_address = db.Column(db.String(45))
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now())
    
    user = db.relationship('Users', back_populates='audit_logs')