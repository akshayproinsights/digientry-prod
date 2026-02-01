-- Fix vendor_mapping_entries columns to match backend code
ALTER TABLE vendor_mapping_entries 
ADD COLUMN IF NOT EXISTS customer_item_name TEXT,
ADD COLUMN IF NOT EXISTS part_number TEXT,
ADD COLUMN IF NOT EXISTS vendor_description TEXT;

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_vendor_mapping_part_number ON vendor_mapping_entries(part_number);
