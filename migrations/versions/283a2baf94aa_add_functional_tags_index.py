"""add_functional_tags_index

Revision ID: 283a2baf94aa
Revises: 58391c3776b4
Create Date: 2025-11-10 01:27:30.766505

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '283a2baf94aa'
down_revision = '58391c3776b4'
branch_labels = None
depends_on = None


def upgrade():
    # Índice parcial para tags de funciones matemáticas comunes
    # Optimiza búsquedas de expresiones por función (sin, cos, log, etc)
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_tags_functional_names
        ON tags(name)
        WHERE name IN ('sin', 'cos', 'tan', 'log', 'ln', 'exp', 'sqrt', 'abs', 
                       'polynomial', 'linear', 'quadratic', 'exponential', 'logarithmic')
    """)


def downgrade():
    op.execute("DROP INDEX IF EXISTS idx_tags_functional_names")
