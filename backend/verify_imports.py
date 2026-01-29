import sys
import os
import traceback

print("Starting import verification...")

# Mock environment variables to prevent incomplete config errors
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "dummy-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "dummy-key")
os.environ.setdefault("JWT_SECRET", "dummy-secret")

try:
    import main
    print("Successfully imported main.")
except Exception:
    print("Failed to import main:")
    traceback.print_exc()
    sys.exit(1)

print("Import verification complete.")
