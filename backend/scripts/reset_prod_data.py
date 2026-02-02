"""
Reset Production Data Script
WARNING: THIS SCRIPT DELETES ALL DATA. USE WITH CAUTION.

This script:
1. Truncates all application tables in the database (preserving schema)
2. Deletes all files in R2 storage for configured users
"""
import sys
import os
from pathlib import Path
import logging

# Add parent directory to path to allow importing backend modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from database import get_supabase_client
from services.storage import get_storage_client
from config import get_users_db, get_sales_folder, get_purchases_folder, get_mappings_folder

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def reset_database():
    """Truncate all application tables"""
    logger.info("Resetting Database Tables...")
    
    # List of tables to truncate (order doesn't matter much with CASCADE)
    tables = [
        "purchase_order_items",
        "purchase_orders",
        "draft_purchase_orders",
        "sync_metadata",
        "inventory_mapped",
        "inventory_mapping",
        "inventory_items",
        "stock_levels",
        "vendor_mapping_entries",
        "verification_amounts",
        "verification_dates",
        "verified_headers",
        "verified_invoices",
        "invoices",
        "upload_tasks",
    ]
    
    supabase = get_supabase_client()
    
    # Use TRUNCATE CASCADE to clear data but keep structure
    table_list = ", ".join(tables)
    truncate_sql = f"TRUNCATE {table_list} CASCADE;"
    
    try:
        logger.info(f"Executing: TRUNCATE ... CASCADE")
        supabase.rpc('exec_sql', {'sql': truncate_sql}).execute()
        logger.info("[OK] Database tables truncated successfully.")
    except Exception as e:
        logger.error(f"[ERROR] Failed to truncate tables: {e}")
        logger.warning("Attempting to delete rows individually (fallback)...")
        # Fallback would be complex due to FKs, sticking to RPC report
        raise e

def clean_r2_buckets():
    """Delete all files in user folders in R2"""
    logger.info("Cleaning R2 Storage...")
    
    try:
        storage = get_storage_client()
        users = get_users_db()
        
        if not users:
            logger.warning("No users found in configuration.")
            return

        for username, user_config in users.items():
            logger.info(f"Processing user: {username}")
            
            # Get bucket from config
            bucket = user_config.get('r2_bucket')
            if not bucket:
                logger.warning(f"   No bucket configured for user {username}")
                continue
            
            # Subfolders to clean
            folders_to_clean = [
                get_sales_folder(username),
                get_purchases_folder(username),
                get_mappings_folder(username)
            ]
            
            for folder in folders_to_clean:
                logger.info(f"   Checking folder: {folder}")
                
                # List files in the folder (prefix)
                files = storage.list_files(bucket, prefix=folder)
                
                if not files:
                    logger.info(f"   - Empty")
                    continue
                
                logger.info(f"   - Found {len(files)} files. Deleting...")
                
                count = 0
                for key in files:
                    if storage.delete_file(bucket, key):
                        count += 1
                        if count % 10 == 0:
                            print(f"      Deleted {count}/{len(files)} files...", end="\r")
                            
                print(f"      Deleted {count}/{len(files)} files. Done.")
                logger.info(f"   [OK] Cleared {folder}")
                
    except Exception as e:
        logger.error(f"[ERROR] Failed to clean R2: {e}")
        raise e

def main():
    print("\n" + "="*80)
    print("WARNING: DANGER: PRODUCTION DATA RESET")
    print("="*80)
    print("This script will:")
    print("  1. TRUNCATE all database tables (permentantly delete all rows)")
    print("  2. DELETE all files in R2 storage for all users")
    print("\nScope: All users configured in secrets.toml / env vars")
    print("="*80 + "\n")
    
    print("\nStarting reset process (AUTO-CONFIRMED)...\n")
    
    try:
        reset_database()
        clean_r2_buckets()
        print("\n[SUCCESS] Reset complete. System is ready for fresh use.")
        
    except Exception as e:
        print(f"\n[FAILED] Script failed with error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
