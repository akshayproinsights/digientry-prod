-- ============================================================================
-- COMPLETE DATABASE SCHEMA FOR DIGIENTRY
-- Generated for Dev Environment Setup
-- Date: 2026-01-28
-- ============================================================================
-- This migration creates all necessary tables, indexes, and RLS policies
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/hhgtmkkranfvhkcjcclp/sql
-- ============================================================================

-- ============================================================================
-- SECTION 0: CLEAN SLATE (Drop existing tables if any)
-- ============================================================================
-- WARNING: This will delete all existing data in these tables!
-- Comment out this section if you want to preserve existing data

DROP TABLE IF EXISTS purchase_order_items CASCADE;
DROP TABLE IF EXISTS purchase_orders CASCADE;
DROP TABLE IF EXISTS draft_purchase_orders CASCADE;
DROP TABLE IF EXISTS sync_metadata CASCADE;
DROP TABLE IF EXISTS inventory_mapped CASCADE;
DROP TABLE IF EXISTS inventory_mapping CASCADE;
DROP TABLE IF EXISTS inventory_items CASCADE;
DROP TABLE IF EXISTS stock_levels CASCADE;
DROP TABLE IF EXISTS vendor_mapping_entries CASCADE;
DROP TABLE IF EXISTS verification_amounts CASCADE;
DROP TABLE IF EXISTS verification_dates CASCADE;
DROP TABLE IF EXISTS verified_headers CASCADE;
DROP TABLE IF EXISTS verified_invoices CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS upload_tasks CASCADE;

-- ============================================================================
-- SECTION 1: UPLOAD & TASK MANAGEMENT
-- ============================================================================

