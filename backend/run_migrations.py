"""
Database Migration Runner
Run this to apply schema migrations to your Supabase database
"""
import sys
import os
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from database import get_supabase_client

def run_migration(migration_file: str):
    """Run a SQL migration file"""
    print(f"\n{'='*80}")
    print(f"Running migration: {migration_file}")
    print(f"{'='*80}\n")
    
    # Read migration file
    migration_path = Path(__file__).parent / "migrations" / migration_file
    if not migration_path.exists():
        print(f"❌ Migration file not found: {migration_path}")
        return False
    
    with open(migration_path, 'r', encoding='utf-8') as f:
        sql = f.read()
    
    # Remove comments and split into statements
    statements = []
    current_statement = []
    
    for line in sql.split('\n'):
        # Skip comment-only lines
        if line.strip().startswith('--'):
            continue
        
        current_statement.append(line)
        
        # If line ends with semicolon, it's end of statement
        if line.strip().endswith(';'):
            statement = '\n'.join(current_statement).strip()
            if statement and not statement.startswith('--'):
                statements.append(statement)
            current_statement = []
    
    # Get Supabase client
    supabase = get_supabase_client()
    
    # Execute each statement
    success_count = 0
    error_count = 0
    
    for i, statement in enumerate(statements, 1):
        # Skip SELECT statements (diagnostic queries)
        if statement.upper().startswith('SELECT'):
            print(f"⏭️  Skipping SELECT statement {i}/{len(statements)}")
            continue
        
        try:
            print(f"▶️  Executing statement {i}/{len(statements)}...", end=" ")
            result = supabase.rpc('exec_sql', {'sql': statement}).execute()
            print("✅ Success")
            success_count += 1
        except Exception as e:
            error_msg = str(e)
            # Ignore "already exists" errors
            if 'already exists' in error_msg.lower() or 'duplicate' in error_msg.lower():
                print("⏭️  Already exists (OK)")
                success_count += 1
            else:
                print(f"[ERROR] Error: {error_msg}")
                error_count += 1
    
    print(f"\n{'='*80}")
    print(f"Migration complete: {success_count} success, {error_count} errors")
    print(f"{'='*80}\n")
    
    return error_count == 0

def main():
    """Run all pending migrations"""
    print("\n" + "="*80)
    print("DATABASE MIGRATION RUNNER")
    print("="*80)
    
    # Migration to run
    migration_file = "006_fix_schema_mismatches.sql"
    
    # Run migration
    success = run_migration(migration_file)
    
    if success:
        print("\n✅ All migrations completed successfully!")
        print("\n🔄 Next steps:")
        print("   1. Restart your backend server")
        print("   2. Upload test invoices")
        print("   3. Verify data saves to database\n")
        return 0
    else:
        print("\n⚠️  Some migrations had errors")
        print("   You may need to run them manually in Supabase SQL Editor")
        print("   URL: https://supabase.com/dashboard/project/hhgtmkkranfvhkcjcclp/sql\n")
        return 1

if __name__ == "__main__":
    sys.exit(main())
