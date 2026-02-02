"""
Database Migration Runner (Manual)
Run this to apply a specific schema migration file to your Supabase database
"""
import sys
import os
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

from database import get_supabase_client

def run_specific_migration(file_name: str):
    """Run a specific SQL migration file"""
    print(f"\n{'='*80}")
    print(f"Running migration: {file_name}")
    print(f"{'='*80}\n")
    
    # Read migration file
    migration_path = Path(__file__).parent / "migrations" / file_name
    if not migration_path.exists():
        print(f"Migration file not found: {migration_path}")
        return False
    
    with open(migration_path, 'r', encoding='utf-8') as f:
        sql = f.read()
    
    # Get Supabase client
    supabase = get_supabase_client()
    
    try:
        # Try running as a single block first (best for DO $$ blocks)
        print(f"Executing SQL block...", end=" ")
        # Supabase Python client doesn't support exec_sql directly unless RPC is set up
        # BUT many setups use a helper function.
        # Let's try to query the REST API directly via a special RPC if enabled, 
        # or fallback to splitting if supported.
        # Note: 'exec_sql' rpc must exist in DB. If not, this fails.
        
        result = supabase.rpc('exec_sql', {'sql': sql}).execute()
        print("Success")
        return True
    except Exception as e:
        print(f"RPC 'exec_sql' failed: {e}")
        print("   (This is normal if the helper function isn't installed in DB)")
        print("\n   Trying alternative: Splitting statements...")
    
    # Fallback: Split into statements (naive split on ;)
    statements = []
    current_statement = []
    
    for line in sql.split('\n'):
        if line.strip().startswith('--'): continue
        current_statement.append(line)
        if line.strip().endswith(';'):
            stmt = '\n'.join(current_statement).strip()
            if stmt: statements.append(stmt)
            current_statement = []
            
    success_count = 0
    for i, stmt in enumerate(statements, 1):
        try:
            print(f"   Running stmt {i}...", end=" ")
            # If exec_sql failed, we might not have a way to run DDL via client 
            # effectively without direct connection strings or enable pgTAP.
            # However, sometimes simpler queries work.
            result = supabase.rpc('exec_sql', {'sql': stmt}).execute()
            print("Success")
            success_count += 1
        except Exception as e:
            if "already exists" in str(e).lower():
                print("Exists")
                success_count += 1
            else:
                print(f"Error: {e}")
                
    return success_count > 0

if __name__ == "__main__":
    # Check for command line argument
    if len(sys.argv) > 1:
        target_migration = sys.argv[1]
    else:
        # Default fallback
        target_migration = "fix_schema_mismatches_v2.sql"
        print(f"No file specified, defaulting to: {target_migration}")
        print("   Usage: python run_specific_migration.py <filename.sql>")
    
    if run_specific_migration(target_migration):
        print("\nMigration applied.")
    else:
        print("\nMigration failed.")
        sys.exit(1)
