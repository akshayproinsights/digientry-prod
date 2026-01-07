import apiClient from '../lib/api';

export interface StockLevel {
    id: number;
    username: string;
    part_number: string;
    internal_item_name: string;
    vendor_description: string | null;
    customer_items: string | null;  // Comma-separated list of customer items
    current_stock: number;
    total_in: number;
    total_out: number;
    reorder_point: number;
    vendor_rate: number | null;
    customer_rate: number | null;
    unit_value: number;
    total_value: number;
    last_vendor_invoice_date: string | null;
    last_customer_invoice_date: string | null;
    status?: string;
    created_at: string;
    updated_at: string;
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
}

export interface StockTransaction {
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
    };
}

/**
 * Get all stock levels with optional filtering
 */
export const getStockLevels = async (params?: {
    search?: string;
    status_filter?: string;
}): Promise<{ items: StockLevel[]; count: number }> => {
    const queryParams = new URLSearchParams();
    if (params?.search) queryParams.append('search', params.search);
    if (params?.status_filter) queryParams.append('status_filter', params.status_filter);

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

