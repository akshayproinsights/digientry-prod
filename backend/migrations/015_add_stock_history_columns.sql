-- Migration to add missing stock history columns to stock_levels and inventory_items
-- Required for stock recalculation to work correctly

-- 1. stock_levels: Add tracking columns for rates and dates
ALTER TABLE stock_levels 
ADD COLUMN IF NOT EXISTS vendor_rate NUMERIC,
ADD COLUMN IF NOT EXISTS customer_rate NUMERIC,
ADD COLUMN IF NOT EXISTS last_vendor_invoice_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS last_customer_invoice_date TIMESTAMP WITH TIME ZONE;

-- 2. inventory_items: Add invoice_date if missing (used for IN transaction date)
ALTER TABLE inventory_items
ADD COLUMN IF NOT EXISTS invoice_date TIMESTAMP WITH TIME ZONE;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_inventory_items_invoice_date ON inventory_items(invoice_date);
CREATE INDEX IF NOT EXISTS idx_stock_levels_last_vendor_date ON stock_levels(last_vendor_invoice_date);
