import os
import sys
import logging

# Add backend directory to path
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from database import get_database_client

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def run_migration():
    """Run the 029 migration using exec_sql RPC"""
    db = get_database_client()
    
    migration_file = os.path.join(os.path.dirname(__file__), '..', 'migrations', '029_fix_draft_po_schema.sql')
    
    with open(migration_file, 'r') as f:
        sql_content = f.read()
        
    logger.info("Running migration 029_fix_draft_po_schema.sql...")
    
    try:
        # Split into statements if needed, or run as one block if supported
        # exec_sql usually takes a single string
        response = db.client.rpc('exec_sql', {'sql': sql_content}).execute()
        
        logger.info("Migration completed successfully!")
        logger.info(f"Response: {response.data}")
        
    except Exception as e:
        logger.error(f"Error running migration: {e}")
        # Try to print more details
        if hasattr(e, 'details'):
             logger.error(f"Details: {e.details}")
        if hasattr(e, 'message'):
             logger.error(f"Message: {e.message}")

if __name__ == "__main__":
    run_migration()
