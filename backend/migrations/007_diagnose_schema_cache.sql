-- ============================================================================
-- DIAGNOSTIC: Check actual column existence
-- ============================================================================

-- 1. Check invoices columns
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'invoices' AND table_schema = 'public'
  AND column_name IN ('upload_date', 'receipt_link', 'customer', 'vehicle_number')
ORDER BY column_name;

-- 2. Check verified_invoices columns
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'verified_invoices' AND table_schema = 'public'
  AND column_name IN ('upload_date', 'type')
ORDER BY column_name;

-- 3. Check stock_levels columns
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'stock_levels' AND table_schema = 'public'
  AND column_name IN ('current_stock', 'internal_item_name')
ORDER BY column_name;

-- 4. Check draft_purchase_orders columns
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'draft_purchase_orders' AND table_schema = 'public'
  AND column_name IN ('added_at')
ORDER BY column_name;

-- 5. Check verification_amounts columns
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'verification_amounts' AND table_schema = 'public'
  AND column_name IN ('row_id', 'description')
ORDER BY column_name;

-- 6. Check verification_dates r2_file_path constraint
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'verification_dates' AND table_schema = 'public'
  AND column_name = 'r2_file_path';

-- ============================================================================
-- POSTGREST SCHEMA CACHE RELOAD
-- ============================================================================
-- After running above diagnostics, reload PostgREST schema cache:
-- Method 1: Send NOTIFY signal (run this in SQL editor)
NOTIFY pgrst, 'reload schema';

-- Method 2: Or just restart your backend server
SELECT 'Schema cache reload signal sent! ✅' as status;
