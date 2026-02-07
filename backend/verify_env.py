import os
from pathlib import Path
import sys

# Add current directory to path so we can import modules
sys.path.insert(0, str(Path(__file__).parent))

from dotenv import load_dotenv

# Load .env explicitly to show what's happening
load_dotenv()

print("\n" + "="*60)
print("  ENVIRONMENT CONFIGURATION CHECK")
print("="*60)

env = os.getenv("APP_ENV", "NOT SET (defaults to development)")
print(f"\n[1] Current APP_ENV: {env}")

try:
    import configs
    import config
    
    # Check Supabase
    sb = config.get_supabase_config()
    print("\n[2] Supabase Configuration:")
    if sb:
        print(f"    - URL: {sb.get('url')}")
        key = sb.get('service_role_key')
        if key:
            print(f"    - Key starts with: {key[:10]}...")
            print(f"    - Key ends with:   ...{key[-10:]}")
        
        # Heuristic check
        if "zlqwoexom" in sb.get('url', ''):
            print("    -> DETECTED: PRODUCTION Database")
        elif "hhgtmkkranfv" in sb.get('url', ''):
            print("    -> DETECTED: DEVELOPMENT Database")
        else:
            print("    -> DETECTED: Unknown Database")
    else:
        print("    - NOT FOUND!")

    # Check R2
    r2 = configs.get_r2_config()
    print("\n[3] Cloudflare R2 Configuration:")
    if r2:
        print(f"    - Account ID: {r2.get('account_id')}")
        print(f"    - Bucket URL: {r2.get('public_base_url')}")
    else:
        print("    - NOT FOUND!")
        
    print("\n" + "-"*60)
    print("To switch environments:")
    print("1. Open backend/.env")
    print("2. Change APP_ENV to 'production' or 'development'")
    print("3. Run this script again to verify.")
    print("="*60 + "\n")

except Exception as e:
    print(f"\nERROR: {e}")
    import traceback
    traceback.print_exc()
