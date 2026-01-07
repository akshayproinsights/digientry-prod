-- Migration: Create sync_metadata table
-- This table tracks when users perform Sync & Finish operations
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS sync_metadata (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL,
    sync_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    records_processed INTEGER NOT NULL,
    sync_type TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_sync_metadata_username ON sync_metadata(username);
CREATE INDEX IF NOT EXISTS idx_sync_metadata_timestamp ON sync_metadata(sync_timestamp DESC);

-- Grant permissions (adjust as needed based on your security settings)
-- ALTER TABLE sync_metadata ENABLE ROW LEVEL SECURITY;
