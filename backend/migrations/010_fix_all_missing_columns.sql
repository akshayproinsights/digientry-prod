-- Fix missing columns in stock_levels, recalculation_tasks, and inventory_items

-- 1. stock_levels: Add unit_value
ALTER TABLE stock_levels 
ADD COLUMN IF NOT EXISTS unit_value NUMERIC;

-- 2. recalculation_tasks: Add started_at and completed_at
ALTER TABLE recalculation_tasks 
ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- 3. inventory_items: Add qty, invoice_number, amount_mismatch
-- qty (numeric) - used for stock calculation
ALTER TABLE inventory_items 
ADD COLUMN IF NOT EXISTS qty NUMERIC;

-- invoice_number (text) - used for duplicate detection
ALTER TABLE inventory_items 
ADD COLUMN IF NOT EXISTS invoice_number TEXT;

-- amount_mismatch (numeric) - used for validation
ALTER TABLE inventory_items 
ADD COLUMN IF NOT EXISTS amount_mismatch NUMERIC;

-- Add comment to track migration
COMMENT ON TABLE stock_levels IS 'Updated with unit_value column';
