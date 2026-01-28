
import sys
import os

# Ensure backend directory is in path
sys.path.append(os.getcwd())

from database import get_database_client
from configs import load_secrets

print("--- Testing Config Loading ---")
secrets = load_secrets()
print(f"Secrets loaded: {bool(secrets)}")
if secrets:
    print(f"Supabase keys present: {'supabase' in secrets}")
    if 'supabase' in secrets:
        print(f"URL present: {'url' in secrets['supabase']}")
else:
    print("FATAL: No secrets loaded.")

print("\n--- Testing Database Connection ---")
try:
    db = get_database_client()
    print("Database client initialized.")
    
    # Try a simple query
    print("Attempting to query 'users' table (or just check health)...")
    # We'll just try to list tables or select from a known table 'users' or 'upload_tasks'
    # Since we can't easily list tables with this client, let's try to query 'upload_tasks' which we created
    try:
        res = db.table("upload_tasks").select("task_id").limit(1).execute()
        print("Query successful!")
        print(f"Data: {res.data}")
    except Exception as e:
        print(f"Query failed: {e}")
        
except Exception as e:
    print(f"Connection failed: {e}")
