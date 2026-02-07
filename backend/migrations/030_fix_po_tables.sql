-- Fix purchase_orders table
ALTER TABLE purchase_orders
ADD COLUMN IF NOT EXISTS notes TEXT,
ADD COLUMN IF NOT EXISTS po_date DATE,
ADD COLUMN IF NOT EXISTS total_items INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_estimated_cost NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
ADD COLUMN IF NOT EXISTS pdf_file_path TEXT;

-- Fix purchase_order_items table
ALTER TABLE purchase_order_items
ADD COLUMN IF NOT EXISTS item_name TEXT,
ADD COLUMN IF NOT EXISTS current_stock NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS reorder_point NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS ordered_qty INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS unit_value NUMERIC,
ADD COLUMN IF NOT EXISTS priority TEXT,
ADD COLUMN IF NOT EXISTS supplier_part_number TEXT,
ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add checking indexes
CREATE INDEX IF NOT EXISTS idx_po_updated_at ON purchase_orders(updated_at);
