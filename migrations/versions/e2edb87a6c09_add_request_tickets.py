"""Add request tickets table

Revision ID: e2edb87a6c09
Revises: f0df5d8d2c7c
Create Date: 2025-11-05 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'e2edb87a6c09'
down_revision = 'f0df5d8d2c7c'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'request_tickets',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('type', sa.String(length=50), nullable=False),
        sa.Column('title', sa.String(length=120), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='pendiente'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('NOW()')),
        sa.PrimaryKeyConstraint('id', name='pk_request_tickets'),
    )
    op.create_index('ix_request_tickets_user_id', 'request_tickets', ['user_id'])
    op.create_index('ix_request_tickets_status', 'request_tickets', ['status'])


def downgrade():
    op.drop_index('ix_request_tickets_status', table_name='request_tickets')
    op.drop_index('ix_request_tickets_user_id', table_name='request_tickets')
    op.drop_table('request_tickets')