-- Upload Tasks Table (for background job tracking)
CREATE TABLE IF NOT EXISTS upload_tasks (
    task_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    username TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    progress JSONB DEFAULT '{}'::jsonb,
    duplicates JSONB DEFAULT '[]'::jsonb,
    errors JSONB DEFAULT '[]'::jsonb,
    current_file TEXT,
    current_index INTEGER DEFAULT 0,
    uploaded_r2_keys JSONB DEFAULT '[]'::jsonb,
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_upload_tasks_username ON upload_tasks(username);
CREATE INDEX IF NOT EXISTS idx_upload_tasks_updated_at ON upload_tasks(updated_at);

-- ============================================================================
-- SECTION 2: INVOICE VERIFICATION & PROCESSING
-- ============================================================================

-- Raw Invoices (pending verification)
CREATE TABLE IF NOT EXISTS invoices (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    username TEXT NOT NULL,
    receipt_number TEXT NOT NULL,
    date DATE,
    customer TEXT,
    vehicle_number TEXT,
    description TEXT,
    amount NUMERIC,
    r2_file_path TEXT NOT NULL,
    image_hash TEXT,
    row_id TEXT NOT NULL,
    header_id TEXT,
    -- Model tracking columns
    model_used TEXT,
    model_accuracy REAL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,
    cost_inr REAL
);

CREATE INDEX IF NOT EXISTS idx_invoices_username ON invoices(username);
CREATE INDEX IF NOT EXISTS idx_invoices_receipt_number ON invoices(username, receipt_number);
CREATE INDEX IF NOT EXISTS idx_invoices_row_id ON invoices(username, row_id);
CREATE INDEX IF NOT EXISTS idx_invoices_image_hash ON invoices(image_hash);

-- Verified Invoices (processed and approved)
CREATE TABLE IF NOT EXISTS verified_invoices (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    username TEXT NOT NULL,
    receipt_number TEXT NOT NULL,
    date DATE,
    description TEXT,
    amount NUMERIC,
    r2_file_path TEXT NOT NULL,
    image_hash TEXT,
    row_id TEXT NOT NULL,
    header_id TEXT,
    -- Bounding box data
    line_item_row_bbox JSONB,
    -- Model tracking columns
    model_used TEXT,
    model_accuracy REAL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,
    cost_inr REAL
);

CREATE INDEX IF NOT EXISTS idx_verified_invoices_username ON verified_invoices(username);
CREATE INDEX IF NOT EXISTS idx_verified_invoices_receipt_number ON verified_invoices(username, receipt_number);
CREATE INDEX IF NOT EXISTS idx_verified_invoices_date ON verified_invoices(date);
CREATE INDEX IF NOT EXISTS idx_verified_invoices_image_hash ON verified_invoices(image_hash);

-- Verified Headers (invoice header information)
CREATE TABLE IF NOT EXISTS verified_headers (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    username TEXT NOT NULL,
    receipt_number TEXT NOT NULL,
    date DATE,
    amount NUMERIC,
    r2_file_path TEXT NOT NULL,
    image_hash TEXT,
    header_id TEXT NOT NULL,
    -- Bounding box data
    date_bbox JSONB,
    receipt_bbox JSONB,
    combined_bbox JSONB
);

CREATE INDEX IF NOT EXISTS idx_verified_headers_username ON verified_headers(username);
CREATE INDEX IF NOT EXISTS idx_verified_headers_receipt_number ON verified_headers(username, receipt_number);
CREATE INDEX IF NOT EXISTS idx_verified_headers_image_hash ON verified_headers(image_hash);

-- Verification Dates (date verification tracking)
CREATE TABLE IF NOT EXISTS verification_dates (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    username TEXT NOT NULL,
    receipt_number TEXT NOT NULL,
    date DATE,
    r2_file_path TEXT NOT NULL,
    image_hash TEXT,
    header_id TEXT,
    verification_status TEXT DEFAULT 'Pending',
    audit_findings TEXT,
    receipt_number_bbox JSONB,
    row_id TEXT,
    upload_date TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    -- Bounding box data
    date_bbox JSONB,
    receipt_bbox JSONB,
    combined_bbox JSONB,
    date_and_receipt_combined_bbox JSONB,
    -- Model tracking columns
    model_used TEXT,
    model_accuracy REAL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,
    cost_inr REAL
);

CREATE INDEX IF NOT EXISTS idx_verification_dates_username ON verification_dates(username);
CREATE INDEX IF NOT EXISTS idx_verification_dates_receipt_number ON verification_dates(username, receipt_number);
CREATE INDEX IF NOT EXISTS idx_verification_dates_image_hash ON verification_dates(image_hash);

-- Verification Amounts (amount verification tracking)
CREATE TABLE IF NOT EXISTS verification_amounts (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    username TEXT NOT NULL,
    receipt_number TEXT NOT NULL,
    amount NUMERIC,
    r2_file_path TEXT NOT NULL,
    image_hash TEXT,
    header_id TEXT,
    verification_status TEXT DEFAULT 'Pending',
    amount_mismatch NUMERIC DEFAULT 0,
    receipt_link TEXT,
    line_item_row_bbox JSONB,
    quantity NUMERIC,
    rate NUMERIC,
    -- Bounding box data
    amount_bbox JSONB,
    receipt_bbox JSONB,
    date_and_receipt_combined_bbox JSONB,
    -- Model tracking columns
    model_used TEXT,
    model_accuracy REAL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,
    cost_inr REAL
);

CREATE INDEX IF NOT EXISTS idx_verification_amounts_username ON verification_amounts(username);
CREATE INDEX IF NOT EXISTS idx_verification_amounts_receipt_number ON verification_amounts(username, receipt_number);
CREATE INDEX IF NOT EXISTS idx_verification_amounts_image_hash ON verification_amounts(image_hash);

-- ============================================================================
-- SECTION 3: INVENTORY MANAGEMENT
-- ============================================================================

-- Inventory Items (master product catalog)
CREATE TABLE IF NOT EXISTS inventory_items (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    username TEXT NOT NULL,
    part_number TEXT NOT NULL,
    description TEXT,
    supplier_name TEXT,
    purchase_price NUMERIC,
    image_hash TEXT,
    UNIQUE(username, part_number)
);

CREATE INDEX IF NOT EXISTS idx_inventory_items_username ON inventory_items(username);
CREATE INDEX IF NOT EXISTS idx_inventory_items_part_number ON inventory_items(username, part_number);

-- Inventory Mapping (invoice-to-inventory mapping)
CREATE TABLE IF NOT EXISTS inventory_mapping (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    username TEXT NOT NULL,
    invoice_description TEXT NOT NULL,
    part_number TEXT NOT NULL,
    UNIQUE(username, invoice_description)
);

CREATE INDEX IF NOT EXISTS idx_inventory_mapping_username ON inventory_mapping(username);

-- Inventory Mapped (mapped invoice items)
CREATE TABLE IF NOT EXISTS inventory_mapped (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    username TEXT NOT NULL,
    receipt_number TEXT NOT NULL,
    row_id TEXT NOT NULL,
    part_number TEXT NOT NULL,
    quantity NUMERIC NOT NULL DEFAULT 1,
    status TEXT DEFAULT 'done',
    UNIQUE(username, receipt_number, row_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_mapped_username ON inventory_mapped(username);
CREATE INDEX IF NOT EXISTS idx_inventory_mapped_receipt ON inventory_mapped(username, receipt_number);

-- ============================================================================
-- SECTION 4: VENDOR MAPPING & STOCK MANAGEMENT
-- ============================================================================

-- Vendor Mapping Entries (vendor-specific part numbers)
CREATE TABLE IF NOT EXISTS vendor_mapping_entries (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    username TEXT NOT NULL,
    vendor_part_number TEXT NOT NULL,
    internal_part_number TEXT NOT NULL,
    description TEXT,
    unit_name TEXT,
    priority TEXT,
    reorder_point NUMERIC DEFAULT 0,
    UNIQUE(username, vendor_part_number)
);

CREATE INDEX IF NOT EXISTS idx_vendor_mapping_username ON vendor_mapping_entries(username);
CREATE INDEX IF NOT EXISTS idx_vendor_mapping_vendor_part ON vendor_mapping_entries(username, vendor_part_number);

-- Stock Levels (current inventory levels)
CREATE TABLE IF NOT EXISTS stock_levels (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    username TEXT NOT NULL,
    part_number TEXT NOT NULL,
    description TEXT,
    on_hand NUMERIC DEFAULT 0,
    old_stock NUMERIC DEFAULT 0,
    purchase_qty NUMERIC DEFAULT 0,
    avg_price NUMERIC,
    priority TEXT,
    reorder_point NUMERIC DEFAULT 0,
    unit_name TEXT,
    image_hash TEXT,
    UNIQUE(username, part_number)
);

CREATE INDEX IF NOT EXISTS idx_stock_levels_username ON stock_levels(username);
CREATE INDEX IF NOT EXISTS idx_stock_levels_part_number ON stock_levels(username, part_number);
CREATE INDEX IF NOT EXISTS idx_stock_levels_priority ON stock_levels(priority);

-- ============================================================================
-- SECTION 5: PURCHASE ORDERS
-- ============================================================================

-- Purchase Orders (finalized POs)
CREATE TABLE IF NOT EXISTS purchase_orders (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    username TEXT NOT NULL,
    po_number TEXT NOT NULL,
    supplier_name TEXT,
    total_amount NUMERIC,
    status TEXT DEFAULT 'pending',
    UNIQUE(username, po_number)
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_username ON purchase_orders(username);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_po_number ON purchase_orders(username, po_number);

-- Purchase Order Items (line items for POs)
CREATE TABLE IF NOT EXISTS purchase_order_items (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    po_id INTEGER REFERENCES purchase_orders(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    part_number TEXT NOT NULL,
    description TEXT,
    quantity NUMERIC NOT NULL,
    unit_price NUMERIC,
    total_price NUMERIC
);

CREATE INDEX IF NOT EXISTS idx_po_items_po_id ON purchase_order_items(po_id);
CREATE INDEX IF NOT EXISTS idx_po_items_username ON purchase_order_items(username);

-- Draft Purchase Orders (items being prepared for PO)
CREATE TABLE IF NOT EXISTS draft_purchase_orders (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    username TEXT NOT NULL,
    part_number TEXT NOT NULL,
    description TEXT,
    quantity NUMERIC NOT NULL,
    unit_price NUMERIC,
    supplier_name TEXT,
    priority TEXT,
    UNIQUE(username, part_number)
);

CREATE INDEX IF NOT EXISTS idx_draft_pos_username ON draft_purchase_orders(username);
CREATE INDEX IF NOT EXISTS idx_draft_pos_part_number ON draft_purchase_orders(username, part_number);

-- ============================================================================
-- SECTION 6: METADATA & SYNC
-- ============================================================================

-- Sync Metadata (last sync timestamps)
CREATE TABLE IF NOT EXISTS sync_metadata (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    username TEXT NOT NULL,
    last_sync_time TIMESTAMP WITH TIME ZONE,
    sync_status TEXT,
    UNIQUE(username)
);

CREATE INDEX IF NOT EXISTS idx_sync_metadata_username ON sync_metadata(username);

-- ============================================================================
-- SECTION 7: ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE upload_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE verified_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE verified_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_amounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_mapped ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_mapping_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE draft_purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_metadata ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only see their own data
-- Note: Service role bypasses RLS, so backend operations work normally

-- Upload Tasks
CREATE POLICY "Users can view their own upload tasks"
ON upload_tasks FOR SELECT
USING (username = current_setting('app.current_user', true));

CREATE POLICY "Service role can manage all upload tasks"
ON upload_tasks FOR ALL
USING (true) WITH CHECK (true);

-- Invoices
CREATE POLICY "Users can view their own invoices"
ON invoices FOR SELECT
USING (username = current_setting('app.current_user', true));

CREATE POLICY "Service role can manage all invoices"
ON invoices FOR ALL
USING (true) WITH CHECK (true);

-- Verified Invoices
CREATE POLICY "Users can view their own verified invoices"
ON verified_invoices FOR SELECT
USING (username = current_setting('app.current_user', true));

CREATE POLICY "Service role can manage all verified invoices"
ON verified_invoices FOR ALL
USING (true) WITH CHECK (true);

-- Verified Headers
CREATE POLICY "Users can view their own verified headers"
ON verified_headers FOR SELECT
USING (username = current_setting('app.current_user', true));

CREATE POLICY "Service role can manage all verified headers"
ON verified_headers FOR ALL
USING (true) WITH CHECK (true);

-- Verification Dates
CREATE POLICY "Users can view their own verification dates"
ON verification_dates FOR SELECT
USING (username = current_setting('app.current_user', true));

CREATE POLICY "Service role can manage all verification dates"
ON verification_dates FOR ALL
USING (true) WITH CHECK (true);

-- Verification Amounts
CREATE POLICY "Users can view their own verification amounts"
ON verification_amounts FOR SELECT
USING (username = current_setting('app.current_user', true));

CREATE POLICY "Service role can manage all verification amounts"
ON verification_amounts FOR ALL
USING (true) WITH CHECK (true);

-- Inventory Items
CREATE POLICY "Users can view their own inventory items"
ON inventory_items FOR SELECT
USING (username = current_setting('app.current_user', true));

CREATE POLICY "Service role can manage all inventory items"
ON inventory_items FOR ALL
USING (true) WITH CHECK (true);

-- Inventory Mapping
CREATE POLICY "Users can view their own inventory mapping"
ON inventory_mapping FOR SELECT
USING (username = current_setting('app.current_user', true));

CREATE POLICY "Service role can manage all inventory mapping"
ON inventory_mapping FOR ALL
USING (true) WITH CHECK (true);

-- Inventory Mapped
CREATE POLICY "Users can view their own inventory mapped"
ON inventory_mapped FOR SELECT
USING (username = current_setting('app.current_user', true));

CREATE POLICY "Service role can manage all inventory mapped"
ON inventory_mapped FOR ALL
USING (true) WITH CHECK (true);

-- Vendor Mapping Entries
CREATE POLICY "Users can view their own vendor mapping"
ON vendor_mapping_entries FOR SELECT
USING (username = current_setting('app.current_user', true));

CREATE POLICY "Service role can manage all vendor mapping"
ON vendor_mapping_entries FOR ALL
USING (true) WITH CHECK (true);

-- Stock Levels
CREATE POLICY "Users can view their own stock levels"
ON stock_levels FOR SELECT
USING (username = current_setting('app.current_user', true));

CREATE POLICY "Service role can manage all stock levels"
ON stock_levels FOR ALL
USING (true) WITH CHECK (true);

-- Purchase Orders
CREATE POLICY "Users can view their own purchase orders"
ON purchase_orders FOR SELECT
USING (username = current_setting('app.current_user', true));

CREATE POLICY "Service role can manage all purchase orders"
ON purchase_orders FOR ALL
USING (true) WITH CHECK (true);

-- Purchase Order Items
CREATE POLICY "Users can view their own PO items"
ON purchase_order_items FOR SELECT
USING (username = current_setting('app.current_user', true));

CREATE POLICY "Service role can manage all PO items"
ON purchase_order_items FOR ALL
USING (true) WITH CHECK (true);

-- Draft Purchase Orders
CREATE POLICY "Users can view their own draft POs"
ON draft_purchase_orders FOR SELECT
USING (username = current_setting('app.current_user', true));

CREATE POLICY "Service role can manage all draft POs"
ON draft_purchase_orders FOR ALL
USING (true) WITH CHECK (true);

-- Sync Metadata
CREATE POLICY "Users can view their own sync metadata"
ON sync_metadata FOR SELECT
USING (username = current_setting('app.current_user', true));

CREATE POLICY "Service role can manage all sync metadata"
ON sync_metadata FOR ALL
USING (true) WITH CHECK (true);

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

SELECT 'Dev database schema migration completed successfully!' as status;
