-- Migration to add total_in and total_out columns to stock_levels
-- Fixing APIError: column stock_levels.total_in does not exist

ALTER TABLE stock_levels
ADD COLUMN IF NOT EXISTS total_in NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_out NUMERIC DEFAULT 0;

-- Notify that migration is done
SELECT 'Added total_in and total_out columns to stock_levels' as status;
