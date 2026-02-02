-- Migration to add unique constraint to verified_invoices.row_id
-- Required for ON CONFLICT (row_id) upserts to work

-- First, clean up any existing duplicates (keep the most recently created one)
-- This ensures uniqueness can be enforced
DELETE FROM verified_invoices
WHERE id IN (
    SELECT id
    FROM (
        SELECT id,
               ROW_NUMBER() OVER (partition BY row_id ORDER BY created_at DESC) as r
        FROM verified_invoices
    ) t
    WHERE t.r > 1
);

-- Now add the unique constraint if it doesn't verify exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_constraint 
        WHERE conname = 'verified_invoices_row_id_key' 
        AND conrelid = 'verified_invoices'::regclass
    ) THEN
        ALTER TABLE verified_invoices
        ADD CONSTRAINT verified_invoices_row_id_key UNIQUE (row_id);
    END IF;
END $$;
