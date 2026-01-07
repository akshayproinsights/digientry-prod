-- Migration: Allow NULL dates in invoice tables
-- Purpose: Prevent data loss when Gemini fails to extract dates from invoices
-- Date: 2026-01-02

-- Allow NULL dates in invoices table
ALTER TABLE invoices 
ALTER COLUMN date DROP NOT NULL;

-- Allow NULL dates in verification_dates table
ALTER TABLE verification_dates 
ALTER COLUMN date DROP NOT NULL;

-- Allow NULL dates in verified_invoices table
ALTER TABLE verified_invoices 
ALTER COLUMN date DROP NOT NULL;

-- Add comment to document the change
COMMENT ON COLUMN invoices.date IS 'Invoice date - can be NULL if not extractable from image, requires manual review';
COMMENT ON COLUMN verification_dates.date IS 'Invoice date - can be NULL if not extractable from image, requires manual review';
COMMENT ON COLUMN verified_invoices.date IS 'Invoice date - can be NULL if not extractable from image';
