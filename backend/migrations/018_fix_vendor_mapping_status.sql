-- Add status column to vendor_mapping_entries
ALTER TABLE vendor_mapping_entries 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Added';

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_vendor_mapping_status ON vendor_mapping_entries(status);
