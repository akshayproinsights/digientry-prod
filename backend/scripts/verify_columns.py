import sys
import os
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from database import get_database_client

def verify_column():
    print("Verifying 'batch' column in 'inventory_items'...")
    try:
        db = get_database_client()
        # Try to select the batch column
        response = db.client.table("inventory_items").select("batch").limit(1).execute()
        print("✅ Column 'batch' exists!")
        return True
    except Exception as e:
        print(f"❌ Error verifying column: {e}")
        return False

if __name__ == "__main__":
    verify_column()
