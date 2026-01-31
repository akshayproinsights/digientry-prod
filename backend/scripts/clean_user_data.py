"""
Script to clean up R2 bucket and database records for a specific user.
Usage: python backend/scripts/clean_user_data.py --username adnak
"""
import os
import sys
import argparse
import asyncio
import logging
from typing import List

# Add backend directory to path to import modules
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from config_loader import get_user_config
from services.storage import get_storage_client
from database import get_database_client

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def delete_r2_files(bucket_name: str):
    """Delete all files in the specified R2 bucket."""
    logger.info(f"Starting R2 cleanup for bucket: {bucket_name}")
    storage = get_storage_client()
    
    # List all files
    files = storage.list_files(bucket_name)
    logger.info(f"Found {len(files)} files in R2 bucket.")
    
    if not files:
        logger.info("Bucket is already empty.")
        return

    # Delete files
    deleted_count = 0
    failed_count = 0
    
    for file_key in files:
        try:
            success = storage.delete_file(bucket_name, file_key)
            if success:
                deleted_count += 1
                if deleted_count % 10 == 0:
                    logger.info(f"Deleted {deleted_count} files...")
            else:
                failed_count += 1
                logger.error(f"Failed to delete {file_key}")
        except Exception as e:
            failed_count += 1
            logger.error(f"Exception deleting {file_key}: {e}")
            
    logger.info(f"R2 Cleanup Completed. Deleted: {deleted_count}, Failed: {failed_count}")

def delete_db_records(username: str):
    """Delete database records for the specified user."""
    logger.info(f"Starting Database cleanup for user: {username}")
    db = get_database_client()
    
    tables_to_clean = [
        'upload_tasks',
        'invoices',
        'verified_invoices',
        'verification_dates',
        'verification_amounts',
        'recalculation_tasks'
    ]
    
    total_deleted = 0
    
    for table in tables_to_clean:
        try:
            logger.info(f"Cleaning table: {table}...")
            # Note: Supabase delete returns the deleted rows
            response = db.delete(table, {'username': username})
            
            # The python client returns the data directly or in .data depending on version/wrapper
            # Assuming standard behavior where it returns the list of deleted items
            deleted_count = 0
            if isinstance(response, list):
                deleted_count = len(response)
            elif hasattr(response, 'data') and isinstance(response.data, list):
                deleted_count = len(response.data)
            
            # Sometimes delete might return a count directly if using specific wrapper?
            # Based on previous code analysis (delete_invoice_by_hash), it returns result list
            
            logger.info(f"Deleted rows from {table}: {deleted_count} (approx)")
            total_deleted += deleted_count
            
        except Exception as e:
            logger.error(f"Error cleaning table {table}: {e}")
            
    logger.info(f"Database Cleanup Completed. Total operations successful.")

def main():
    parser = argparse.ArgumentParser(description="Clean up user data from R2 and Database")
    parser.add_argument("--username", required=True, help="Username to clean up (e.g., adnak)")
    
    args = parser.parse_args()
    username = args.username
    
    # 1. Get user config to find R2 bucket
    logger.info(f"Loading config for user: {username}")
    user_config = get_user_config(username)
    
    if not user_config:
        logger.error(f"User config not found for {username}")
        return
        
    r2_bucket = user_config.get("r2_bucket")
    if not r2_bucket:
        logger.error("R2 bucket not found in user config")
        return
        
    logger.info(f"Target R2 Bucket: {r2_bucket}")
    
    # Confirm
    print(f"\n WARNING: This will DELETE ALL DATA for user '{username}' in bucket '{r2_bucket}'.")
    print("Tables to be cleaned: upload_tasks, invoices, verified_invoices, verification_dates, verification_amounts, recalculation_tasks")
    print("Use Control+C to cancel if running interactively. Waiting 5 seconds...")
    import time
    time.sleep(5)
    
    # 2. Clean R2
    delete_r2_files(r2_bucket)
    
    # 3. Clean DB
    delete_db_records(username)
    
    logger.info("All cleanup tasks finished.")

if __name__ == "__main__":
    main()
