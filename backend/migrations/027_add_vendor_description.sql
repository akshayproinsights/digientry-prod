-- Migration to add vendor_description column to stock_levels
-- Fixing APIError: column stock_levels.vendor_description does not exist

ALTER TABLE stock_levels
ADD COLUMN IF NOT EXISTS vendor_description TEXT;

-- Notify that migration is done
SELECT 'Added vendor_description column to stock_levels' as status;
