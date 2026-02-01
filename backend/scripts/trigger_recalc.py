
import sys
import os
import uuid
from datetime import datetime

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import get_database_client
from routes.stock_routes import recalculate_stock_for_user
import logging

# Configure logging to stdout
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def trigger_recalc(username="adnak"):
    print(f"--- Triggering Stock Recalculation for {username} ---")
    
    try:
        recalculate_stock_for_user(username)
        print("✅ Recalculation completed successfully.")
    except Exception as e:
        print(f"❌ Recalculation failed: {e}")
        import traceback
        with open("recalc.log", "w") as f:
            f.write(traceback.format_exc())

if __name__ == "__main__":
    if len(sys.argv) > 1:
        user = sys.argv[1]
    else:
        user = "adnak"
    trigger_recalc(user)
