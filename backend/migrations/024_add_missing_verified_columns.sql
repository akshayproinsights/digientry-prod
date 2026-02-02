-- Add missing columns to verified_invoices table
-- Fixes PGRST204 error during sync

ALTER TABLE verified_invoices 
ADD COLUMN IF NOT EXISTS car_number TEXT,
ADD COLUMN IF NOT EXISTS customer_name TEXT,
ADD COLUMN IF NOT EXISTS type TEXT,
ADD COLUMN IF NOT EXISTS quantity NUMERIC,
ADD COLUMN IF NOT EXISTS rate NUMERIC,
ADD COLUMN IF NOT EXISTS receipt_link TEXT,
ADD COLUMN IF NOT EXISTS upload_date TIMESTAMP WITH TIME ZONE;

-- Add indexes for new columns that might be filtered
CREATE INDEX IF NOT EXISTS idx_verified_invoices_car_number ON verified_invoices(username, car_number);
CREATE INDEX IF NOT EXISTS idx_verified_invoices_customer_name ON verified_invoices(username, customer_name);
CREATE INDEX IF NOT EXISTS idx_verified_invoices_upload_date ON verified_invoices(upload_date);

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';
