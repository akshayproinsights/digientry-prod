-- One-time cleanup script to standardize historical PO data
-- Run this after the 031_add_po_tracking_fields.sql migration

-- 1. Update all POs that have PDFs as "placed" status
UPDATE purchase_orders 
SET status = 'placed',
    completion_percentage = 0
WHERE pdf_file_path IS NOT NULL 
AND pdf_file_path != ''
AND status = 'draft';

-- 2. Initialize delivery_status for all existing PO items
UPDATE purchase_order_items
SET delivery_status = 'pending',
    received_qty = 0
WHERE delivery_status IS NULL;

-- 3. Show results
SELECT 
    'Cleanup completed!' as message,
    (SELECT COUNT(*) FROM purchase_orders WHERE status = 'placed') as placed_pos,
    (SELECT COUNT(*) FROM purchase_orders WHERE status = 'draft') as draft_pos,
    (SELECT COUNT(*) FROM purchase_order_items WHERE delivery_status = 'pending') as pending_items;
