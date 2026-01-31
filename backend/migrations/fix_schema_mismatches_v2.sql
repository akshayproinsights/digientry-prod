-- Migration: Fix Schema Mismatches v2
-- Description: Adds missing columns and tables identified during debugging

-- 1. Add receipt_link to verified_invoices if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'verified_invoices'
        AND column_name = 'receipt_link'
    ) THEN
        ALTER TABLE verified_invoices ADD COLUMN receipt_link text;
    END IF;
END $$;

-- 2. Add accuracy_score to inventory_items if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'inventory_items'
        AND column_name = 'accuracy_score'
    ) THEN
        ALTER TABLE inventory_items ADD COLUMN accuracy_score float;
    END IF;
END $$;

-- 3. Create recalculation_tasks table if it doesn't exist
CREATE TABLE IF NOT EXISTS recalculation_tasks (
    task_id UUID PRIMARY KEY,
    username TEXT NOT NULL,
    status TEXT NOT NULL,
    progress JSONB DEFAULT '{}'::jsonb,
    result JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    error TEXT
);

-- Enable RLS for recalculation_tasks
ALTER TABLE recalculation_tasks ENABLE ROW LEVEL SECURITY;

-- Create policy for recalculation_tasks if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE tablename = 'recalculation_tasks'
        AND policyname = 'Users can view their own tasks'
    ) THEN
        CREATE POLICY "Users can view their own tasks" ON recalculation_tasks
            FOR ALL
            USING (username = current_user_name()); -- Assuming custom function or straightforward text match if auth setup differs
            -- NOTE: Adjust the RLS condition based on your actual auth logic (e.g., auth.uid() or specific column)
    END IF;
END $$;

-- 4. Make r2_file_path nullable in verification_dates
ALTER TABLE verification_dates ALTER COLUMN r2_file_path DROP NOT NULL;

-- 5. Fix verification_amounts missing row_id if necessary (Checking schema cache error)
-- The error "Could not find the 'row_id' column of 'verification_amounts' in the schema cache"
-- suggests the code expects row_id but maybe it's missing or PostgREST cache is stale.
-- Let's ensure it exists just in case.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'verification_amounts'
        AND column_name = 'row_id'
    ) THEN
        ALTER TABLE verification_amounts ADD COLUMN row_id text;
    END IF;
END $$;
