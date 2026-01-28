-- ============================================================================
-- ONE-TIME FIX: Sync Dev DB with Production Schema
-- Run this ONCE in your DEV Supabase SQL Editor
-- https://supabase.com/dashboard/project/hhgtmkkranfvhkcjcclp/sql/new
-- ============================================================================
-- This adds ALL missing columns that the code expects
-- After this, restart your backend and everything should work!
-- ============================================================================

-- 1. INVOICES - Add missing columns and fix constraint
ALTER TABLE invoices 
ADD COLUMN IF NOT EXISTS customer TEXT,
ADD COLUMN IF NOT EXISTS vehicle_number TEXT,
ADD COLUMN IF NOT EXISTS receipt_link TEXT,
ADD COLUMN IF NOT EXISTS quantity NUMERIC,
ADD COLUMN IF NOT EXISTS rate NUMERIC,
ADD COLUMN IF NOT EXISTS type TEXT,
ADD COLUMN IF NOT EXISTS upload_date TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());

-- Fix: r2_file_path should be nullable
ALTER TABLE invoices ALTER COLUMN r2_file_path DROP NOT NULL;

-- 2. VERIFIED_INVOICES - Add missing columns
ALTER TABLE verified_invoices
ADD COLUMN IF NOT EXISTS upload_date TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
ADD COLUMN IF NOT EXISTS type TEXT,
ADD COLUMN IF NOT EXISTS customer_name TEXT,
ADD COLUMN IF NOT EXISTS total_bill_amount NUMERIC,
ADD COLUMN IF NOT EXISTS vehicle_number TEXT,
ADD COLUMN IF NOT EXISTS quantity NUMERIC,
ADD COLUMN IF NOT EXISTS rate NUMERIC;

-- 3. VERIFICATION_DATES - Add missing columns
ALTER TABLE verification_dates
ADD COLUMN IF NOT EXISTS audit_findings TEXT,
ADD COLUMN IF NOT EXISTS date_and_receipt_combined_bbox JSONB,
ADD COLUMN IF NOT EXISTS receipt_link TEXT;

-- 4. VERIFICATION_AMOUNTS - Add missing columns
ALTER TABLE verification_amounts
ADD COLUMN IF NOT EXISTS amount_mismatch NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS date_and_receipt_combined_bbox JSONB,
ADD COLUMN IF NOT EXISTS description TEXT;

-- 5. STOCK_LEVELS - Add missing columns
ALTER TABLE stock_levels
ADD COLUMN IF NOT EXISTS current_stock NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS internal_item_name TEXT,
ADD COLUMN IF NOT EXISTS total_value NUMERIC DEFAULT 0;

-- 6. DRAFT_PURCHASE_ORDERS - Add missing column
ALTER TABLE draft_purchase_orders
ADD COLUMN IF NOT EXISTS added_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());

-- 7. Create missing indexes
CREATE INDEX IF NOT EXISTS idx_draft_pos_added_at ON draft_purchase_orders(added_at);
CREATE INDEX IF NOT EXISTS idx_verified_invoices_upload_date ON verified_invoices(upload_date);
CREATE INDEX IF NOT EXISTS idx_verified_invoices_type ON verified_invoices(type);
CREATE INDEX IF NOT EXISTS idx_invoices_upload_date ON invoices(upload_date);

-- ============================================================================
-- VERIFICATION QUERY
-- ============================================================================
-- Run this after to confirm all columns exist:

SELECT 'All migrations completed successfully! ✅' as status;

-- Optional: View all invoice columns
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'invoices' AND table_schema = 'public'
ORDER BY ordinal_position;
