-- Add excluded_from_stock column to inventory_items
ALTER TABLE inventory_items
ADD COLUMN IF NOT EXISTS excluded_from_stock BOOLEAN DEFAULT FALSE;

-- Ensure invoice_date exists (just in case)
ALTER TABLE inventory_items
ADD COLUMN IF NOT EXISTS invoice_date TIMESTAMP WITH TIME ZONE;
