-- Database migration script for bounding box columns
-- Run this SQL in Supabase SQL Editor
-- This adds bbox coordinates for all extracted fields to enable visual verification

-- Add bbox columns to invoices table
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receipt_number_bbox JSONB;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS date_bbox JSONB;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS description_bbox JSONB;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS quantity_bbox JSONB;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS rate_bbox JSONB;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS amount_bbox JSONB;

-- Add bbox columns to verified_invoices table
ALTER TABLE verified_invoices ADD COLUMN IF NOT EXISTS receipt_number_bbox JSONB;
ALTER TABLE verified_invoices ADD COLUMN IF NOT EXISTS date_bbox JSONB;
ALTER TABLE verified_invoices ADD COLUMN IF NOT EXISTS description_bbox JSONB;
ALTER TABLE verified_invoices ADD COLUMN IF NOT EXISTS quantity_bbox JSONB;
ALTER TABLE verified_invoices ADD COLUMN IF NOT EXISTS rate_bbox JSONB;
ALTER TABLE verified_invoices ADD COLUMN IF NOT EXISTS amount_bbox JSONB;

-- Add bbox columns to verification_dates table
ALTER TABLE verification_dates ADD COLUMN IF NOT EXISTS receipt_number_bbox JSONB;
ALTER TABLE verification_dates ADD COLUMN IF NOT EXISTS date_bbox JSONB;

-- Add bbox columns to verification_amounts table
ALTER TABLE verification_amounts ADD COLUMN IF NOT EXISTS receipt_number_bbox JSONB;
ALTER TABLE verification_amounts ADD COLUMN IF NOT EXISTS description_bbox JSONB;
ALTER TABLE verification_amounts ADD COLUMN IF NOT EXISTS quantity_bbox JSONB;
ALTER TABLE verification_amounts ADD COLUMN IF NOT EXISTS rate_bbox JSONB;
ALTER TABLE verification_amounts ADD COLUMN IF NOT EXISTS amount_bbox JSONB;

-- Confirm migration
SELECT 'Bounding box columns migration completed successfully!' as status;
