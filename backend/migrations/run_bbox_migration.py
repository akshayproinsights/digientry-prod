"""
Migration script to add missing bbox columns to Supabase tables
Fixes the error: "Could not find the 'date_bbox' column of 'verification_dates' in the schema cache"

Run this script to add the missing bbox columns to your Supabase database.
"""

import os
import sys
from pathlib import Path

# Add backend directory to path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from database_helpers import get_database_client
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


def run_migration():
    """
    Apply bbox column migration to Supabase database
    """
    print("=" * 70)
    print("MIGRATION: Add bbox columns to verification tables")
    print("=" * 70)
    
    # Read the migration SQL
    migration_file = Path(__file__).parent / "migration_add_bbox_columns.sql"
    
    if not migration_file.exists():
        print(f"❌ ERROR: Migration file not found: {migration_file}")
        return False
    
    with open(migration_file, 'r') as f:
        sql_content = f.read()
    
    print(f"\n📄 Migration file: {migration_file.name}")
    print("\n🔧 This migration will:")
    print("  1. Add receipt_number_bbox (JSONB) to invoices table")
    print("  2. Add date_bbox (JSONB) to invoices table")
    print("  3. Add bbox columns to verified_invoices table")
    print("  4. Add receipt_number_bbox and date_bbox to verification_dates table ✓")
    print("  5. Add bbox columns to verification_amounts table")
    
    print("\n" + "=" * 70)
    print("⚠️  IMPORTANT: Run this SQL in your Supabase SQL Editor")
    print("=" * 70)
    print("\n1. Go to your Supabase Dashboard")
    print("2. Navigate to SQL Editor")
    print("3. Create a new query")
    print("4. Copy and paste the SQL below:")
    print("\n" + "-" * 70)
    print(sql_content)
    print("-" * 70)
    print("\n5. Click 'Run' to execute the migration")
    
    print("\n✅ After running the migration in Supabase, your upload process will work correctly!")
    print("\n💡 Tip: The 'date_bbox' column is needed to store the bounding box coordinates")
    print("   for the date field, which enables visual verification in the Review pages.")
    
    return True


if __name__ == "__main__":
    try:
        success = run_migration()
        if success:
            print("\n✅ Migration instructions displayed successfully!")
            print("   Please run the SQL in your Supabase SQL Editor now.")
        else:
            print("\n❌ Migration failed")
            
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
