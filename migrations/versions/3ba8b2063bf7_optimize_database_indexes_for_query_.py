"""optimize_database_indexes_for_query_patterns

Revision ID: 3ba8b2063bf7
Revises: 283a2baf94aa
Create Date: 2025-11-16 14:11:44.735897

This migration adds optimized indexes based on actual query patterns across the application.

Query patterns analyzed:
1. Users: email + deleted_at (login), public_id lookups
2. UserTokens: (user_id, token_type, used_at, expires_at) for active token lookups
3. UserSessions: (user_id, expires_at) for active session queries
4. PlotHistory: (user_id, deleted_at, created_at DESC) for user history pagination
5. RoleRequest: (user_id, status), (status) for filtering
6. AuditLog: (user_id, created_at DESC) for audit trails
7. LearningProgress: user_id (already has uq constraint)
8. RequestTicket: (user_id, status), (status, created_at DESC)

These indexes improve:
- Login performance (email lookups with soft-delete filtering)
- Token validation (active token checks)
- Session management (active session queries)
- History pagination (most frequent query in the app)
- Role request filtering
- Audit log queries

All indexes are PostgreSQL-compatible and safe for SQLite (tests).
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '3ba8b2063bf7'
down_revision = '283a2baf94aa'
branch_labels = None
depends_on = None


def upgrade():
    """Add optimized indexes for common query patterns."""
    
    # 1. Users table optimizations
    # =============================
    # Composite index for login queries: WHERE email = ? AND deleted_at IS NULL
    # This is critical for login performance with soft-delete filtering
    op.create_index(
        'ix_users_email_deleted_at',
        'users',
        ['email', 'deleted_at'],
        unique=False
    )
    
    # Partial index for active users only (PostgreSQL optimization)
    # SQLite will ignore the postgresql_where clause but index still helps
    op.create_index(
        'ix_users_active',
        'users',
        ['id'],
        unique=False,
        postgresql_where=sa.text('deleted_at IS NULL')
    )
    
    # 2. UserTokens table optimizations
    # ==================================
    # Composite index for active token lookups:
    # WHERE user_id = ? AND token_type = ? AND used_at IS NULL AND expires_at > NOW()
    op.create_index(
        'ix_user_tokens_active_lookup',
        'user_tokens',
        ['user_id', 'token_type', 'used_at', 'expires_at'],
        unique=False
    )
    
    # Index for token cleanup queries: WHERE expires_at < NOW()
    op.create_index(
        'ix_user_tokens_expires_at',
        'user_tokens',
        ['expires_at'],
        unique=False
    )
    
    # Partial index for unused tokens (PostgreSQL optimization)
    op.create_index(
        'ix_user_tokens_unused',
        'user_tokens',
        ['user_id', 'token_type', 'expires_at'],
        unique=False,
        postgresql_where=sa.text('used_at IS NULL')
    )
    
    # 3. UserSessions table optimizations
    # ====================================
    # Composite index for active session queries:
    # WHERE user_id = ? AND expires_at > NOW()
    op.create_index(
        'ix_user_sessions_user_expires',
        'user_sessions',
        ['user_id', 'expires_at'],
        unique=False
    )
    
    # Index for session cleanup
    op.create_index(
        'ix_user_sessions_expires_at',
        'user_sessions',
        ['expires_at'],
        unique=False
    )
    
    # 4. PlotHistory table optimizations (CRITICAL - high volume)
    # ============================================================
    # Composite index for user history pagination:
    # WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC
    # This is the most frequent query in the application
    op.create_index(
        'ix_plot_history_user_active_created',
        'plot_history',
        ['user_id', 'deleted_at', sa.text('created_at DESC')],
        unique=False
    )
    
    # Partial index for active plot history (PostgreSQL optimization)
    op.create_index(
        'ix_plot_history_user_active',
        'plot_history',
        ['user_id', sa.text('created_at DESC')],
        unique=False,
        postgresql_where=sa.text('deleted_at IS NULL')
    )
    
    # Index for general created_at queries and cleanup
    op.create_index(
        'ix_plot_history_created_at',
        'plot_history',
        [sa.text('created_at DESC')],
        unique=False
    )
    
    # 5. RoleRequest table optimizations
    # ===================================
    # Composite index for user's role requests: WHERE user_id = ? ORDER BY created_at DESC
    op.create_index(
        'ix_role_requests_user_created',
        'role_requests',
        ['user_id', sa.text('created_at DESC')],
        unique=False
    )
    
    # Index for status filtering: WHERE status = 'pending'
    op.create_index(
        'ix_role_requests_status',
        'role_requests',
        ['status'],
        unique=False
    )
    
    # Composite for filtered queries: WHERE user_id = ? AND status = ?
    op.create_index(
        'ix_role_requests_user_status',
        'role_requests',
        ['user_id', 'status'],
        unique=False
    )
    
    # 6. AuditLog table optimizations
    # ================================
    # Composite index for user audit trails: WHERE user_id = ? ORDER BY created_at DESC
    op.create_index(
        'ix_audit_log_user_created',
        'audit_log',
        ['user_id', sa.text('created_at DESC')],
        unique=False
    )
    
    # Index for entity lookups: WHERE target_entity_type = ? AND target_entity_id = ?
    op.create_index(
        'ix_audit_log_entity',
        'audit_log',
        ['target_entity_type', 'target_entity_id'],
        unique=False
    )
    
    # General created_at index for time-range queries
    op.create_index(
        'ix_audit_log_created_at',
        'audit_log',
        [sa.text('created_at DESC')],
        unique=False
    )
    
    # 7. RequestTicket table optimizations
    # =====================================
    # Composite for user's tickets: WHERE user_id = ? ORDER BY created_at DESC
    op.create_index(
        'ix_request_tickets_user_created',
        'request_tickets',
        ['user_id', sa.text('created_at DESC')],
        unique=False
    )
    
    # Index for status filtering
    op.create_index(
        'ix_request_tickets_status',
        'request_tickets',
        ['status'],
        unique=False
    )
    
    # Composite for filtered queries
    op.create_index(
        'ix_request_tickets_user_status',
        'request_tickets',
        ['user_id', 'status'],
        unique=False
    )
    
    # 8. PlotHistoryTags table optimization
    # ======================================
    # Reverse lookup: find all plots with a specific tag
    # (Forward lookup plot_history_id -> tags is already covered by PK)
    op.create_index(
        'ix_plot_history_tags_tag_id',
        'plot_history_tags',
        ['tag_id'],
        unique=False
    )
    
    # 9. StudentGroup table optimization
    # ===================================
    # Index for teacher's groups: WHERE teacher_id = ?
    # (Already has FK, but explicit index helps)
    op.create_index(
        'ix_student_groups_teacher_created',
        'student_groups',
        ['teacher_id', sa.text('created_at DESC')],
        unique=False
    )


def downgrade():
    """Remove optimized indexes."""
    
    # Drop in reverse order
    op.drop_index('ix_student_groups_teacher_created', table_name='student_groups')
    op.drop_index('ix_plot_history_tags_tag_id', table_name='plot_history_tags')
    op.drop_index('ix_request_tickets_user_status', table_name='request_tickets')
    op.drop_index('ix_request_tickets_status', table_name='request_tickets')
    op.drop_index('ix_request_tickets_user_created', table_name='request_tickets')
    op.drop_index('ix_audit_log_created_at', table_name='audit_log')
    op.drop_index('ix_audit_log_entity', table_name='audit_log')
    op.drop_index('ix_audit_log_user_created', table_name='audit_log')
    op.drop_index('ix_role_requests_user_status', table_name='role_requests')
    op.drop_index('ix_role_requests_status', table_name='role_requests')
    op.drop_index('ix_role_requests_user_created', table_name='role_requests')
    op.drop_index('ix_plot_history_created_at', table_name='plot_history')
    op.drop_index('ix_plot_history_user_active', table_name='plot_history')
    op.drop_index('ix_plot_history_user_active_created', table_name='plot_history')
    op.drop_index('ix_user_sessions_expires_at', table_name='user_sessions')
    op.drop_index('ix_user_sessions_user_expires', table_name='user_sessions')
    op.drop_index('ix_user_tokens_unused', table_name='user_tokens')
    op.drop_index('ix_user_tokens_expires_at', table_name='user_tokens')
    op.drop_index('ix_user_tokens_active_lookup', table_name='user_tokens')
    op.drop_index('ix_users_active', table_name='users')
    op.drop_index('ix_users_email_deleted_at', table_name='users')
