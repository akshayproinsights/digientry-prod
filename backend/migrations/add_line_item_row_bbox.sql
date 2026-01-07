-- Add line_item_row_bbox column to tables
-- Run this in Supabase SQL Editor

ALTER TABLE invoices 
ADD COLUMN IF NOT EXISTS line_item_row_bbox JSONB;

ALTER TABLE verified_invoices 
ADD COLUMN IF NOT EXISTS line_item_row_bbox JSONB;

ALTER TABLE verification_amounts 
ADD COLUMN IF NOT EXISTS line_item_row_bbox JSONB;
