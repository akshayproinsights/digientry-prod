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
        # We can't easily see columns if table is empty with just select, 
        # but let's try to insert a dummy record to see if it fails or use RPC if available
        # However, listing empty result is fine if we trust the previous RPC output.
        # Better: query information schema via our exec_sql if we could, 
        # but for now let's just inspect what we can. 
        # Actually, if I insert a dummy row that uses the new columns, I can verify they exist.
        
        # Or I can try to select specific new columns
        response = supabase.table(table_name).select("current_stock,item_name,reorder_point,reorder_qty").limit(1).execute()
        print("Select new columns success!")
        if response.data:
            print(f"Data: {response.data}")
        else:
            print("Table empty, but select query for new columns succeeded (no error raised).")
            
    except Exception as e:
        print(f"Error fetching schema: {e}")

if __name__ == "__main__":
    get_table_schema("draft_purchase_orders")
