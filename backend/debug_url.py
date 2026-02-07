import os
import sys
import urllib.request
import ssl

# Ensure backend directory is in path
sys.path.append(os.getcwd())

import config
from services.storage import get_storage_client

print(f"DEBUG: CWD: {os.getcwd()}")

try:
    storage = get_storage_client()
    bucket = "digientry-local-dev"
    
    print(f"\nListing files in {bucket}...")
    files = storage.list_files(bucket, "adnak-test/sales/")
    print(f"Found {len(files)} files.")
    
    if files:
        # Get the most recent one (assuming sort by name works for timestamped files)
        files.sort()
        recent_file = files[-1]
        print(f"Most recent file: {recent_file}")
        
        url = storage.get_public_url(bucket, recent_file)
        print(f"Generated URL: {url}")
        
        if url:
            print(f"Testing access to URL...")
            try:
                # Bypass SSL cert verify for testing if needed
                ctx = ssl.create_default_context()
                ctx.check_hostname = False
                ctx.verify_mode = ssl.CERT_NONE
                
                req = urllib.request.Request(url, method='HEAD')
                with urllib.request.urlopen(req, context=ctx) as response:
                    print(f"HTTP Status: {response.status}")
            except Exception as e:
                print(f"HTTP Request Failed: {e}")
        else:
            print("URL is None!")
    else:
        print("No files found.")

except Exception as e:
    print(f"ERROR: {e}")
