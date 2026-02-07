
import asyncio
import logging
import sys
from services.verification import run_sync_verified_logic_supabase

# Configure logging
logging.basicConfig(level=logging.INFO, stream=sys.stdout)

async def run_sync():
    print("Triggering sync...")
    try:
        res = await run_sync_verified_logic_supabase('adnak-test')
        print(f"Result: {res}")
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    asyncio.run(run_sync())
