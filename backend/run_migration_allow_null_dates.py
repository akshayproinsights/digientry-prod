"""
Run database migration to allow NULL dates in invoice tables.
This prevents data loss when Gemini fails to extract dates from invoices.

Usage:
    python run_migration_allow_null_dates.py
"""
import os
import sys
from pathlib import Path

# Add backend to path
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

from database import get_database_client

def run_migration():
    """Execute the allow_null_dates.sql migration."""
    
    migration_file = backend_dir / "migrations" / "allow_null_dates.sql"
    
    if not migration_file.exists():
        print(f"❌ Migration file not found: {migration_file}")
        return False
    
    # Read migration SQL
    with open(migration_file, 'r', encoding='utf-8') as f:
        sql_content = f.read()
    
    print("=" * 60)
    print("Running Migration: Allow NULL Dates")
    print("=" * 60)
    print("\nThis migration will:")
    print("  1. Allow NULL values in invoices.date column")
    print("  2. Allow NULL values in verification_dates.date column")
    print("  3. Allow NULL values in verified_invoices.date column")
    print("\nThis prevents data loss when dates cannot be extracted from invoices.")
    print("\n" + "=" * 60)
    
    try:
        db = get_database_client()
        
        # Split SQL into individual statements
        statements = [stmt.strip() for stmt in sql_content.split(';') if stmt.strip() and not stmt.strip().startswith('--')]
        
        print(f"\nExecuting {len(statements)} SQL statements...\n")
        
        for i, statement in enumerate(statements, 1):
            # Skip comments
            if statement.startswith('--'):
                continue
                
            print(f"[{i}/{len(statements)}] Executing: {statement[:80]}...")
            
            # Execute using Supabase client's RPC or direct SQL execution
            # Note: Supabase Python client doesn't have direct SQL execution
            # We need to use the PostgREST API or psycopg2
            
            # For now, print the SQL for manual execution
            print(f"    SQL: {statement}\n")
        
        print("\n" + "=" * 60)
        print("⚠️  IMPORTANT: Supabase Python client doesn't support direct SQL execution.")
        print("Please run the migration manually in Supabase SQL Editor:")
        print("\n1. Go to Supabase Dashboard → SQL Editor")
        print(f"2. Copy the contents of: {migration_file}")
        print("3. Execute the SQL")
        print("=" * 60)
        
        return True
        
    except Exception as e:
        print(f"\n❌ Migration failed: {e}")
        return False

if __name__ == "__main__":
    success = run_migration()
    sys.exit(0 if success else 1)
