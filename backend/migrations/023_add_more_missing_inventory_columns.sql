-- 023_add_more_missing_inventory_columns.sql
-- Add remaining missing columns to inventory_items table

-- System / Header columns
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS row_id TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS receipt_link TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS invoice_type TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS vendor_name TEXT;

-- Note: row_id should ideally be unique, but enforcing constraint on existing data might be tricky if duplicates exist.
-- For now, just adding the column.
