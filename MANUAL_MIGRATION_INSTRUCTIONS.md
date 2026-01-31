# Manual Database Migration Required

The automated migration scripts are failing because the helper function `exec_sql` is missing from your Supabase database. This function is required for the Python backend to execute schema changes (DDL).

## Steps to Fix

1.  **Open Supabase SQL Editor**
    -   Go to your Supabase project dashboard: [https://supabase.com/dashboard/project/hhgtmkkranfvhkcjcclp/sql](https://supabase.com/dashboard/project/hhgtmkkranfvhkcjcclp/sql)
    -   Click "New Query".

2.  **Enable SQL Execution Helper (Run First)**
    -   Copy the content from `backend/migrations/setup_rpc.sql`.
    -   Paste it into the SQL Editor and click **Run**.
    -   *This installs the `exec_sql` function.*

3.  **Apply Schema Fixes (Run Second)**
    -   Copy the content from `backend/migrations/010_fix_all_missing_columns.sql`.
    -   Paste it into the SQL Editor and click **Run**.
    -   *This adds the missing columns: `unit_value`, `started_at`, `qty`, etc.*

## Verification
After running these two scripts manually, you can return here and I can verify the backend is working correctly.
