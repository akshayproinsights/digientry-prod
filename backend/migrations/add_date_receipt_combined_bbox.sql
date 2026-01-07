-- Migration: Add combined bbox for date and receipt number
-- This enables showing one image preview when date and receipt are close together

-- Add to invoices table
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS date_and_receipt_combined_bbox JSONB;

-- Add to verification_dates table
ALTER TABLE verification_dates ADD COLUMN IF NOT EXISTS date_and_receipt_combined_bbox JSONB;

-- Add to verified_invoices table
ALTER TABLE verified_invoices ADD COLUMN IF NOT EXISTS date_and_receipt_combined_bbox JSONB;

-- Add comments
COMMENT ON COLUMN invoices.date_and_receipt_combined_bbox IS 'Combined bounding box for date and receipt number when they are close together (normalized coords 0-1)';
COMMENT ON COLUMN verification_dates.date_and_receipt_combined_bbox IS 'Combined bounding box for date and receipt number when they are close together (normalized coords 0-1)';
COMMENT ON COLUMN verified_invoices.date_and_receipt_combined_bbox IS 'Combined bounding box for date and receipt number when they are close together (normalized coords 0-1)';
