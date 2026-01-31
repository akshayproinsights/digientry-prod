"""
Internal script to run comparison using credentials from files.
Bypasses shell encoding/copy-paste issues.
"""
import json
import sys
import os
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

import configs
import scripts.compare_databases as comparer

def main():
    print("🚀 Starting Internal Database Comparison...")
    
    # 1. Get DEV Credentials
    print("   Loading Dev credentials from secrets.toml...")
    secrets = configs.load_secrets()
    supabase_dev = secrets.get('supabase', {})
    dev_url = supabase_dev.get('url')
    dev_key = supabase_dev.get('service_role_key')
    
    if not dev_url or not dev_key:
        print("❌ Failed to find Dev credentials")
        return

    # 2. Get PROD Credentials from JSON dump
    print("   Loading Prod credentials from cloud_run_config.json...")
    try:
        # Try diff encodings
        try:
            with open('cloud_run_config.json', encoding='utf-16') as f:
                data = json.load(f)
        except:
             with open('cloud_run_config.json', encoding='utf-8') as f:
                data = json.load(f)
                
        env = data['spec']['template']['spec']['containers'][0]['env']
        prod_url = next(item['value'] for item in env if item['name'] == 'SUPABASE_URL')
        prod_key = next(item['value'] for item in env if item['name'] == 'SUPABASE_KEY')
        
    except Exception as e:
        print(f"❌ Failed to parse Prod config: {e}")
        return

    if not prod_url or not prod_key:
        print("❌ Failed to find Prod credentials in JSON")
        return

    # 3. Run Comparison
    print(f"   Dev URL: {dev_url[:20]}...")
    print(f"   Prod URL: {prod_url[:20]}...")
    
    dev_schema = comparer.get_tables_and_columns(dev_url, dev_key, "DEV")
    prod_schema = comparer.get_tables_and_columns(prod_url, prod_key, "PROD")
    
    comparer.compare_schemas(dev_schema, prod_schema)
    
if __name__ == "__main__":
    main()
