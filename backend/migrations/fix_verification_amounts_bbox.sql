-- Fix: Add combined bbox to verification_amounts table
-- I missed this table in the previous migration

ALTER TABLE verification_amounts ADD COLUMN IF NOT EXISTS date_and_receipt_combined_bbox JSONB;

COMMENT ON COLUMN verification_amounts.date_and_receipt_combined_bbox IS 'Combined bounding box for date and receipt number when they are close together';
