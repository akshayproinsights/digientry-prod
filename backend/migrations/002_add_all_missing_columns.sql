-- Complete missing columns fix for dev database
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/hhgtmkkranfvhkcjcclp/sql/new

-- ============================================================================
-- INVOICES TABLE - Add all missing columns and fix constraints
-- ============================================================================
ALTER TABLE invoices 
ADD COLUMN IF NOT EXISTS customer TEXT,
ADD COLUMN IF NOT EXISTS vehicle_number TEXT,
ADD COLUMN IF NOT EXISTS receipt_link TEXT,
ADD COLUMN IF NOT EXISTS quantity NUMERIC,
ADD COLUMN IF NOT EXISTS rate NUMERIC,
ADD COLUMN IF NOT EXISTS type TEXT, -- 'Part' or 'Labour'
ADD COLUMN IF NOT EXISTS upload_date TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());

-- Make r2_file_path nullable (since code doesn't always populate it)
ALTER TABLE invoices ALTER COLUMN r2_file_path DROP NOT NULL;

-- ============================================================================
-- VERIFIED_INVOICES TABLE - Add missing columns
-- ============================================================================
ALTER TABLE verified_invoices
ADD COLUMN IF NOT EXISTS upload_date TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
ADD COLUMN IF NOT EXISTS type TEXT,
ADD COLUMN IF NOT EXISTS customer_name TEXT,
ADD COLUMN IF NOT EXISTS total_bill_amount NUMERIC,
ADD COLUMN IF NOT EXISTS vehicle_number TEXT,
ADD COLUMN IF NOT EXISTS quantity NUMERIC,
ADD COLUMN IF NOT EXISTS rate NUMERIC;

-- ============================================================================
-- VERIFICATION_DATES TABLE - Add missing columns
-- ============================================================================
ALTER TABLE verification_dates
ADD COLUMN IF NOT EXISTS audit_findings TEXT,
ADD COLUMN IF NOT EXISTS date_and_receipt_combined_bbox JSONB,
ADD COLUMN IF NOT EXISTS receipt_link TEXT;

-- ============================================================================
-- VERIFICATION_AMOUNTS TABLE - Add missing columns
-- ============================================================================
ALTER TABLE verification_amounts
ADD COLUMN IF NOT EXISTS amount_mismatch NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS date_and_receipt_combined_bbox JSONB,
ADD COLUMN IF NOT EXISTS description TEXT;

-- ============================================================================
-- STOCK_LEVELS TABLE - Add missing columns
-- ============================================================================
ALTER TABLE stock_levels
ADD COLUMN IF NOT EXISTS current_stock NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS internal_item_name TEXT,
ADD COLUMN IF NOT EXISTS total_value NUMERIC DEFAULT 0;

-- ============================================================================
-- DRAFT_PURCHASE_ORDERS TABLE - Add missing column
-- ============================================================================
ALTER TABLE draft_purchase_orders
ADD COLUMN IF NOT EXISTS added_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());

-- ============================================================================
-- CREATE MISSING INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_draft_pos_added_at ON draft_purchase_orders(added_at);
CREATE INDEX IF NOT EXISTS idx_verified_invoices_upload_date ON verified_invoices(upload_date);
CREATE INDEX IF NOT EXISTS idx_verified_invoices_type ON verified_invoices(type);

SELECT 'All missing columns added successfully!' as status;
