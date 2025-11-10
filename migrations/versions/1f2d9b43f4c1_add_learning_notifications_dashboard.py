"""Add learning progress, notifications, and dashboard layout

Revision ID: 1f2d9b43f4c1
Revises: a6c3f9d1c4b0
Create Date: 2025-11-15 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = '1f2d9b43f4c1'
down_revision = 'a6c3f9d1c4b0'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'learning_progress',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('exercise_id', sa.String(length=64), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('NOW()')),
        sa.PrimaryKeyConstraint('id', name='pk_learning_progress'),
        sa.UniqueConstraint('user_id', 'exercise_id', name='uq_learning_user_exercise'),
    )
    op.execute("DROP INDEX IF EXISTS ix_learning_progress_user_id")
    op.create_index('ix_learning_progress_user_id', 'learning_progress', ['user_id'])

    op.create_table(
        'user_notifications',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('category', sa.String(length=64), nullable=False, index=True),
        sa.Column('title', sa.Text(), nullable=False),
        sa.Column('body', sa.Text()),
        sa.Column('payload', postgresql.JSONB(astext_type=sa.Text())),
        sa.Column('read_at', sa.DateTime(timezone=True)),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('NOW()')),
        sa.PrimaryKeyConstraint('id', name='pk_user_notifications'),
    )
    op.create_index('ix_user_notifications_user_unread', 'user_notifications', ['user_id', 'read_at'])

    op.create_table(
        'notification_preferences',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('category', sa.String(length=64), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.text('TRUE')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('NOW()')),
        sa.PrimaryKeyConstraint('id', name='pk_notification_preferences'),
        sa.UniqueConstraint('user_id', 'category', name='uq_notification_pref_user_category'),
    )

    op.add_column('users', sa.Column('dashboard_layout', postgresql.JSONB(astext_type=sa.Text())))


def downgrade():
    op.drop_column('users', 'dashboard_layout')
    op.drop_table('notification_preferences')
    op.drop_index('ix_user_notifications_user_unread', table_name='user_notifications')
    op.drop_table('user_notifications')
    op.drop_index('ix_learning_progress_user_id', table_name='learning_progress')
    op.drop_table('learning_progress')
