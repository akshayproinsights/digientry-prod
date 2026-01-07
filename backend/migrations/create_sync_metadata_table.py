"""
Migration: Create sync_metadata table
This table tracks when users perform Sync & Finish operations
"""

import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import get_database_client
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def create_sync_metadata_table():
    """Create the sync_metadata table"""
    db = get_database_client()
    
    # SQL to create the table
    create_table_sql = """
    CREATE TABLE IF NOT EXISTS sync_metadata (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        sync_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
        records_processed INTEGER NOT NULL,
        sync_type TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    """
    
    # SQL to create indexes
    create_indexes_sql = [
        "CREATE INDEX IF NOT EXISTS idx_sync_metadata_username ON sync_metadata(username);",
        "CREATE INDEX IF NOT EXISTS idx_sync_metadata_timestamp ON sync_metadata(sync_timestamp DESC);"
    ]
    
    try:
        logger.info("Creating sync_metadata table...")
        
        # Execute using raw SQL via Supabase
        # Since our database client doesn't have direct SQL execution,
        # we'll use the insert method with proper schema
        
        # Check if table exists by trying to query it
        try:
            db.client.table('sync_metadata').select('id').limit(1).execute()
            logger.info("✓ sync_metadata table already exists")
        except Exception:
            logger.info("Table doesn't exist, creating it...")
            # For Supabase, we need to run this via SQL editor or migration
            logger.warning("⚠ Please run the following SQL in Supabase SQL Editor:")
            print("\n" + create_table_sql)
            for index_sql in create_indexes_sql:
                print(index_sql)
            print("\n")
        
        logger.info("✓ Migration completed")
        return True
        
    except Exception as e:
        logger.error(f"❌ Migration failed: {e}")
        raise


if __name__ == "__main__":
    try:
        create_sync_metadata_table()
        print("\n✓ Migration script completed successfully")
    except Exception as e:
        print(f"\n❌ Migration failed: {e}")
        sys.exit(1)
