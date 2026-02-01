
import sys
import os
from dotenv import load_dotenv

# Add parent directory to path to import modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Load env variables from backend/.env
env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
print(f"Loading .env from: {env_path}")
load_dotenv(env_path)

from database import get_database_client
import json
from rapidfuzz import fuzz

def normalize_part_number(part_number: str) -> str:
    """Normalize part number for matching (remove spaces, lowercase)"""
    if not part_number:
        return ""
    return part_number.strip().replace(" ", "").replace("-", "").lower()

def fuzzy_match_part_numbers(part1: str, part2: str, threshold: float = 99.0) -> bool:
    norm1 = normalize_part_number(part1)
    norm2 = normalize_part_number(part2)
    if norm1 == norm2:
        return True
    similarity = fuzz.ratio(norm1, norm2)
    return similarity >= threshold

def debug_stock_item(part_number):
    print(f"--- Debugging Stock Item: {part_number} ---")
    

    # Check if SUPABASE_URL is set
    print(f"SUPABASE_URL: {os.environ.get('SUPABASE_URL')}")
    print(f"SUPABASE_SERVICE_ROLE_KEY: {'[SET]' if os.environ.get('SUPABASE_SERVICE_ROLE_KEY') else '[NOT SET]'}")

    db = get_database_client()
    

    # Check if SUPABASE_URL is set
    print(f"SUPABASE_URL: {os.environ.get('SUPABASE_URL')}")
    print(f"SUPABASE_SERVICE_ROLE_KEY: {'[SET]' if os.environ.get('SUPABASE_SERVICE_ROLE_KEY') else '[NOT SET]'}")

    db = get_database_client()

    print(f"\n========== GLOBAL SEARCH FOR PART: {part_number} ==========")
    
    try:
        # 1. Search Inventory Items GLOBALLY
        print("Checking inventory_items (Global)...")
        inventory = db.client.table("inventory_items").select("*").eq("part_number", part_number).execute()
        
        if inventory.data:
            print(f"✅ FOUND {len(inventory.data)} records in inventory_items:")
            users_found = set()
            for item in inventory.data:
                users_found.add(item.get("username"))
                print(f"  User: {item.get('username')}, Qty: {item.get('qty')}, Excluded: {item.get('excluded_from_stock')}")
            
            print(f"Users found with this part: {users_found}")
        else:
            print("❌ No records found in inventory_items globally.")

        # 2. Search Stock Levels GLOBALLY
        print("\nChecking stock_levels (Global)...")
        stock = db.client.table("stock_levels").select("*").eq("part_number", part_number).execute()
        
        if stock.data:
             print(f"✅ FOUND {len(stock.data)} records in stock_levels:")
             for item in stock.data:
                 print(f"  User: {item.get('username')}, Stock: {item.get('current_stock')}, Manual: {item.get('manual_adjustment')}")
        else:
             print("❌ No records found in stock_levels globally.")

        # 3. Search Mappings GLOBALLY
        print("\nChecking vendor_mapping_entries (Global)...")
        mappings = db.client.table("vendor_mapping_entries").select("*").eq("part_number", part_number).execute()
        
        if mappings.data:
             print(f"✅ FOUND {len(mappings.data)} records in mappings:")
             for item in mappings.data:
                 print(f"  User: {item.get('username')}, CustomerItem: {item.get('customer_item_name')}")
        else:
             print("❌ No records found in mappings globally.")

    except Exception as e:
        print(f"Error checking global: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        part = sys.argv[1]
    else:
        part = "57611M82P10"
    debug_stock_item(part)
