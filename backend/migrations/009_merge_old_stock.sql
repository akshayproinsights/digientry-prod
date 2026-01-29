-- Migration: Merge old_stock into manual_adjustment
-- Description: Adds the value of old_stock to manual_adjustment for every row, then sets old_stock to 0.

UPDATE stock_levels
SET 
  manual_adjustment = COALESCE(manual_adjustment, 0) + COALESCE(old_stock, 0),
  old_stock = 0;
