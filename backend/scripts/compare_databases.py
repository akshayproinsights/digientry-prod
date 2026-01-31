"""
Simple Database Schema Comparison Tool
Compares tables and columns between Dev and Prod Supabase databases
"""
import os
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from supabase import create_client

def get_tables_and_columns(url: str, key: str, db_name: str):
    """Get all tables and their columns from a Supabase database"""
    print(f"\n📊 Connecting to {db_name} database...")
    client = create_client(url, key)
    
    # List of tables to check (based on your migrations)
    expected_tables = [
        'sales_invoices',
        'sales_invoices_verified', 
        'vendor_invoices',
        'vendor_invoices_verified',
        'stock_levels',
        'vendor_mapping',
        'upload_tasks',
        'recalculation_tasks',
        'sync_metadata'
    ]
    
    schema = {}
    
    for table_name in expected_tables:
        try:
            # Try to get one row to see column structure
            response = client.table(table_name).select('*').limit(1).execute()
            
            if response.data or hasattr(response, 'data'):
                # Table exists
                # Get sample row to determine columns
                if response.data and len(response.data) > 0:
                    columns = list(response.data[0].keys())
                else:
                    # Table exists but is empty - try to infer from response
                    columns = ['(empty table - columns unknown)']
                
                schema[table_name] = sorted(columns)
                print(f"   ✅ {table_name}: {len(columns)} columns")
        except Exception as e:
            print(f"   ❌ {table_name}: NOT FOUND or ERROR")
            schema[table_name] = None
    
    return schema

def compare_schemas(dev_schema: dict, prod_schema: dict):
    """Compare two database schemas and print differences"""
    print("\n" + "=" * 80)
    print("COMPARISON RESULTS")
    print("=" * 80)
    
    all_tables = set(list(dev_schema.keys()) + list(prod_schema.keys()))
    
    differences_found = False
    
    for table in sorted(all_tables):
        dev_cols = dev_schema.get(table)
        prod_cols = prod_schema.get(table)
        
        # Table missing in one DB
        if dev_cols is None and prod_cols is not None:
            print(f"\n⚠️  {table}:")
            print(f"   MISSING IN DEV (exists in Prod)")
            differences_found = True
            continue
        
        if prod_cols is None and dev_cols is not None:
            print(f"\n⚠️  {table}:")
            print(f"   MISSING IN PROD (exists in Dev)")
            differences_found = True
            continue
        
        if dev_cols is None and prod_cols is None:
            print(f"\n❌ {table}:")
            print(f"   Missing in BOTH databases")
            differences_found = True
            continue
        
        # Both exist - compare columns
        dev_set = set(dev_cols)
        prod_set = set(prod_cols)
        
        if dev_set != prod_set:
            print(f"\n⚠️  {table}:")
            
            # Columns only in Dev
            dev_only = dev_set - prod_set
            if dev_only:
                print(f"   Columns only in DEV: {sorted(dev_only)}")
            
            # Columns only in Prod
            prod_only = prod_set - dev_set
            if prod_only:
                print(f"   Columns only in PROD: {sorted(prod_only)}")
            
            differences_found = True
        else:
            print(f"\n✅ {table}: IDENTICAL ({len(dev_cols)} columns)")
    
    return differences_found

def main():
    """Main comparison function"""
    print("=" * 80)
    print("DATABASE SCHEMA COMPARISON TOOL")
    print("=" * 80)
    
    # Get Dev credentials from secrets.toml
    try:
        import configs
        secrets = configs.load_secrets()
        supabase_dev = secrets.get('supabase', {})
        
        dev_url = supabase_dev.get('url')
        dev_key = supabase_dev.get('service_role_key')
        
        if not dev_url or not dev_key:
            print("❌ Error: Dev database credentials not found in secrets.toml")
            return
        
        print(f"\n✅ Dev database found in secrets.toml")
        print(f"   URL: {dev_url[:40]}...")
    except Exception as e:
        print(f"❌ Error loading Dev credentials: {e}")
        return
    
    # Get Prod credentials
    print("\nTo compare with Production database, please provide credentials:")
    print("(You can find these in GitHub Secrets or ask your admin)")
    prod_url = input("\n  Prod Supabase URL: ").strip()
    prod_key = input("  Prod Service Role Key: ").strip()
    
    if not prod_url or not prod_key:
        print("\n❌ Error: Production credentials required")
        return
    
    # Get schemas
    dev_schema = get_tables_and_columns(dev_url, dev_key, "DEV")
    prod_schema = get_tables_and_columns(prod_url, prod_key, "PROD")
    
    # Compare
    has_differences = compare_schemas(dev_schema, prod_schema)
    
    # Summary
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    
    if has_differences:
        print("⚠️  DATABASES ARE NOT IN SYNC!")
        print("\nRecommended Actions:")
        print("1. Review the differences above")
        print("2. Run missing migrations on the database that's behind")
        print("3. Check backend/migrations/ folder for migration scripts")
    else:
        print("✅ ALL TABLES AND COLUMNS ARE IN SYNC!")
        print("\nBoth databases have identical structure.")

if __name__ == "__main__":
    main()
