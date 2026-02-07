-- Add missing columns to draft_purchase_orders table
-- Based on routes/purchase_order_routes.py requirements

ALTER TABLE draft_purchase_orders
ADD COLUMN IF NOT EXISTS current_stock NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS item_name TEXT,
ADD COLUMN IF NOT EXISTS reorder_point NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS reorder_qty INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS unit_value NUMERIC,
ADD COLUMN IF NOT EXISTS priority TEXT,
ADD COLUMN IF NOT EXISTS notes TEXT;

-- Verify columns were added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'draft_purchase_orders' AND table_schema = 'public';
