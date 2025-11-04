"""Allow SSE stream tokens in user_tokens.

Revision ID: 1b2c3d4e5f67
Revises: 1f2d9b43f4c1
Create Date: 2025-11-03 22:40:00.000000
"""

from alembic import op


revision = '1b2c3d4e5f67'
down_revision = '1f2d9b43f4c1'
branch_labels = None
depends_on = None


_ALLOWED_TYPES = (
    "verify_email",
    "password_reset",
    "account_unlock",
    "sse_stream",
)


def upgrade():
    op.execute("ALTER TABLE user_tokens DROP CONSTRAINT IF EXISTS user_tokens_token_type_check")
    op.execute(
        """
        ALTER TABLE user_tokens
        ADD CONSTRAINT user_tokens_token_type_check
        CHECK (token_type IN ('verify_email', 'password_reset', 'account_unlock', 'sse_stream'))
        """
    )


def downgrade():
    op.execute("ALTER TABLE user_tokens DROP CONSTRAINT IF EXISTS user_tokens_token_type_check")
    op.execute(
        """
        ALTER TABLE user_tokens
        ADD CONSTRAINT user_tokens_token_type_check
        CHECK (token_type IN ('verify_email', 'password_reset', 'account_unlock'))
        """
    )
