
import sys
import os

# Add parent directory to path to import modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import get_database_client
import json


def debug_stock_item(part_number):
    print(f"--- Debugging Stock Item: {part_number} ---")
    db = get_database_client()

    # Inspect table columns
    try:
        print("Inspecting table columns...")
        # Since we can't easily query information_schema with supabase-py client (it restricts), 
        # we can try to select one row and see keys?
        # Or try a raw RPC call if available.
        # Let's try selecting one row from inventory_items
        res = db.client.table("inventory_items").select("*").limit(1).execute()
        if res.data:
            print(f"inventory_items columns: {list(res.data[0].keys())}")
        else:
            print("inventory_items is empty, cannot deduce columns.")
            
        res = db.client.table("stock_levels").select("*").limit(1).execute()
        if res.data:
            print(f"stock_levels columns: {list(res.data[0].keys())}")
        else:
             print("stock_levels is empty.")
             
    except Exception as e:
        print(f"Error inspecting columns: {e}")
    
    try:
        # 1. Search in stock_levels GLOBALLY
        print("Checking stock_levels globally...")
        res = db.client.table("stock_levels").select("*").eq("part_number", part_number).execute()
        
        username = None # Initialize username here

        if res.data:
            print(f"Found {len(res.data)} records in stock_levels:")
            for item in res.data:
                print(f"User: {item.get('username')}, Part: {item.get('part_number')}, Stock: {item.get('current_stock')}")
                # Use the first found username for further checks
                if not username:
                    username = item.get("username")
        else:
            print("No records found in stock_levels globally.")

        # Check inventory items GLOBALLY
        print(f"Checking inventory_items globally for {part_number}...")
        inv_res = db.client.table("inventory_items").select("*").eq("part_number", part_number).execute()
        if inv_res.data:
             print(f"Found {len(inv_res.data)} inventory items globally:")
             for item in inv_res.data:
                 print(f"User: {item.get('username')}, Desc: {item.get('description')}, Qty: {item.get('qty')}")
                 if not username:
                     username = item.get("username")
        else:
             print("No inventory items found globally.")

        if not username:
             print("Could not determine username. Defaulting to 'adnak'.")
             username = "adnak"

        print(f"--- Debugging for user: {username} ---")

        # 2. Check stock_by_part logic simulation (Miniature version)
        
        # IN
        vendor_items = db.client.table("inventory_items").select("*").eq("username", username).eq("part_number", part_number).execute()
        total_in = 0
        for item in (vendor_items.data or []):
             qty = float(item.get("qty", 0) or 0)
             total_in += qty
             print(f"IN: {item.get('description')} - Qty: {qty}")
        print(f"Total IN (Exact match): {total_in}")

        # OUT (This is harder because of fuzzy matching, but let's try mapping)
        mappings = db.client.table("vendor_mapping_entries").select("*").eq("username", username).eq("part_number", part_number).execute()
        print(f"Mappings found: {len(mappings.data)}")
        
        if mappings.data:
            customer_item = mappings.data[0].get("customer_item_name")
            print(f"Mapped Customer Item: {customer_item}")
            
            if customer_item:
                # Search sales
                sales = db.client.table("verified_invoices").select("*").eq("username", username).eq("type", "Part").execute()
                total_out = 0
                from rapidfuzz import fuzz
                
                for sale in (sales.data or []):
                    desc = sale.get("description", "")
                    if fuzz.ratio(desc.lower(), customer_item.lower()) >= 90:
                        qty = float(sale.get("quantity", 0) or 0)
                        total_out += qty
                        print(f"OUT: {desc} - Qty: {qty} (Match: {fuzz.ratio(desc.lower(), customer_item.lower())}%)")
                
                print(f"Total OUT (Calculated): {total_out}")

    except Exception as e:
        print(f"Error: {e}")

    # Fallback: Check for 'adnak' user specifically if no stock found
    if not res.data:
        print("\n--- Fallback: Checking for user 'adnak' ---")
        username = "adnak"
        
        # Check stock levels for adnak
        print(f"Checking stock_levels for {username} and part {part_number}...")
        res_adnak = db.client.table("stock_levels").select("*").eq("username", username).eq("part_number", part_number).execute()
        
        if res_adnak.data:
            print("Found in stock_levels for adnak!")
            print(json.dumps(res_adnak.data[0], indent=2))
        else:
            print("Not found in stock_levels for adnak.")
            
            # Check inventory items
            print(f"Checking inventory_items for {username}...")
            inv_res = db.client.table("inventory_items").select("*").eq("username", username).eq("part_number", part_number).execute()
            if inv_res.data:
                print(f"Found {len(inv_res.data)} inventory items:")
                total_in = 0
                for item in inv_res.data:
                    qty = float(item.get("qty", 0) or 0)
                    total_in += qty
                    print(f"- {item.get('description')} (Qty: {qty}, Date: {item.get('invoice_date')})")
                print(f"Total IN from inventory_items: {total_in}")
            else:
                print("No inventory items found for adnak either.")
                
            # Try adnak-local
            print("\n--- Fallback: Checking for user 'adnak-local' ---")
            username = "adnak-local"
            res_local = db.client.table("stock_levels").select("*").eq("username", username).eq("part_number", part_number).execute()
            if res_local.data:
                print("Found in stock_levels for adnak-local!")
                print(json.dumps(res_local.data[0], indent=2))
            else:
                 print("Not found in stock_levels for adnak-local.")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        part = sys.argv[1]
    else:
        part = "57611M82P10"
    debug_stock_item(part)
