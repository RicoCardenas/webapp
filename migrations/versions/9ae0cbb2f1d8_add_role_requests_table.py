"""Crear tabla para solicitudes de roles.

Revision ID: 9ae0cbb2f1d8
Revises: 7f6c3d1b6b92
Create Date: 2025-10-30 22:40:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = '9ae0cbb2f1d8'
down_revision = '7f6c3d1b6b92'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'role_requests',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('requested_role', sa.String(length=50), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False, server_default=sa.text("'pending'")),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('resolver_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()'), nullable=False),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id', name='pk_role_requests')
    )
    op.create_index('ix_role_requests_user_id', 'role_requests', ['user_id'])
    op.create_index('ix_role_requests_status', 'role_requests', ['status'])


def downgrade():
    op.drop_index('ix_role_requests_status', table_name='role_requests')
    op.drop_index('ix_role_requests_user_id', table_name='role_requests')
    op.drop_table('role_requests')
