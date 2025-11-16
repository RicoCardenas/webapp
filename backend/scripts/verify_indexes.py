#!/usr/bin/env python
"""
Script to verify that all expected database indexes are present.

Usage:
    cd /home/julian/Documentos/ecuplot_all/webapp
    source .venv/bin/activate
    flask run --app backend/run.py shell

Then in the Flask shell:
    exec(open('backend/scripts/verify_indexes.py').read())

Or use as a standalone command with proper Flask context.
"""
try:
    # Try importing if running as a module
    from flask import current_app
    from app.extensions import db
    from sqlalchemy import inspect, text
    
    # Use current_app if already in Flask context
    def create_app():
        return current_app._get_current_object()
        
except (ImportError, RuntimeError):
    # Fallback for standalone execution
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).parent.parent))
    
    from app import create_app
    from app.extensions import db
    from sqlalchemy import inspect, text


# Expected indexes from migration 3ba8b2063bf7
EXPECTED_INDEXES = {
    'users': [
        'ix_users_email_deleted_at',
        'ix_users_active',
    ],
    'user_tokens': [
        'ix_user_tokens_active_lookup',
        'ix_user_tokens_expires_at',
        'ix_user_tokens_unused',
    ],
    'user_sessions': [
        'ix_user_sessions_user_expires',
        'ix_user_sessions_expires_at',
    ],
    'plot_history': [
        'ix_plot_history_user_active_created',
        'ix_plot_history_user_active',
        'ix_plot_history_created_at',
    ],
    'role_requests': [
        'ix_role_requests_user_created',
        'ix_role_requests_status',
        'ix_role_requests_user_status',
    ],
    'audit_log': [
        'ix_audit_log_user_created',
        'ix_audit_log_entity',
        'ix_audit_log_created_at',
    ],
    'request_tickets': [
        'ix_request_tickets_user_created',
        'ix_request_tickets_status',
        'ix_request_tickets_user_status',
    ],
    'plot_history_tags': [
        'ix_plot_history_tags_tag_id',
    ],
    'student_groups': [
        'ix_student_groups_teacher_created',
    ],
}


def get_table_indexes(inspector, table_name):
    """Get all indexes for a table."""
    try:
        indexes = inspector.get_indexes(table_name)
        return {idx['name'] for idx in indexes if idx['name']}
    except Exception as e:
        print(f"  ⚠️  Error getting indexes for {table_name}: {e}")
        return set()


def check_indexes():
    """Verify all expected indexes are present."""
    app = create_app()
    
    with app.app_context():
        engine = db.engine
        inspector = inspect(engine)
        dialect = engine.dialect.name
        
        print(f"\n{'='*70}")
        print(f"Database Index Verification")
        print(f"{'='*70}")
        print(f"Database: {dialect}")
        print(f"Connection: {engine.url.database}")
        print(f"{'='*70}\n")
        
        all_present = True
        total_expected = 0
        total_found = 0
        
        for table_name, expected_indexes in EXPECTED_INDEXES.items():
            print(f"\n📋 Table: {table_name}")
            print(f"   Expected: {len(expected_indexes)} indexes")
            
            actual_indexes = get_table_indexes(inspector, table_name)
            total_expected += len(expected_indexes)
            
            for index_name in expected_indexes:
                if index_name in actual_indexes:
                    print(f"   ✅ {index_name}")
                    total_found += 1
                else:
                    print(f"   ❌ {index_name} - MISSING!")
                    all_present = False
        
        # Summary
        print(f"\n{'='*70}")
        print(f"Summary")
        print(f"{'='*70}")
        print(f"Total expected indexes: {total_expected}")
        print(f"Total found: {total_found}")
        print(f"Missing: {total_expected - total_found}")
        
        if all_present:
            print(f"\n✅ All expected indexes are present!")
        else:
            print(f"\n❌ Some indexes are missing. Run migrations:")
            print(f"   flask db upgrade")
        
        # PostgreSQL-specific statistics
        if dialect == 'postgresql':
            print(f"\n{'='*70}")
            print(f"PostgreSQL Index Statistics")
            print(f"{'='*70}\n")
            
            try:
                result = db.session.execute(text("""
                    SELECT
                        schemaname,
                        tablename,
                        indexname,
                        pg_size_pretty(pg_relation_size(indexrelid)) as size,
                        idx_scan as scans,
                        idx_tup_read as tuples_read,
                        idx_tup_fetch as tuples_fetched
                    FROM pg_stat_user_indexes
                    WHERE schemaname = 'public'
                    AND indexname LIKE 'ix_%'
                    ORDER BY pg_relation_size(indexrelid) DESC
                    LIMIT 20
                """))
                
                print(f"{'Index Name':<45} {'Size':<10} {'Scans':<10} {'Tuples':<10}")
                print(f"{'-'*75}")
                
                for row in result:
                    print(f"{row.indexname:<45} {row.size:<10} {row.scans or 0:<10} {row.tuples_read or 0:<10}")
                
                print(f"\nNote: 'Scans' shows how many times the index was used.")
                print(f"      Low scan count on critical indexes may indicate query issues.")
                
            except Exception as e:
                print(f"⚠️  Could not retrieve statistics: {e}")
        
        print(f"\n{'='*70}\n")
        
        return 0 if all_present else 1


if __name__ == '__main__':
    sys.exit(check_indexes())
