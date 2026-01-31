"""
Initialize Dev Database with Complete Schema
"""
import sys
import os
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from supabase import create_client
import configs

def apply_schema_to_dev():
    print("🚀 Initializing Dev Database...")
    
    # 1. Load Dev Credentials
    secrets = configs.load_secrets()
    supabase_dev = secrets.get('supabase', {})
    url = supabase_dev.get('url')
    key = supabase_dev.get('service_role_key')
    
    if not url or not key:
        print("❌ Dev credentials not found in secrets.toml")
        return

    client = create_client(url, key)
    
    # 2. Read Schema File
    schema_path = Path(__file__).parent.parent / 'migrations' / '000_complete_schema.sql'
    if not schema_path.exists():
        print(f"❌ Schema file not found: {schema_path}")
        return
        
    print(f"📄 Reading schema from: {schema_path.name}")
    with open(schema_path, 'r', encoding='utf-8') as f:
        sql_content = f.read()

    # 3. Clean and Split SQL
    # Simple splitter - splits by semicolon but respects basic constraints
    # For a robust solution, one would use a proper SQL parser, but this suffices for standard migrations
    statements = []
    current_statement = []
    
    for line in sql_content.splitlines():
        line = line.strip()
        if not line or line.startswith('--'):
            continue
        
        current_statement.append(line)
        if line.endswith(';'):
            stmt = ' '.join(current_statement)
            statements.append(stmt)
            current_statement = []

    print(f"📊 Found {len(statements)} SQL statements to execute")
    
    # 4. Execute
    success_count = 0
    fail_count = 0
    
    print("\n⚡ Executing statements on Dev Database...")
    
    # Test connection and RPC first
    try:
        client.rpc('exec_sql', {'query': 'SELECT 1'}).execute()
        print("✅ RPC 'exec_sql' is available. Proceeding with migration.")
    except Exception as e:
        print(f"⚠️  RPC 'exec_sql' check failed: {e}")
        print("   This likely means the 'exec_sql' function is not defined in your database.")
        print("   You typically need to create this function first using the Supabase SQL Editor.")
        print("\n   SQL to create the helper function:")
        print("   ---------------------------------------------------")
        print("   create or replace function exec_sql(query text)")
        print("   returns void language plpgsql security definer")
        print("   as $$ begin execute query; end; $$;")
        print("   ---------------------------------------------------")
        print("\n   Would you like to try executing statements anyway? (Sometimes it's just a permission error)")
        # For automation, we'll try one and fail if it doesn't work.
    
    for i, stmt in enumerate(statements):
        try:
            # print(f"   Executing: {stmt[:50]}...")
            client.rpc('exec_sql', {'query': stmt}).execute()
            print(f"   ✅ [{i+1}/{len(statements)}] Success")
            success_count += 1
        except Exception as e:
            print(f"   ❌ [{i+1}/{len(statements)}] Failed: {e}")
            fail_count += 1
            if "function exec_sql" in str(e):
                print("\n⛔ blocking error: exec_sql function missing.")
                break

    print(f"\nSummary: {success_count} succeeded, {fail_count} failed")

if __name__ == "__main__":
    apply_schema_to_dev()
