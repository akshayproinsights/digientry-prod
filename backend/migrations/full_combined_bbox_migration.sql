-- Add combined bbox column to all relevant tables
-- Run this in the Supabase SQL Editor

-- 1. Invoices table
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS date_and_receipt_combined_bbox JSONB;

-- 2. Verification Dates table
ALTER TABLE verification_dates ADD COLUMN IF NOT EXISTS date_and_receipt_combined_bbox JSONB;

-- 3. Verified Invoices table
ALTER TABLE verified_invoices ADD COLUMN IF NOT EXISTS date_and_receipt_combined_bbox JSONB;

-- 4. Verification Amounts table
ALTER TABLE verification_amounts ADD COLUMN IF NOT EXISTS date_and_receipt_combined_bbox JSONB;

-- Comments
COMMENT ON COLUMN invoices.date_and_receipt_combined_bbox IS 'Combined bounding box for date and receipt number (normalized)';
COMMENT ON COLUMN verification_dates.date_and_receipt_combined_bbox IS 'Combined bounding box for date and receipt number (normalized)';
COMMENT ON COLUMN verified_invoices.date_and_receipt_combined_bbox IS 'Combined bounding box for date and receipt number (normalized)';
COMMENT ON COLUMN verification_amounts.date_and_receipt_combined_bbox IS 'Combined bounding box for date and receipt number (normalized)';
