
import sys
import os
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from supabase import create_client
import configs

def apply_migration(migration_filename):
    print(f"🚀 Applying Migration: {migration_filename}...")
    
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
    migration_path = Path(__file__).parent.parent / 'migrations' / migration_filename
    if not migration_path.exists():
        print(f"❌ Migration file not found: {migration_path}")
        return
        
    print(f"📄 Reading migration from: {migration_filename}")
    with open(migration_path, 'r', encoding='utf-8') as f:
        sql_content = f.read()

    # 3. Clean and Split SQL
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
    
    for i, stmt in enumerate(statements):
        try:
            # print(f"   Executing: {stmt[:50]}...")
            client.rpc('exec_sql', {'query': stmt}).execute()
            print(f"   ✅ [{i+1}/{len(statements)}] Success")
            success_count += 1
        except Exception as e:
            # Check if error is simply "column already exists" - which is fine for IF NOT EXISTS but strictly speaking our SQL should handle it.
            # However, `exec_sql` might wrapper errors.
            print(f"   ❌ [{i+1}/{len(statements)}] Failed: {e}")
            fail_count += 1

    print(f"\nSummary: {success_count} succeeded, {fail_count} failed")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python apply_migration.py <migration_filename>")
        sys.exit(1)
    
    apply_migration(sys.argv[1])
