"""
Migration script to add upload_date and verification_status columns to inventory_items table
"""

# SQL to run in Supabase SQL Editor:

sql_migration = """
-- Add upload_date column (nullable for existing records)
ALTER TABLE inventory_items 
ADD COLUMN IF NOT EXISTS upload_date TIMESTAMP;

-- Add verification_status column with default 'Pending'
ALTER TABLE inventory_items 
ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'Pending' CHECK (verification_status IN ('Pending', 'Done'));

-- Set upload_date to created_at for existing records
UPDATE inventory_items 
SET upload_date = created_at 
WHERE upload_date IS NULL;

-- Auto-set status to 'Done' where mismatch is 0
UPDATE inventory_items 
SET verification_status = 'Done' 
WHERE amount_mismatch = 0 AND verification_status = 'Pending';

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_inventory_verification_status ON inventory_items(verification_status);
CREATE INDEX IF NOT EXISTS idx_inventory_upload_date ON inventory_items(upload_date DESC);
"""

print("=" * 80)
print("SQL Migration for inventory_items table")
print("=" * 80)
print(sql_migration)
print("\nCopy and paste the above SQL into your Supabase SQL Editor and run it.")
print("=" * 80)
