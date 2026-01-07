-- ================================================================
-- ADD BOUNDING BOX COLUMNS TO VERIFICATION TABLES
-- Run this in Supabase SQL Editor
-- ================================================================

-- 1. Add bbox columns to verification_dates table
ALTER TABLE verification_dates 
ADD COLUMN IF NOT EXISTS receipt_number_bbox JSONB,
ADD COLUMN IF NOT EXISTS date_bbox JSONB;

-- 2. Add bbox columns to verification_amounts table
ALTER TABLE verification_amounts 
ADD COLUMN IF NOT EXISTS receipt_number_bbox JSONB,
ADD COLUMN IF NOT EXISTS description_bbox JSONB,
ADD COLUMN IF NOT EXISTS quantity_bbox JSONB,
ADD COLUMN IF NOT EXISTS rate_bbox JSONB,
ADD COLUMN IF NOT EXISTS amount_bbox JSONB;

-- ================================================================
-- Verify columns were added (optional check)
-- ================================================================
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'verification_dates' 
AND column_name LIKE '%bbox%';

SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'verification_amounts' 
AND column_name LIKE '%bbox%';
