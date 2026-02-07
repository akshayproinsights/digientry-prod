
import os
import sys
from dotenv import load_dotenv
from supabase import create_client

# Load environment variables
load_dotenv(os.path.join("backend", ".env"))

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_KEY")

if not url or not key:
    print("Error: SUPABASE_URL or SUPABASE_KEY not found in .env")
    sys.exit(1)

supabase = create_client(url, key)

def get_table_schema(table_name):
    print(f"\n--- Schema for {table_name} ---")
    # Fetch one record to see keys
    try:
        response = supabase.table(table_name).select("*").limit(1).execute()
        if response.data:
            print(f"Columns: {list(response.data[0].keys())}")
        else:
            print("Table is empty or no data returned.")
    except Exception as e:
        print(f"Error fetching schema: {e}")

get_table_schema("invoices")
get_table_schema("verified_invoices")
