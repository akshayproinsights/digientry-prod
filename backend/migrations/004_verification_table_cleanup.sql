-- ============================================================================
-- COMPLETE SCHEMA FIX - Add ALL Missing Columns
-- This migration adds EVERY column that the backend code expects
-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/hhgtmkkranfvhkcjcclp/sql/new
-- ============================================================================

-- ============================================================================
-- 1. INVOICES TABLE - Add all missing columns
-- ============================================================================
-- Core business columns
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS customer TEXT,
ADD COLUMN IF NOT EXISTS vehicle_number TEXT,
ADD COLUMN IF NOT EXISTS quantity NUMERIC,
ADD COLUMN IF NOT EXISTS rate NUMERIC,
ADD COLUMN IF NOT EXISTS type TEXT;

-- Industry-specific columns (automobile)
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS mobile_number INTEGER,
ADD COLUMN IF NOT EXISTS odometer INTEGER,
ADD COLUMN IF NOT EXISTS total_bill_amount NUMERIC;

-- Industry-specific columns (medical)
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS patient_name TEXT,
ADD COLUMN IF NOT EXISTS patient_id TEXT,
ADD COLUMN IF NOT EXISTS prescription_number TEXT,
ADD COLUMN IF NOT EXISTS doctor_name TEXT;

-- Metadata columns
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS industry_type TEXT;

-- ============================================================================
-- 2. VERIFIED_INVOICES TABLE
-- ============================================================================
ALTER TABLE verified_invoices
ADD COLUMN IF NOT EXISTS receipt_link TEXT;

-- ============================================================================
-- 3. VERIFICATION_DATES TABLE
-- ============================================================================
ALTER TABLE verification_dates
ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'Pending',
ADD COLUMN IF NOT EXISTS audit_findings TEXT,
ADD COLUMN IF NOT EXISTS receipt_number_bbox JSONB,
ADD COLUMN IF NOT EXISTS row_id TEXT,
ADD COLUMN IF NOT EXISTS upload_date TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
ADD COLUMN IF NOT EXISTS date_and_receipt_combined_bbox JSONB;

-- ============================================================================
-- 4. VERIFICATION_AMOUNTS TABLE
-- ============================================================================
ALTER TABLE verification_amounts
ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'Pending',
ADD COLUMN IF NOT EXISTS amount_mismatch NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS receipt_link TEXT,
ADD COLUMN IF NOT EXISTS line_item_row_bbox JSONB,
ADD COLUMN IF NOT EXISTS quantity NUMERIC,
ADD COLUMN IF NOT EXISTS rate NUMERIC,
ADD COLUMN IF NOT EXISTS date_and_receipt_combined_bbox JSONB;

-- ============================================================================
SELECT 'All missing columns added successfully! ✅' as status;