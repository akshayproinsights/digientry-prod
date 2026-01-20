"""
Run database migration: Add image_hash columns to verification tables
"""
import os
from database import get_database_client

def run_migration():
    """Add image_hash columns to verification tables"""
    supabase = get_database_client()
    
    migration_sql = """
    -- Add image_hash to verification_dates table
    ALTER TABLE verification_dates 
    ADD COLUMN IF NOT EXISTS image_hash TEXT;

    -- Add image_hash to verification_amounts table  
    ALTER TABLE verification_amounts 
    ADD COLUMN IF NOT EXISTS image_hash TEXT;

    -- Create indexes for faster lookups
    CREATE INDEX IF NOT EXISTS idx_verification_dates_image_hash ON verification_dates(image_hash);
    CREATE INDEX IF NOT EXISTS idx_verification_amounts_image_hash ON verification_amounts(image_hash);
    """
    
    try:
        # Execute migration
        result = supabase.rpc('exec_sql', {'sql': migration_sql}).execute()
        print("✅ Migration completed successfully!")
        print(f"Result: {result}")
    except Exception as e:
        # Try alternative approach - execute each statement separately
        print(f"⚠️ RPC method failed: {e}")
        print("Attempting direct table updates...")
        
        try:
            # This won't work with ALTER TABLE through Supabase client
            # We need to use direct SQL execution or Supabase dashboard
            print("❌ Cannot run ALTER TABLE through Supabase Python client")
            print("\n📋 Please run this SQL manually in Supabase Dashboard:")
            print(migration_sql)
            print("\nGo to: https://supabase.com/dashboard/project/yggjqppygdsqhhagufzr/editor")
            
        except Exception as e2:
            print(f"❌ Error: {e2}")

if __name__ == "__main__":
    print("🔧 Running migration: Add image_hash to verification tables...")
    run_migration()
