-- Add batch and batch_bbox columns to inventory_items table

-- 1. Add batch column (TEXT)
ALTER TABLE inventory_items 
ADD COLUMN IF NOT EXISTS batch TEXT;

-- 2. Add batch_bbox column (JSONB)
ALTER TABLE inventory_items 
ADD COLUMN IF NOT EXISTS batch_bbox JSONB;

COMMENT ON COLUMN inventory_items.batch IS 'Batch number/code from the invoice line item';
COMMENT ON COLUMN inventory_items.batch_bbox IS 'Bounding box coordinates for the batch number';
