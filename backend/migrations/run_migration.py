"""
Auto-apply database migrations to Supabase
Run this script to automatically execute migration SQL files
"""
import os
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from services.database import get_database_client

def run_migration(migration_file: str):
    """Execute a SQL migration file against Supabase"""
    
    # Read the migration file
    migration_path = Path(__file__).parent / migration_file
    
    if not migration_path.exists():
        print(f"❌ Migration file not found: {migration_path}")
        return False
    
    print(f"📄 Reading migration: {migration_file}")
    with open(migration_path, 'r', encoding='utf-8') as f:
        sql_content = f.read()
    
    # Split by semicolons to get individual statements
    # Filter out comments and empty statements
    statements = []
    for statement in sql_content.split(';'):
        statement = statement.strip()
        # Skip empty lines and comment-only lines
        if statement and not statement.startswith('--'):
            statements.append(statement)
    
    print(f"📊 Found {len(statements)} SQL statements to execute\n")
    
    # Get database client
    db = get_database_client()
    
    success_count = 0
    fail_count = 0
    
    # Execute each statement
    for idx, statement in enumerate(statements, 1):
        # Extract table name for logging
        if 'ALTER TABLE' in statement:
            table_name = statement.split('ALTER TABLE')[1].split()[0].strip()
            print(f"[{idx}/{len(statements)}] Altering table: {table_name}")
        elif 'SELECT' in statement:
            print(f"[{idx}/{len(statements)}] Running verification query")
        else:
            print(f"[{idx}/{len(statements)}] Executing statement")
        
        try:
            # Execute via Supabase RPC or direct SQL
            # Note: Supabase PostgREST doesn't support direct SQL execution
            # We need to use the PostgreSQL connection
            result = db.rpc('exec_sql', {'query': statement}).execute()
            print(f"   ✅ Success")
            success_count += 1
        except Exception as e:
            error_msg = str(e)
            if 'function exec_sql' in error_msg.lower():
                print(f"   ⚠️  Note: Direct SQL execution requires a custom RPC function")
                print(f"   ℹ️  Please run this migration manually in Supabase SQL Editor:")
                print(f"   🔗 https://supabase.com/dashboard/project/hhgtmkkranfvhkcjcclp/sql/new")
                return False
            else:
                print(f"   ❌ Error: {error_msg}")
                fail_count += 1
    
    print(f"\n{'='*60}")
    print(f"Migration complete!")
    print(f"✅ Successful: {success_count}")
    print(f"❌ Failed: {fail_count}")
    print(f"{'='*60}\n")
    
    return fail_count == 0


if __name__ == "__main__":
    print("="*60)
    print("🚀 Supabase Migration Runner")
    print("="*60)
    print()
    
    # Run the migration
    migration_file = "004_verification_table_cleanup.sql"
    
    print(f"⚠️  IMPORTANT: Supabase PostgREST doesn't support direct SQL execution.")
    print(f"This script will attempt to run the migration, but you may need to:")
    print(f"1. Run the SQL manually in Supabase SQL Editor, OR")
    print(f"2. Use a direct PostgreSQL connection with psycopg2\n")
    
    success = run_migration(migration_file)
    
    if not success:
        print("\n💡 Alternative: Use psycopg2 for direct PostgreSQL connection")
        print("   Install: pip install psycopg2-binary")
        print("   Then use the database connection string from Supabase settings")
        sys.exit(1)
    else:
        print("\n🎉 Migration completed successfully!")
        print("   Restart your backend server to clear the schema cache.")
        sys.exit(0)
