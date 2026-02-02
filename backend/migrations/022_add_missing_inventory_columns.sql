-- 022_add_missing_inventory_columns.sql
-- Add missing financial columns to inventory_items table

-- Percentages and Base Amounts
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS disc_percent NUMERIC DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS taxable_amount NUMERIC DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS cgst_percent NUMERIC DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS sgst_percent NUMERIC DEFAULT 0;

-- Calculated Totals
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS discounted_price NUMERIC DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS taxed_amount NUMERIC DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS net_bill NUMERIC DEFAULT 0;
