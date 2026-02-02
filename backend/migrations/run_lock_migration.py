"""
Direct PostgreSQL migration runner for advisory lock fix
Automatically runs the lock migration against Supabase
"""
import sys
from pathlib import Path
from urllib.parse import quote_plus

try:
    import psycopg2
except ImportError:
    print("ERROR: psycopg2 not installed!")
    print("Install it with: pip install psycopg2-binary")
    sys.exit(1)


def run_migration(migration_file):
    """Execute SQL migration using direct PostgreSQL connection"""
    
    # Read migration file
    migration_path = Path(__file__).parent / migration_file
    
    if not migration_path.exists():
        print(f"ERROR: Migration file not found: {migration_path}")
        return False
    
    print(f"\nReading migration: {migration_file}")
    with open(migration_path, 'r', encoding='utf-8') as f:
        sql_content = f.read()
    
    # Get database password
    print("\n" + "="*60)
    print("Supabase Database Connection")
    print("="*60)
    print("Enter your Supabase database password")
    print("(Get it from: Supabase Dashboard -> Settings -> Database)")
    print("Connection string format:")
    print("postgresql://postgres:[YOUR-PASSWORD]@db.hhgtmkkranfvhkcjcclp...")
    print("="*60)
    
    db_password = input("\nPassword: ").strip()
    
    if not db_password:
        print("ERROR: Password required")
        return False
    
    # URL-encode password to handle special characters like @, #, etc.
    encoded_password = quote_plus(db_password)
    
    # Build connection string using DIRECT connection (port 5432)
    db_url = f"postgresql://postgres:{encoded_password}@db.hhgtmkkranfvhkcjcclp.supabase.co:5432/postgres"
    
    print(f"\nConnecting to Supabase PostgreSQL (direct connection)...")
    
    try:
        # Connect to PostgreSQL
        conn = psycopg2.connect(db_url)
        conn.autocommit = True
        cursor = conn.cursor()
        
        print(f"SUCCESS: Connected!\n")
        
        # Execute the entire SQL file as one transaction
        print(f"Executing migration SQL...\n")
        
        try:
            cursor.execute(sql_content)
            print(f"   SUCCESS: acquire_stock_lock function updated")
            print(f"   SUCCESS: release_stock_lock function updated")
        except Exception as e:
            print(f"   ERROR: {e}")
            return False
        
        cursor.close()
        conn.close()
        
        print(f"\n{'='*60}")
        print(f"Migration complete!")
        print(f"{'='*60}\n")
        
        return True
        
    except psycopg2.OperationalError as e:
        print(f"Connection ERROR: {e}")
        print(f"\nCommon issues:")
        print(f"  1. Wrong password")
        print(f"  2. Database is paused")
        print(f"  3. Network/firewall blocking connection")
        return False
    except Exception as e:
        print(f"ERROR: {e}")
        return False


if __name__ == "__main__":
    print("="*60)
    print("Advisory Lock Migration Fix")
    print("="*60)
    
    migration_file = "add_advisory_lock_functions.sql"
    
    success = run_migration(migration_file)
    
    if success:
        print("\nMigration completed successfully!")
        print("IMPORTANT: Restart your backend server to apply changes")
        print("The recalculation timeout issue should now be resolved.")
    else:
        print("\nMigration failed. Please check the errors above.")
    
    sys.exit(0 if success else 1)
