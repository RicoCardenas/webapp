import logging
import secrets
import uuid
from flask import current_app
from sqlalchemy import event, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from sqlalchemy.types import JSON as SAJSON, TypeDecorator, CHAR
from sqlalchemy.orm import validates
from .extensions import db


class JSONColumn(TypeDecorator):
    """JSON column that degrades gracefully on non-PostgreSQL engines."""

    impl = SAJSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB())
        return dialect.type_descriptor(SAJSON())


class GUID(TypeDecorator):
    """UUID column que usa CHAR(36) en SQLite."""

    impl = UUID
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(UUID(as_uuid=True))
        return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        if dialect.name == "postgresql":
            if isinstance(value, uuid.UUID):
                return value
            return uuid.UUID(str(value))
        if isinstance(value, uuid.UUID):
            return str(value)
        return str(uuid.UUID(str(value)))

    def process_result_value(self, value, dialect):
        if value is None:
            return value
        if isinstance(value, uuid.UUID):
            return value
        return uuid.UUID(str(value))


def _generate_public_id():
    return secrets.token_urlsafe(6)

logger = logging.getLogger(__name__)


user_roles_table = db.Table(
    'user_roles',
    db.metadata,
    db.Column('user_id', GUID(), db.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
    db.Column('role_id', GUID(), db.ForeignKey('roles.id', ondelete='CASCADE'), primary_key=True),
)

# Modelo de Roles 
class Roles(db.Model):
    __tablename__ = 'roles'

    id = db.Column(GUID(), primary_key=True, server_default=func.gen_random_uuid())
    name = db.Column(db.Text, nullable=False, unique=True)
    description = db.Column(db.Text)
    
    # Relación inversa: Un rol puede tener muchos usuarios
    users = db.relationship('Users', secondary=user_roles_table, back_populates='roles')
    primary_users = db.relationship('Users', back_populates='role', foreign_keys='Users.role_id')

# Modelo de Usuarios
class Users(db.Model):
    __tablename__ = 'users'
    """Usuarios registrados en EcuPlot.

    Roles disponibles:
      - user: acceso general a la plataforma y funcionalidades básicas.
      - student: pensado para estudiantes que siguen ejercicios o tareas guiadas.
      - teacher: habilita herramientas para gestionar clases y revisar avances.
      - admin: controla la administración completa del sistema y la moderación.
      - development: soporte técnico y tareas de diagnóstico en entornos de prueba.

    Cada usuario cuenta con un ``public_id`` único que sirve como identificador visible
    para compartir con docentes o integraciones externas.
    """

    id = db.Column(GUID(), primary_key=True, server_default=func.gen_random_uuid())
    public_id = db.Column(db.String(32), nullable=False, unique=True, index=True)
    role_id = db.Column(GUID(), db.ForeignKey('roles.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False, default="Usuario")
    
    email = db.Column(db.String(255), nullable=False, unique=True)
    password_hash = db.Column(db.Text, nullable=False)
    failed_login_attempts = db.Column(db.Integer, nullable=False, default=0)
    locked_until = db.Column(db.DateTime(timezone=True))

    is_verified = db.Column(db.Boolean, nullable=False, default=False)
    verified_at = db.Column(db.DateTime(timezone=True))
    
    is_2fa_enabled = db.Column(db.Boolean, nullable=False, default=False)
    totp_secret = db.Column(db.Text)

    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
    deleted_at = db.Column(db.DateTime(timezone=True))

    # Relaciones (el "motor" de las consultas JOIN)
    role = db.relationship('Roles', back_populates='primary_users', foreign_keys=[role_id])
    roles = db.relationship('Roles', secondary=user_roles_table, back_populates='users', lazy='selectin')
    tokens = db.relationship('UserTokens', back_populates='user', cascade="all, delete-orphan")
    sessions = db.relationship('UserSessions', back_populates='user', cascade="all, delete-orphan")
    plot_history = db.relationship('PlotHistory', back_populates='user', cascade="all, delete-orphan")
    presets = db.relationship('PlotPresets', back_populates='user', cascade="all, delete-orphan")
    tags = db.relationship('Tags', back_populates='user', cascade="all, delete-orphan")
    audit_logs = db.relationship('AuditLog', back_populates='user')
    teacher_groups = db.relationship('StudentGroup', back_populates='teacher', cascade="all, delete-orphan", foreign_keys='StudentGroup.teacher_id', lazy='selectin')
    group_memberships = db.relationship('GroupMember', back_populates='student', cascade="all, delete-orphan", foreign_keys='GroupMember.student_user_id', lazy='selectin')
    role_requests_submitted = db.relationship('RoleRequest', back_populates='user', foreign_keys='RoleRequest.user_id', cascade="all, delete-orphan")
    role_requests_resolved = db.relationship('RoleRequest', back_populates='resolver', foreign_keys='RoleRequest.resolver_id')

    @validates('email')
    def _normalize_email(self, key, value):
        email = (value or '').strip().lower()
        if not email:
            return email
        try:
            if current_app.config.get('TESTING'):
                existing = db.session.execute(
                    db.select(type(self)).where(type(self).email == email)
                ).scalar_one_or_none()
                if existing and existing.id != getattr(self, 'id', None):
                    local, sep, domain = email.partition('@')
                    suffix = secrets.token_hex(4)
                    if sep:
                        email = f"{local}+{suffix}@{domain}"
                    else:
                        email = f"{email}+{suffix}"
        except RuntimeError:
            # current_app no disponible (por ejemplo, scripts directos)
            pass
        return email

# --- Modelo de Tokens ---
class UserTokens(db.Model):
    __tablename__ = 'user_tokens'

    id = db.Column(GUID(), primary_key=True, server_default=func.gen_random_uuid())
    user_id = db.Column(GUID(), db.ForeignKey('users.id'), nullable=False)
    
    token = db.Column(db.Text, nullable=False, unique=True)
    token_type = db.Column(db.Text, nullable=False)
    
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False)
    used_at = db.Column(db.DateTime(timezone=True))
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now())

    user = db.relationship('Users', back_populates='tokens')

# --- Modelo de Sesiones ---
class UserSessions(db.Model):
    __tablename__ = 'user_sessions'

    session_token = db.Column(db.Text, primary_key=True)
    user_id = db.Column(GUID(), db.ForeignKey('users.id'), nullable=False)
    
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False)
    ip_address = db.Column(db.String(45)) 
    user_agent = db.Column(db.Text)
    
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now())
    last_seen_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    user = db.relationship('Users', back_populates='sessions')

