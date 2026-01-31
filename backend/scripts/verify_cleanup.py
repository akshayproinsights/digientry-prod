"""
Verify cleanup for user.
Usage: python backend/scripts/verify_cleanup.py --username adnak
"""
import os
import sys
import argparse
import logging

# Add backend directory to path
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from config_loader import get_user_config
from services.storage import get_storage_client
from database import get_database_client

logging.basicConfig(level=logging.INFO, format='%(message)s')
logger = logging.getLogger(__name__)

def verify(username):
    print(f"Verifying cleanup for {username}...")
    
    # 1. Check R2
    user_config = get_user_config(username)
    bucket = user_config.get("r2_bucket")
    storage = get_storage_client()
    files = storage.list_files(bucket)
    print(f"R2 Files in {bucket}: {len(files)}")
    if len(files) > 0:
        print(f"WARNING: {len(files)} files still exist!")
        for f in files[:5]:
            print(f" - {f}")

    # 2. Check DB
    db = get_database_client()
    tables = ['upload_tasks', 'invoices', 'verified_invoices', 'verification_dates', 'verification_amounts', 'recalculation_tasks']
    
    for table in tables:
        try:
            # Query count
            res = db.query(table).eq('username', username).execute()
            count = len(res.data) if res.data else 0
            print(f"DB Table {table}: {count} rows")
            if count > 0:
                print(f"WARNING: {table} is not empty!")
        except Exception as e:
            print(f"Error checking {table}: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", required=True)
    args = parser.parse_args()
    verify(args.username)
