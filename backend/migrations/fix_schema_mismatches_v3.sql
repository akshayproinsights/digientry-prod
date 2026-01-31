-- Migration: Fix Schema Mismatches v3
-- Description: Fixes remaining schema errors for recalculation and verification

-- 1. Add message column to recalculation_tasks if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'recalculation_tasks'
        AND column_name = 'message'
    ) THEN
        ALTER TABLE recalculation_tasks ADD COLUMN message text;
    END IF;
END $$;

-- 2. Make r2_file_path nullable in verification_amounts
-- The original code logic might insert NULLs here, so we must allow it.
ALTER TABLE verification_amounts ALTER COLUMN r2_file_path DROP NOT NULL;
