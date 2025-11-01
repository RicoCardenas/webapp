from alembic import op
import sqlalchemy as sa


revision = 'd8c4a743934e'
down_revision = '9ae0cbb2f1d8'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'users',
        sa.Column('failed_login_attempts', sa.Integer(), nullable=False, server_default=sa.text('0')),
    )
    op.add_column(
        'users',
        sa.Column('locked_until', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_column('users', 'locked_until')
    op.drop_column('users', 'failed_login_attempts')
