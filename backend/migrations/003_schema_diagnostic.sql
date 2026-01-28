-- ============================================================================
-- SCHEMA DIAGNOSTIC - Compare what tables have vs what they need
-- Run this in your DEV Supabase SQL Editor to see ALL missing columns
-- https://supabase.com/dashboard/project/hhgtmkkranfvhkcjcclp/sql/new
-- ============================================================================

-- This query shows which columns exist in each table
-- Compare this output with the expected columns below

SELECT 
    'invoices' as table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'invoices'
  AND table_schema = 'public'
ORDER BY ordinal_position

UNION ALL

SELECT 
    'verified_invoices' as table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'verified_invoices'
  AND table_schema = 'public'
ORDER BY ordinal_position

UNION ALL

SELECT 
    'verification_dates' as table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'verification_dates'
  AND table_schema = 'public'
ORDER BY ordinal_position

UNION ALL

SELECT 
    'verification_amounts' as table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'verification_amounts'
  AND table_schema = 'public'
ORDER BY ordinal_position

UNION ALL

SELECT 
    'stock_levels' as table_name,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'stock_levels'
  AND table_schema = 'public'
ORDER BY ordinal_position

ORDER BY table_name, column_name;

-- ============================================================================
-- EXPECTED COLUMNS CHECKLIST
-- ============================================================================
-- After running the query above, verify these columns exist:

-- INVOICES table should have:
-- ✓ customer (text)
-- ✓ vehicle_number (text)
-- ✓ receipt_link (text)
-- ✓ quantity (numeric)
-- ✓ rate (numeric)
-- ✓ type (text)
-- ✓ upload_date (timestamp with time zone)
-- ✓ r2_file_path (text, NULLABLE)

-- VERIFIED_INVOICES table should have:
-- ✓ upload_date (timestamp with time zone)
-- ✓ type (text)
-- ✓ customer_name (text)
-- ✓ total_bill_amount (numeric)
-- ✓ vehicle_number (text)
-- ✓ quantity (numeric)
-- ✓ rate (numeric)

-- VERIFICATION_DATES table should have:
-- ✓ audit_findings (text)
-- ✓ date_and_receipt_combined_bbox (jsonb)
-- ✓ receipt_link (text)

-- VERIFICATION_AMOUNTS table should have:
-- ✓ amount_mismatch (numeric)
-- ✓ date_and_receipt_combined_bbox (jsonb)
-- ✓ description (text)

-- STOCK_LEVELS table should have:
-- ✓ current_stock (numeric)
-- ✓ internal_item_name (text)
-- ✓ total_value (numeric)

-- DRAFT_PURCHASE_ORDERS table should have:
-- ✓ added_at (timestamp with time zone)
