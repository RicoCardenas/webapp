"""Gestionar docentes por administrador.

Revision ID: b4d665c2fa31
Revises: 1b2c3d4e5f67
Create Date: 2025-11-08 10:00:00.000000
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'b4d665c2fa31'
down_revision = '1b2c3d4e5f67'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'admin_teacher_assignments',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('admin_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('teacher_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('assigned_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()'), nullable=False),
        sa.ForeignKeyConstraint(['admin_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['teacher_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name='pk_admin_teacher_assignments'),
        sa.UniqueConstraint('teacher_id', name='uq_admin_teacher_assignment_teacher'),
    )
    op.create_index('ix_admin_teacher_assignments_admin_id', 'admin_teacher_assignments', ['admin_id'])
    op.create_index('ix_admin_teacher_assignments_teacher_id', 'admin_teacher_assignments', ['teacher_id'])

    op.create_table(
        'admin_teacher_groups',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('admin_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()'), nullable=False),
        sa.ForeignKeyConstraint(['admin_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name='pk_admin_teacher_groups'),
        sa.UniqueConstraint('admin_id', 'name', name='uq_admin_teacher_group_name'),
    )
    op.create_index('ix_admin_teacher_groups_admin_id', 'admin_teacher_groups', ['admin_id'])

    op.create_table(
        'admin_teacher_group_members',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('group_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('teacher_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('added_at', sa.DateTime(timezone=True), server_default=sa.text('NOW()'), nullable=False),
        sa.ForeignKeyConstraint(['group_id'], ['admin_teacher_groups.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['teacher_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id', name='pk_admin_teacher_group_members'),
        sa.UniqueConstraint('group_id', 'teacher_id', name='uq_admin_teacher_group_member'),
    )
    op.create_index('ix_admin_teacher_group_members_group_id', 'admin_teacher_group_members', ['group_id'])
    op.create_index('ix_admin_teacher_group_members_teacher_id', 'admin_teacher_group_members', ['teacher_id'])


def downgrade():
    op.drop_index('ix_admin_teacher_group_members_teacher_id', table_name='admin_teacher_group_members')
    op.drop_index('ix_admin_teacher_group_members_group_id', table_name='admin_teacher_group_members')
    op.drop_table('admin_teacher_group_members')

    op.drop_index('ix_admin_teacher_groups_admin_id', table_name='admin_teacher_groups')
    op.drop_table('admin_teacher_groups')

    op.drop_index('ix_admin_teacher_assignments_teacher_id', table_name='admin_teacher_assignments')
    op.drop_index('ix_admin_teacher_assignments_admin_id', table_name='admin_teacher_assignments')
    op.drop_table('admin_teacher_assignments')
