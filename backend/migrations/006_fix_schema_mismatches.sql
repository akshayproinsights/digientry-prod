-- ============================================================================
-- FIX SCHEMA MISMATCHES
-- Add missing columns identified during file processing errors
-- ============================================================================

-- 1. INVOICES TABLE
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS receipt_link TEXT,
ADD COLUMN IF NOT EXISTS upload_date TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());

-- 2. VERIFIED_INVOICES TABLE (Add missing columns tracked in diagnostics)
ALTER TABLE verified_invoices
ADD COLUMN IF NOT EXISTS upload_date TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
ADD COLUMN IF NOT EXISTS type TEXT;

-- 3. STOCK_LEVELS TABLE
ALTER TABLE stock_levels
ADD COLUMN IF NOT EXISTS current_stock NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS internal_item_name TEXT;

-- 4. DRAFT_PURCHASE_ORDERS TABLE
ALTER TABLE draft_purchase_orders
ADD COLUMN IF NOT EXISTS added_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());

-- 5. VERIFICATION_AMOUNTS TABLE
ALTER TABLE verification_amounts
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS row_id TEXT;  -- Missing column causing 500 error

-- 6. VERIFICATION_DATES TABLE
ALTER TABLE verification_dates
ADD COLUMN IF NOT EXISTS receipt_link TEXT;

-- Fix "null value in column r2_file_path violates not-null constraint"
ALTER TABLE verification_dates ALTER COLUMN r2_file_path DROP NOT NULL;

-- ============================================================================
-- CONFIRMATION
SELECT 'Schema mismatches fixed successfully! ✅' as status;
