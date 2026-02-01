-- Migration to restore excluded stock transactions for part number 57611M82P10
-- This item appears to have been deleted (which excludes transactions) but is still needed.
-- We un-exclude the inventory items to allow them to be picked up by the recalculation logic.

UPDATE inventory_items 
SET excluded_from_stock = false 
WHERE part_number = '57611M82P10';
