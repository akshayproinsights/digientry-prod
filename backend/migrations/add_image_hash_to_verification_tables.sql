-- Migration: Add image_hash column to verification tables for duplicate detection
-- Created: 2026-01-20
-- Purpose: Enable proper duplicate deletion when users choose to replace duplicate invoices

-- Add image_hash to verification_dates table
ALTER TABLE verification_dates 
ADD COLUMN IF NOT EXISTS image_hash TEXT;

-- Add image_hash to verification_amounts table  
ALTER TABLE verification_amounts 
ADD COLUMN IF NOT EXISTS image_hash TEXT;

-- Add comments
COMMENT ON COLUMN verification_dates.image_hash IS 'Image hash for duplicate detection and cleanup';
COMMENT ON COLUMN verification_amounts.image_hash IS 'Image hash for duplicate detection and cleanup';

-- Create indexes for faster duplicate lookups
CREATE INDEX IF NOT EXISTS idx_verification_dates_image_hash ON verification_dates(image_hash);
CREATE INDEX IF NOT EXISTS idx_verification_amounts_image_hash ON verification_amounts(image_hash);
