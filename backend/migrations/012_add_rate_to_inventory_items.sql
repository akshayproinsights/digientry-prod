-- Add rate column to inventory_items
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS rate NUMERIC DEFAULT 0;
