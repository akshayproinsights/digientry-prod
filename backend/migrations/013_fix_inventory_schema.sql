-- 013_fix_inventory_schema.sql
-- Add potentially missing columns to inventory_items table

-- Basic columns
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS batch TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS hsn TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS source_file TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS industry_type TEXT;

-- Financial columns
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS rate NUMERIC DEFAULT 0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS amount_mismatch NUMERIC DEFAULT 0;

-- AI Metadata columns
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS accuracy_score NUMERIC;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS row_accuracy NUMERIC;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS model_used TEXT;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS model_accuracy NUMERIC;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS input_tokens INTEGER;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS output_tokens INTEGER;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS total_tokens INTEGER;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS cost_inr NUMERIC;

-- Bounding Box columns (JSONB)
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS part_number_bbox JSONB;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS batch_bbox JSONB;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS description_bbox JSONB;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS hsn_bbox JSONB;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS qty_bbox JSONB;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS rate_bbox JSONB;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS disc_percent_bbox JSONB;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS taxable_amount_bbox JSONB;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS cgst_percent_bbox JSONB;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS sgst_percent_bbox JSONB;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS line_item_row_bbox JSONB;
