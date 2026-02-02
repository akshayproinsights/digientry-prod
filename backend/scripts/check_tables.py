
import sys
import os
from pathlib import Path
import logging

sys.path.insert(0, str(Path(__file__).parent.parent))

from database import get_supabase_client

def list_tables():
    supabase = get_supabase_client()
    try:
        # Query information_schema to find existing tables
        # Note: We can't select from information_schema via standard client.table() usually, 
        # but we can use rpc if available, or just try to select from expected tables.
        
        # Better approach: Try to infer from a direct SQL query via RPC if allowed
        
        sql = """
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE';
        """
        
        response = supabase.rpc('exec_sql', {'sql': sql}).execute()
        
        print("Existing tables in 'public' schema:")
        print("-----------------------------------")
        if response.data:
            # The response data from exec_sql might differ depending on how the RPC is implemented.
            # Usually it returns the result of the query.
            # Let's inspect the structure.
            for row in response.data:
                print(row.get('table_name'))
        else:
            print("No tables found or empty response.")
            
    except Exception as e:
        print(f"Error checking tables: {e}")

if __name__ == "__main__":
    list_tables()
