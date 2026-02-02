-- Migration: Add customer_items column to stock_levels
-- This column is used to store the comma-separated list of customer item names mapped to a part

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'stock_levels' 
        AND column_name = 'customer_items'
    ) THEN
        ALTER TABLE stock_levels ADD COLUMN customer_items TEXT;
    END IF;
END $$;

-- Reload schema cache to ensure PostgREST sees the new column
NOTIFY pgrst, 'reload schema';
