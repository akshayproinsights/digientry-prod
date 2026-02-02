import os
import sys
from database import get_supabase_client

def check_structure():
    print("Checking database structure...")
    db = get_supabase_client()
    
    # db is the raw Client object from get_supabase_client()
    columns_to_check = ["vendor_description"]
    
    for col in columns_to_check:
        try:
            # 1. Try to select the specific column (this tests if PostgREST knows about it)
            print(f"Attempting to select '{col}' column via PostgREST...")
            response = db.table('stock_levels').select(col).limit(1).execute()
            print(f"SUCCESS: PostgREST API successfully queried '{col}'.")
            
        except Exception as e:
            print(f"FAILURE: PostgREST could NOT query '{col}'. Error: {e}")
            
        try:
            # 2. Try to query information_schema via RPC to see if it PHYSICALY exists
            print(f"Checking physical existence of '{col}' in information_schema...")
            response = db.rpc('exec_sql', {
                'sql': f"SELECT column_name FROM information_schema.columns WHERE table_name = 'stock_levels' AND column_name = '{col}';"
            }).execute()
            if response.data:
                print(f"PHYSICAL SUCCESS: '{col}' found in information_schema.")
            else:
                 print(f"PHYSICAL FAILURE: '{col}' NOT found in information_schema.")
            
        except Exception as e:
            print(f"Error executing RPC check for '{col}': {e}")

if __name__ == "__main__":
    check_structure()
