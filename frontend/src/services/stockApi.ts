import apiClient from '../lib/api';

export interface StockLevel {
    id: number;
    username: string;
    part_number: string;
    internal_item_name: string;
    vendor_description: string | null;
    customer_items: string | null;  // Comma-separated list of customer items
    customer_items_array?: string[];  // Multi-select from uploaded sheets
    current_stock: number;
    total_in: number;
    total_out: number;
    reorder_point: number;
    uploaded_reorder_point?: number;  // From uploaded sheet
    vendor_rate: number | null;
    customer_rate: number | null;
    unit_value: number;
    total_value: number;
    last_vendor_invoice_date: string | null;
    last_customer_invoice_date: string | null;
    status?: string;
    created_at: string;
    updated_at: string;
    old_stock?: number;  // From uploaded mapping sheet
    has_uploaded_data?: boolean;  // Flag for highlighting
    uploaded_at?: string;  // Timestamp of upload
    priority?: string;
    latest_vendor_rate?: number;  // Latest vendor rate for displaying in Total Value column
}

export interface StockSummary {
    total_stock_value: number;
    low_stock_items: number;
    out_of_stock: number;
    total_items: number;
}

export interface StockAdjustment {
    part_number: string;
    adjustment_type: 'add' | 'subtract' | 'set_absolute';
    quantity: number;
    reason?: string;
}

export interface StockUpdate {
    reorder_point?: number;
    unit_value?: number;
    old_stock?: number;
    priority?: string;
}

export interface StockTransaction {
    id?: string;  // Transaction ID for editing/deleting (UUID)
    type: 'IN' | 'OUT';
    date: string | null;
    invoice_number: string | null;
    description: string;
    quantity: number;
    rate: number | null;
    amount: number;
    receipt_link: string | null;
}

export interface StockHistoryResponse {
    success: boolean;
    part_number: string;
    transactions: StockTransaction[];
    summary: {
        total_in: number;
        total_out: number;
        transaction_count: number;
        old_stock?: number | null;
    };
}

/**
 * Get all stock levels with optional filtering
 */
export const getStockLevels = async (params?: {
    search?: string;
    status_filter?: string;
    priority_filter?: string;
}): Promise<{ items: StockLevel[]; count: number }> => {
    const queryParams = new URLSearchParams();
    if (params?.search) queryParams.append('search', params.search);
    if (params?.status_filter) queryParams.append('status_filter', params.status_filter);
    if (params?.priority_filter) queryParams.append('priority_filter', params.priority_filter);

    // Add cache-busting timestamp to ensure fresh data
    queryParams.append('_t', Date.now().toString());

    const response = await apiClient.get(`/api/stock/levels?${queryParams.toString()}`);
    return response.data;
};

/**
 * Get stock summary statistics
 */
export const getStockSummary = async (): Promise<StockSummary> => {
    const response = await apiClient.get('/api/stock/summary');
    return response.data.summary;
};

/**
 * Trigger stock level recalculation
 */
export const calculateStockLevels = async (): Promise<void> => {
    await apiClient.post('/api/stock/calculate');
};

/**
 * Update a stock level (inline editing)
 */
export const updateStockLevel = async (
    id: number,
    updates: StockUpdate
): Promise<StockLevel> => {
    const response = await apiClient.patch(`/api/stock/levels/${id}`, updates);
    return response.data.item;
};

/**
 * Manual stock adjustment
 */
export const adjustStock = async (
    adjustment: StockAdjustment
): Promise<{ previous_stock: number; new_stock: number }> => {
    const response = await apiClient.post('/api/stock/adjust', adjustment);
    return response.data;
};

/**
 * Get transaction history for a specific part number
 */
export const getStockHistory = async (
    partNumber: string
): Promise<StockHistoryResponse> => {
    const response = await apiClient.get(`/api/stock/history/${encodeURIComponent(partNumber)}`);
    return response.data;
};

/**
 * Update a stock transaction (quantity/rate)
 */
export const updateStockTransaction = async (params: {
    transactionId: string;
    type: 'IN' | 'OUT';
    quantity: number;
    rate?: number;
}): Promise<void> => {
    await apiClient.put(`/api/stock/transaction/${params.transactionId}`, {
        type: params.type,
        quantity: params.quantity,
        rate: params.rate
    });
};

/**
 * Delete a stock transaction
 */
export const deleteStockTransaction = async (params: {
    transactionId: string;
    type: 'IN' | 'OUT';
}): Promise<void> => {
    await apiClient.delete(`/api/stock/transaction/${params.transactionId}`, {
        data: { type: params.type }
    });
};

/**
 * Delete a stock item completely (from stock_levels and vendor_mapping_entries)
 */
export const deleteStockItem = async (partNumber: string): Promise<void> => {
    await apiClient.delete(`/api/stock/item/${encodeURIComponent(partNumber)}`);
};

/**
 * Delete multiple stock items at once
 */
export const deleteBulkStockItems = async (partNumbers: string[]): Promise<{ deleted_count: number }> => {
    const response = await apiClient.delete('/api/stock/items/bulk', {
        data: { part_numbers: partNumbers }
    });
    return response.data;
};
