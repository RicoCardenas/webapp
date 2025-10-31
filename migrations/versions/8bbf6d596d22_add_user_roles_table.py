"""Agregar tabla de roles múltiples y sincronizar datos.

Revision ID: 8bbf6d596d22
Revises: 3a99a8eff231
Create Date: 2025-10-30 21:15:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = '8bbf6d596d22'
down_revision = '3a99a8eff231'
branch_labels = None
depends_on = None


ROLES_TO_SEED = [
    ('user', 'Rol base con acceso estándar a la plataforma.'),
    ('student', 'Funciones orientadas a estudiantes y prácticas guiadas.'),
    ('teacher', 'Permite gestionar clases, materiales y seguimiento de estudiantes.'),
    ('admin', 'Administración completa del sistema y moderación.'),
    ('development', 'Soporte técnico y tareas de diagnóstico en entornos de prueba.'),
]


def upgrade():
    op.create_table(
        'user_roles',
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('role_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('roles.id', ondelete='CASCADE'), nullable=False),
        sa.PrimaryKeyConstraint('user_id', 'role_id', name='pk_user_roles'),
    )

    bind = op.get_bind()

    for name, description in ROLES_TO_SEED:
        bind.execute(
            sa.text(
                """
                INSERT INTO roles (name, description)
                SELECT :name, :description
                WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = :name)
                """
            ),
            {'name': name, 'description': description},
        )

    bind.execute(
        sa.text(
            """
            INSERT INTO user_roles (user_id, role_id)
            SELECT id, role_id FROM users WHERE role_id IS NOT NULL
            ON CONFLICT DO NOTHING
            """
        )
    )


def downgrade():
    op.drop_table('user_roles')
