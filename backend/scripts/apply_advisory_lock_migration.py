"""
Script to apply the advisory lock migration to Supabase.
Run this to enable the pg_advisory_lock RPC functions.
"""
import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import get_database_client
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def apply_migration():
    """Apply the advisory lock migration"""
    
    # Read migration SQL
    migration_path = os.path.join(
        os.path.dirname(os.path.dirname(__file__)),
        'migrations',
        'add_advisory_lock_functions.sql'
    )
    
    with open(migration_path, 'r') as f:
        migration_sql = f.read()
    
    logger.info("Applying advisory lock migration...")
    logger.info(f"Migration file: {migration_path}")
    
    try:
        db = get_database_client()
        
        # Execute the migration using Supabase SQL RPC
        # Note: We might need to use psycopg2 directly if Supabase client doesn't support raw SQL
        result = db.client.rpc('exec_sql', {'query': migration_sql}).execute()
        
        logger.info("✅ Migration applied successfully!")
        return True
        
    except Exception as e:
        logger.error(f"❌ Migration failed: {e}")
        logger.info("\n" + "="*80)
        logger.info("MANUAL MIGRATION REQUIRED")
        logger.info("="*80)
        logger.info("\nPlease run this SQL in your Supabase SQL Editor:")
        logger.info("\n" + migration_sql)
        logger.info("\n" + "="*80)
        return False


if __name__ == "__main__":
    success = apply_migration()
    
    if success:
        logger.info("\nYou can now test the advisory locks by running:")
        logger.info("  python backend/scripts/test_advisory_locks.py")
    else:
        logger.info("\nAfter manually applying the migration, test with:")
        logger.info("  python backend/scripts/test_advisory_locks.py")
    
    sys.exit(0 if success else 1)
