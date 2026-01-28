-- Fix missing columns in dev database
-- Run this in Supabase SQL Editor after running 000_complete_schema.sql

-- Add missing columns to invoices table
ALTER TABLE invoices 
ADD COLUMN IF NOT EXISTS customer TEXT,
ADD COLUMN IF NOT EXISTS vehicle_number TEXT,
ADD COLUMN IF NOT EXISTS receipt_link TEXT;

-- Add missing column to draft_purchase_orders table
ALTER TABLE draft_purchase_orders
ADD COLUMN IF NOT EXISTS added_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());

-- Create index on added_at for better sorting performance
CREATE INDEX IF NOT EXISTS idx_draft_pos_added_at ON draft_purchase_orders(added_at);

SELECT 'Missing columns added successfully!' as status;
