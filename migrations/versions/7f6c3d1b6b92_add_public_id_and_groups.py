"""Agregar public_id a usuarios y tablas de grupos.

Revision ID: 7f6c3d1b6b92
Revises: 8bbf6d596d22
Create Date: 2025-10-30 22:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from secrets import token_urlsafe


revision = '7f6c3d1b6b92'
down_revision = '8bbf6d596d22'
branch_labels = None
depends_on = None


def _generate_unique_public_id(bind):
    while True:
        candidate = token_urlsafe(6)
        exists = bind.execute(
            sa.text("SELECT 1 FROM users WHERE public_id = :pid LIMIT 1"),
            {"pid": candidate},
        ).scalar()
        if not exists:
            return candidate


def upgrade():
    op.add_column('users', sa.Column('public_id', sa.String(length=32), nullable=True))
    op.create_index('ix_users_public_id', 'users', ['public_id'], unique=True)

    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id FROM users")).fetchall()
    for row in rows:
        bind.execute(
            sa.text("UPDATE users SET public_id = :pid WHERE id = :uid"),
            {"pid": _generate_unique_public_id(bind), "uid": row.id},
        )

    op.alter_column('users', 'public_id', nullable=False)

    op.create_table(
        'student_groups',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('teacher_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()'), nullable=False),
        sa.PrimaryKeyConstraint('id', name='pk_student_groups'),
    )

    op.create_table(
        'group_members',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('group_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('student_groups.id', ondelete='CASCADE'), nullable=False),
        sa.Column('student_user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('student_visible_id', sa.String(length=32), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()'), nullable=False),
        sa.PrimaryKeyConstraint('id', name='pk_group_members'),
        sa.UniqueConstraint('group_id', 'student_user_id', name='uq_group_member_student'),
        sa.UniqueConstraint('group_id', 'student_visible_id', name='uq_group_member_visible'),
    )


def downgrade():
    op.drop_table('group_members')
    op.drop_table('student_groups')
    op.drop_index('ix_users_public_id', table_name='users')
    op.drop_column('users', 'public_id')
