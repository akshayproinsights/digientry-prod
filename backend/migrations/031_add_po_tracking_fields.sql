-- Add tracking fields for invoice matching and PO fulfillment
-- This migration adds fields to track what was received vs what was ordered

-- Add tracking fields to purchase_order_items
ALTER TABLE purchase_order_items
ADD COLUMN IF NOT EXISTS received_qty NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS received_date DATE,
ADD COLUMN IF NOT EXISTS vendor_invoice_number TEXT,
ADD COLUMN IF NOT EXISTS delivery_status TEXT DEFAULT 'pending';

-- Add indexes for efficient lookups when matching invoices
CREATE INDEX IF NOT EXISTS idx_po_items_part_number ON purchase_order_items(part_number);
CREATE INDEX IF NOT EXISTS idx_po_items_vendor_invoice ON purchase_order_items(vendor_invoice_number) WHERE vendor_invoice_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_po_items_delivery_status ON purchase_order_items(delivery_status);

-- Add vendor_invoice_reference to purchase_orders for linking
ALTER TABLE purchase_orders
ADD COLUMN IF NOT EXISTS vendor_invoice_numbers TEXT[], -- Array of matched invoice numbers
ADD COLUMN IF NOT EXISTS delivery_date DATE,
ADD COLUMN IF NOT EXISTS completion_percentage NUMERIC DEFAULT 0;

-- Add index for completion tracking
CREATE INDEX IF NOT EXISTS idx_po_completion ON purchase_orders(completion_percentage) WHERE completion_percentage < 100;

-- Add comments for documentation
COMMENT ON COLUMN purchase_order_items.received_qty IS 'Actual quantity received from vendor (cumulative)';
COMMENT ON COLUMN purchase_order_items.delivery_status IS 'Status: pending, partial, complete, cancelled';
COMMENT ON COLUMN purchase_order_items.vendor_invoice_number IS 'Vendor invoice number for this line item delivery';
COMMENT ON COLUMN purchase_orders.vendor_invoice_numbers IS 'Array of all vendor invoice numbers matched to this PO';
COMMENT ON COLUMN purchase_orders.completion_percentage IS 'Percentage of PO fulfilled (0-100)';
COMMENT ON COLUMN purchase_orders.delivery_date IS 'Date when items were delivered (or latest delivery date if multiple)';

-- Migration complete
SELECT 'PO tracking fields migration completed successfully!' as status;
