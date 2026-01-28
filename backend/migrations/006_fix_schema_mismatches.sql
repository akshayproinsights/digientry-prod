-- ============================================================================
-- FIX SCHEMA MISMATCHES
-- Add missing columns identified during file processing errors
-- ============================================================================

-- 1. INVOICES TABLE
-- Error: Could not find the 'receipt_link' column of 'invoices'
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS receipt_link TEXT;

-- 2. VERIFICATION_DATES TABLE
-- Error: Could not find the 'receipt_link' column of 'verification_dates'
ALTER TABLE verification_dates
ADD COLUMN IF NOT EXISTS receipt_link TEXT;

-- 3. VERIFICATION_AMOUNTS TABLE
-- Error: Could not find the 'description' column of 'verification_amounts'
ALTER TABLE verification_amounts
ADD COLUMN IF NOT EXISTS description TEXT;

-- ============================================================================
-- CONFIRMATION
SELECT 'Schema mismatches fixed successfully! ✅' as status;
