-- Add manual_adjustment column to stock_levels
ALTER TABLE stock_levels 
ADD COLUMN IF NOT EXISTS manual_adjustment NUMERIC DEFAULT 0;
