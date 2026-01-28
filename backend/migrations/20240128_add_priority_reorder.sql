-- Add priority and reorder_point columns to vendor_mapping_entries table
-- Run this in the Supabase SQL Editor

ALTER TABLE vendor_mapping_entries 
ADD COLUMN IF NOT EXISTS priority text,
ADD COLUMN IF NOT EXISTS reorder_point numeric DEFAULT 0;

-- Comment: These columns are required by the updated Stock Routes logic.
