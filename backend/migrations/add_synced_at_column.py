"""
Migration to add synced_at column to inventory_mapped table.
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import get_database_client

def run_migration():
    """Add synced_at column to inventory_mapped table."""
    db = get_database_client()
    
    # Use raw SQL through Supabase RPC or direct query
    # Since Supabase doesn't support ALTER TABLE directly, 
    # we need to run this in Supabase Dashboard SQL Editor:
    
    migration_sql = """
    -- Add synced_at column to inventory_mapped table
    ALTER TABLE inventory_mapped 
    ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ DEFAULT NULL;
    """
    
    print("=" * 60)
    print("MIGRATION: Add synced_at column to inventory_mapped")
    print("=" * 60)
    print()
    print("Please run this SQL in Supabase Dashboard SQL Editor:")
    print()
    print(migration_sql)
    print()
    print("=" * 60)
    
    return migration_sql

if __name__ == "__main__":
    run_migration()
