"""Permitir nuevos tipos de tokens para bloqueo y restablecimiento.

Revision ID: f0df5d8d2c7c
Revises: d8c4a743934e
Create Date: 2025-11-01 14:20:00.000000
"""

from alembic import op


revision = 'f0df5d8d2c7c'
down_revision = 'd8c4a743934e'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE user_tokens DROP CONSTRAINT IF EXISTS user_tokens_token_type_check")
    op.execute(
        """
        ALTER TABLE user_tokens
        ADD CONSTRAINT user_tokens_token_type_check
        CHECK (token_type IN ('verify_email', 'password_reset', 'account_unlock'))
        """
    )


def downgrade():
    op.execute("ALTER TABLE user_tokens DROP CONSTRAINT IF EXISTS user_tokens_token_type_check")
    op.execute(
        """
        ALTER TABLE user_tokens
        ADD CONSTRAINT user_tokens_token_type_check
        CHECK (token_type = 'verify_email')
        """
    )
