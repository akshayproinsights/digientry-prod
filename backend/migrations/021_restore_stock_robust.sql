-- Migration to restore stock for 57611M82P10 and ensure it is included in calculations.
-- Using ILIKE to handle potential case/whitespace issues.

-- 1. Un-exclude from inventory_items
UPDATE inventory_items 
SET excluded_from_stock = false 
WHERE part_number ILIKE '%57611M82P10%';

-- 2. Verify we have the mapping (This is just a check, cannot insert if we don't know the exact customer item, but we can verify)
-- If mapping is missing, the OUT transactions won't be calculated.
-- The user should check "My Stock Register" -> "Upload Mapping Sheet" if the mapping is missing.

-- 3. Force update of any existing stock level to ensure it's not "stuck" (Optional, usually recalculation overwrites)
-- But we can't trigger recalculation from SQL easily.

-- Output status for verification (if run in a tool that supports output)
DO $$
DECLARE
    updated_count INTEGER;
BEGIN
    SELECT count(*) INTO updated_count FROM inventory_items WHERE part_number ILIKE '%57611M82P10%' AND excluded_from_stock = false;
    RAISE NOTICE 'Restored % inventory items.', updated_count;
END $$;