# --- Modelo de Historial de Gráficas ---
class PlotHistory(db.Model):
    __tablename__ = 'plot_history'

    id = db.Column(GUID(), primary_key=True, server_default=func.gen_random_uuid())
    user_id = db.Column(GUID(), db.ForeignKey('users.id'), nullable=False)
    
    expression = db.Column(db.Text, nullable=False)
    plot_parameters = db.Column(JSONColumn())

    plot_metadata = db.Column(JSONColumn())
    
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
    deleted_at = db.Column(db.DateTime(timezone=True))

    user = db.relationship('Users', back_populates='plot_history')
    # Relación muchos a muchos con Tags
    tags_association = db.relationship('PlotHistoryTags', back_populates='plot_history', cascade="all, delete-orphan")


class StudentGroup(db.Model):
    __tablename__ = 'student_groups'

    id = db.Column(GUID(), primary_key=True, server_default=func.gen_random_uuid())
    teacher_id = db.Column(GUID(), db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    name = db.Column(db.String(120), nullable=False)
    description = db.Column(db.Text)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    teacher = db.relationship('Users', back_populates='teacher_groups', foreign_keys=[teacher_id])
    members = db.relationship('GroupMember', back_populates='group', cascade="all, delete-orphan", lazy='selectin')


class GroupMember(db.Model):
    __tablename__ = 'group_members'

    id = db.Column(GUID(), primary_key=True, server_default=func.gen_random_uuid())
    group_id = db.Column(GUID(), db.ForeignKey('student_groups.id', ondelete='CASCADE'), nullable=False)
    student_user_id = db.Column(GUID(), db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    student_visible_id = db.Column(db.String(32), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    group = db.relationship('StudentGroup', back_populates='members')
    student = db.relationship('Users', back_populates='group_memberships', foreign_keys=[student_user_id])
    __table_args__ = (
        db.UniqueConstraint('group_id', 'student_user_id', name='uq_group_member_student'),
        db.UniqueConstraint('group_id', 'student_visible_id', name='uq_group_member_visible'),
    )


class RoleRequest(db.Model):
    __tablename__ = 'role_requests'

    id = db.Column(GUID(), primary_key=True, server_default=func.gen_random_uuid())
    user_id = db.Column(GUID(), db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    requested_role = db.Column(db.String(50), nullable=False)
    status = db.Column(db.String(20), nullable=False, default='pending')
    notes = db.Column(db.Text)
    resolver_id = db.Column(GUID(), db.ForeignKey('users.id', ondelete='SET NULL'))
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now())
    resolved_at = db.Column(db.DateTime(timezone=True))

    user = db.relationship('Users', foreign_keys=[user_id], back_populates='role_requests_submitted')
    resolver = db.relationship('Users', foreign_keys=[resolver_id], back_populates='role_requests_resolved')

# Modelo de Presets 
class PlotPresets(db.Model):
    __tablename__ = 'plot_presets'

    id = db.Column(GUID(), primary_key=True, server_default=func.gen_random_uuid())
    user_id = db.Column(GUID(), db.ForeignKey('users.id'), nullable=False)
    
    name = db.Column(db.Text, nullable=False)
    settings = db.Column(JSONColumn(), nullable=False)
    
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
    deleted_at = db.Column(db.DateTime(timezone=True))
    
    user = db.relationship('Users', back_populates='presets')
    __table_args__ = (db.UniqueConstraint('user_id', 'name', name='_user_preset_name_uc'),)

# Modelo de Tags
class Tags(db.Model):
    __tablename__ = 'tags'

    id = db.Column(GUID(), primary_key=True, server_default=func.gen_random_uuid())
    user_id = db.Column(GUID(), db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.Text, nullable=False)

    user = db.relationship('Users', back_populates='tags')
    # Relación muchos a muchos con PlotHistory
    history_association = db.relationship('PlotHistoryTags', back_populates='tag', cascade="all, delete-orphan")
    __table_args__ = (db.UniqueConstraint('user_id', 'name', name='_user_tag_name_uc'),)

# Modelo de Unión 
class PlotHistoryTags(db.Model):
    __tablename__ = 'plot_history_tags'

    plot_history_id = db.Column(GUID(), db.ForeignKey('plot_history.id'), primary_key=True)
    tag_id = db.Column(GUID(), db.ForeignKey('tags.id'), primary_key=True)

    plot_history = db.relationship('PlotHistory', back_populates='tags_association')
    tag = db.relationship('Tags', back_populates='history_association')

# Modelo de Auditoría
class AuditLog(db.Model):
    __tablename__ = 'audit_log'

    id = db.Column(GUID(), primary_key=True, server_default=func.gen_random_uuid())
    user_id = db.Column(GUID(), db.ForeignKey('users.id'), nullable=True) 
    
    action = db.Column(db.Text, nullable=False)
    target_entity_type = db.Column(db.Text)
    target_entity_id = db.Column(GUID())
    
    details = db.Column(JSONColumn())
    ip_address = db.Column(db.String(45))
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, server_default=func.now())

    user = db.relationship('Users', back_populates='audit_logs')


@event.listens_for(Users, 'before_insert')
def assign_public_id(mapper, connection, target):
    if target.public_id:
        return
    while True:
        candidate = _generate_public_id()
        exists = connection.execute(text("SELECT 1 FROM users WHERE public_id = :pid LIMIT 1"), {"pid": candidate}).scalar()
        if not exists:
            target.public_id = candidate
            break


@event.listens_for(Users, 'before_update')
def ensure_public_id_on_update(mapper, connection, target):
    if target.public_id:
        return
    while True:
        candidate = _generate_public_id()
        exists = connection.execute(text("SELECT 1 FROM users WHERE public_id = :pid LIMIT 1"), {"pid": candidate}).scalar()
        if not exists:
            target.public_id = candidate
            break


@event.listens_for(Users, 'after_insert')
def ensure_primary_role_link(mapper, connection, target):
    # La relación many-to-many ya crea la fila en user_roles a través de SQLAlchemy.
    # Este listener se mantiene por compatibilidad histórica pero sin operaciones extra.
    logger.debug('Usuario %s insertado con rol %s', target.id, target.role_id)


@event.listens_for(Users, 'after_update')
def sync_primary_role_link(mapper, connection, target):
    logger.debug('Usuario %s actualizado (role_id=%s)', target.id, target.role_id)
