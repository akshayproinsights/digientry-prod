-- ============================================================================
-- SCHEMA COMPARISON DIAGNOSTIC
-- Compare actual schema with expected schema to identify missing columns
-- Run in Supabase SQL Editor to see what's missing
-- ============================================================================

-- Expected columns for each table
WITH expected_invoices AS (
    SELECT unnest(ARRAY[
        'id', 'created_at', 'username', 'receipt_number', 'date', 
        'customer', 'vehicle_number', 'description', 'amount', 
        'r2_file_path', 'image_hash', 'row_id', 'header_id',
        'quantity', 'rate', 'type',
        'mobile_number', 'odometer', 'total_bill_amount',
        'patient_name', 'patient_id', 'prescription_number', 'doctor_name',
        'industry_type',
        'model_used', 'model_accuracy', 'input_tokens', 'output_tokens', 
        'total_tokens', 'cost_inr'
    ]) AS column_name
),
expected_verified_invoices AS (
    SELECT unnest(ARRAY[
        'id', 'created_at', 'username', 'receipt_number', 'date',
        'description', 'amount', 'r2_file_path', 'image_hash', 
        'row_id', 'header_id', 'line_item_row_bbox',
        'receipt_link',
        'model_used', 'model_accuracy', 'input_tokens', 'output_tokens',
        'total_tokens', 'cost_inr'
    ]) AS column_name
),
expected_verification_dates AS (
    SELECT unnest(ARRAY[
        'id', 'created_at', 'username', 'receipt_number', 'date',
        'r2_file_path', 'image_hash', 'header_id',
        'verification_status', 'audit_findings', 
        'receipt_number_bbox', 'row_id', 'upload_date',
        'date_bbox', 'receipt_bbox', 'combined_bbox',
        'date_and_receipt_combined_bbox',
        'model_used', 'model_accuracy', 'input_tokens', 'output_tokens',
        'total_tokens', 'cost_inr'
    ]) AS column_name
),
expected_verification_amounts AS (
    SELECT unnest(ARRAY[
        'id', 'created_at', 'username', 'receipt_number', 'amount',
        'r2_file_path', 'image_hash', 'header_id',
        'verification_status', 'amount_mismatch', 'receipt_link',
        'line_item_row_bbox', 'quantity', 'rate',
        'amount_bbox', 'receipt_bbox',
        'date_and_receipt_combined_bbox',
        'model_used', 'model_accuracy', 'input_tokens', 'output_tokens',
        'total_tokens', 'cost_inr'
    ]) AS column_name
),
actual_columns AS (
    SELECT 
        table_name,
        column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name IN ('invoices', 'verified_invoices', 'verification_dates', 'verification_amounts')
)

-- Compare and show missing columns
SELECT 
    'invoices' AS table_name,
    column_name AS missing_column
FROM expected_invoices
WHERE column_name NOT IN (
    SELECT column_name FROM actual_columns WHERE table_name = 'invoices'
)

UNION ALL

SELECT 
    'verified_invoices' AS table_name,
    column_name AS missing_column
FROM expected_verified_invoices
WHERE column_name NOT IN (
    SELECT column_name FROM actual_columns WHERE table_name = 'verified_invoices'
)

UNION ALL

SELECT 
    'verification_dates' AS table_name,
    column_name AS missing_column
FROM expected_verification_dates
WHERE column_name NOT IN (
    SELECT column_name FROM actual_columns WHERE table_name = 'verification_dates'
)

UNION ALL

SELECT 
    'verification_amounts' AS table_name,
    column_name AS missing_column
FROM expected_verification_amounts
WHERE column_name NOT IN (
    SELECT column_name FROM actual_columns WHERE table_name = 'verification_amounts'
)

ORDER BY table_name, missing_column;

-- If no rows returned, all columns exist! ✅
