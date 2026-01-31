
import os
import sys
from database import get_database_client
from dotenv import load_dotenv

load_dotenv()

def list_columns():
    try:
        db = get_database_client()
        # Create a dummy query to inspect schema or use a direct SQL if possible via rpc or just check what we can select
        # PostgREST doesn't easily show schema, but we can try selecting one row and looking at keys
        response = db.client.table("inventory_items").select("*").limit(1).execute()
        
        if response.data:
            print("Columns found in inventory_items:")
            for key in response.data[0].keys():
                print(f"- {key}")
        else:
            print("Table empty, cannot infer columns from data. Trying to select 'rate' specifically...")
            try:
                db.client.table("inventory_items").select("rate").limit(1).execute()
                print("Column 'rate' EXISTS.")
            except Exception as e:
                print(f"Column 'rate' MISSING or Error: {e}")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    list_columns()
