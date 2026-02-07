"""
Script to fix inventory items table constraints.
Removes the unique constraint on (username, part_number) which prevents
multiple purchases of the same item.
Also ensures no unique constraint on invoice_number exists.
"""
import sys
import os
from pathlib import Path

# Add parent directory to path to import database module
sys.path.insert(0, str(Path(__file__).parent.parent))

from database import get_supabase_client

def fix_constraints():
    print("Fixing inventory_items constraints...")
    
    supabase = get_supabase_client()
    
    sqls = [
        # Drop the specific constraint causing the error
        "ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_username_part_number_key;",
        
        # Also drop invoice number unique constraint if it exists (for multi-page invoices)
        "ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_username_invoice_number_key;",
        
        # Ensure only the primary key remains unique (id)
        # We don't need to add anything, removing the bad ones is enough.
    ]
    
    for sql in sqls:
        try:
            print(f"Executing: {sql}")
            supabase.rpc('exec_sql', {'sql': sql}).execute()
            print("✅ Success")
        except Exception as e:
            print(f"❌ Error: {e}")

if __name__ == "__main__":
    fix_constraints()
