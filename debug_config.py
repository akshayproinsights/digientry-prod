import os
import sys

# Add backend to path
sys.path.append(os.path.join(os.getcwd(), "backend"))

import configs

print(f"Current Working Directory: {os.getcwd()}")
print(f"APP_ENV: {os.getenv('APP_ENV')}")

print("\nLoad Secrets:")
secrets = configs.load_secrets()
print(secrets.keys())
if "cloudflare_r2" in secrets:
    print(f"cloudflare_r2 keys: {secrets['cloudflare_r2'].keys()}")
    if "development" in secrets['cloudflare_r2']:
        print(f"cloudflare_r2.development: {secrets['cloudflare_r2']['development']}")

print("\nR2 Config:")
r2_config = configs.get_r2_config()
print(r2_config)
