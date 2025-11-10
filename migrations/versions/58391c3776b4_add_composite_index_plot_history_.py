"""add_composite_index_plot_history_performance

Revision ID: 58391c3776b4
Revises: b4d665c2fa31
Create Date: 2025-11-10 01:03:01.228851

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '58391c3776b4'
down_revision = 'b4d665c2fa31'
branch_labels = None
depends_on = None


def upgrade():
    # Crear índice compuesto para optimizar queries de historial por usuario
    # Este índice mejora significativamente el rendimiento de:
    # - Paginación de historial (ORDER BY created_at DESC)
    # - Filtros por usuario (WHERE user_id = ?)
    # - Combinación de ambos con LIMIT/OFFSET
    op.create_index(
        'ix_plot_history_user_created_id',
        'plot_history',
        ['user_id', sa.text('created_at DESC'), 'id'],
        unique=False
    )


def downgrade():
    # Eliminar el índice compuesto
    op.drop_index('ix_plot_history_user_created_id', table_name='plot_history')
