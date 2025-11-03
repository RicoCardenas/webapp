"""Add 2FA backup codes table

Revision ID: a6c3f9d1c4b0
Revises: e2edb87a6c09
Create Date: 2025-11-05 00:10:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'a6c3f9d1c4b0'
down_revision = 'e2edb87a6c09'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'user_backup_codes',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('code_hash', sa.String(length=128), nullable=False),
        sa.Column('used_at', sa.DateTime(timezone=True)),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('NOW()')),
        sa.PrimaryKeyConstraint('id', name='pk_user_backup_codes'),
    )
    op.create_index('ix_user_backup_codes_user_id', 'user_backup_codes', ['user_id'])


def downgrade():
    op.drop_index('ix_user_backup_codes_user_id', table_name='user_backup_codes')
    op.drop_table('user_backup_codes')
