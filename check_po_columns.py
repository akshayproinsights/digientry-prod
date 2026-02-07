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
    try:
        # Check for expected missing columns
        columns_to_check = "notes,total_items,total_estimated_cost,updated_at,pdf_file_path,po_date"
        response = supabase.table(table_name).select(columns_to_check).limit(1).execute()
        print("Select new columns success!")
        if response.data:
            print(f"Data: {response.data}")
        else:
            print("Table empty, but select query for new columns succeeded (no error raised).")
            
    except Exception as e:
        print(f"Error fetching schema: {e}")

if __name__ == "__main__":
    get_table_schema("purchase_orders")
