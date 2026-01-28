import json
import os
import sys

def main():
    print("\n=== Data Entry Helper for GitHub Secrets ===\n")
    print("This script will help you create the JSON values needed for your GitHub Secrets.")
    print("You need to create a secret named: USERS_CONFIG_JSON")
    print("which is required for the application to handle logins.\n")

    users_config = {}
    
    while True:
        print("\n--- Add a User ---")
        username = input("Enter Username (e.g. Adnak): ").strip()
        if not username:
             break
             
        password = input(f"Enter Password for {username}: ").strip()
        r2_bucket = input(f"Enter R2 Bucket Name for {username} (e.g. digientry-adnak): ").strip()
        sheet_id = input(f"Enter Google Sheet ID for {username} (optional): ").strip()
        dashboard_url = input(f"Enter Dashboard URL for {username} (optional): ").strip()
        
        users_config[username] = {
            "password": password,
            "r2_bucket": r2_bucket,
            "sheet_id": sheet_id,
            "dashboard_url": dashboard_url
        }
        
        more = input("Add another user? (y/n): ").lower()
        if more != 'y':
            break

    if not users_config:
        print("No users added. Exiting.")
        return

    print("\n\n=== COPY THE CONTENT BELOW ===")
    print("Go to GitHub > Settings > Secrets and variables > Actions > New repository secret")
    print("Name: USERS_CONFIG_JSON")
    print("Secret:")
    print(json.dumps(users_config))
    print("==============================\n")
    
    print("\n=== COPY THE CONTENT BELOW for GCP_SERVICE_ACCOUNT (if needed) ===")
    print("If you have your service-account.json file content, paste it into a secret named: GCP_SA_KEY")
    print("(You likely already set this up for terraform/deployment, but ensure the APP uses it via env vars if needed).\n")

if __name__ == "__main__":
    main()
