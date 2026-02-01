/**
 * Dashboard API client
 * Handles dashboard metrics and analytics data fetching
 */
import apiClient from '../lib/api';

export interface RevenueSummary {
    total_revenue: number;
    part_revenue: number;
    labour_revenue: number;
    total_transactions: number;
    date_from: string;
    date_to: string;
}

export interface DailyRevenue {
    date: string;
    total_amount: number;
    part_amount: number;
    labour_amount: number;
}

export interface StockSummary {
    total_stock_value: number;
    low_stock_count: number;
    out_of_stock_count: number;
    below_reorder_count: number;
    total_items: number;
}

export interface StockAlert {
    part_number: string;
    item_name: string;
    current_stock: number;
    reorder_point: number;
    stock_value: number;
    status: string;
    priority?: string;
}

export interface KPICard {
    current_value: number;
    previous_value: number;
    change_percent: number;
    label: string;
    format_type: 'currency' | 'number' | 'count';
}

export interface DailySalesVolume {
    date: string;
    revenue: number;
    volume: number;
    parts_revenue: number;
    labor_revenue: number;
}

export interface InventoryByPriority {
    priority: string;
    total_items: number;
    missing_purchase_items: number;  // NEW: negative stock
    critical_items: number;  // Now only zero stock
    low_items: number;
    healthy_items: number;
    missing_purchase_percentage: number;  // NEW
    critical_percentage: number;
    low_percentage: number;
    healthy_percentage: number;
}

export interface DashboardKPIs {
    total_revenue: KPICard;
    avg_job_value: KPICard;
    inventory_alerts: KPICard;
    pending_actions: KPICard;
}

export interface CriticalItem {
    part_number: string;
    item_name: string;
    current_stock: number;
    reorder_point: number;
    priority: string;
    stock_ratio: number;
    unit_value?: number; // Last buy price
}


export interface InventoryPriorityResponse {
    summary: InventoryByPriority;
    critical_items: CriticalItem[];
}

export const dashboardAPI = {
    /**
     * Get revenue summary for date range
     */
    getRevenueSummary: async (dateFrom?: string, dateTo?: string): Promise<RevenueSummary> => {
        const params = new URLSearchParams();
        if (dateFrom) params.append('date_from', dateFrom);
        if (dateTo) params.append('date_to', dateTo);

        const response = await apiClient.get(`/api/dashboard/revenue-summary?${params.toString()}`);
        return response.data;
    },

    /**
     * Get daily revenue trends
     */
    getRevenueTrends: async (dateFrom?: string, dateTo?: string): Promise<DailyRevenue[]> => {
        const params = new URLSearchParams();
        if (dateFrom) params.append('date_from', dateFrom);
        if (dateTo) params.append('date_to', dateTo);

        const response = await apiClient.get(`/api/dashboard/revenue-trends?${params.toString()}`);
        return response.data;
    },

    /**
     * Get stock summary statistics
     */
    getStockSummary: async (): Promise<StockSummary> => {
        const response = await apiClient.get('/api/dashboard/stock-summary');
        return response.data;
    },

    /**
     * Get stock alerts (items below reorder point)
     */
    getStockAlerts: async (limit: number = 10): Promise<StockAlert[]> => {
        const response = await apiClient.get(`/api/dashboard/stock-alerts?limit=${limit}`);
        return response.data;
    },

    /**
     * Get raw stock levels list
     */
    getStockLevels: async (): Promise<{ success: boolean; items: any[]; count: number }> => {
        const response = await apiClient.get('/api/stock/levels');
        return response.data;
    },

    /**
     * Get all KPIs with period comparisons
     */
    getKPIs: async (
        dateFrom?: string,
        dateTo?: string,
        customerName?: string,
        vehicleNumber?: string,
        partNumber?: string
    ): Promise<DashboardKPIs> => {
        const params = new URLSearchParams();
        if (dateFrom) params.append('date_from', dateFrom);
        if (dateTo) params.append('date_to', dateTo);
        if (customerName) params.append('customer_name', customerName);
        if (vehicleNumber) params.append('vehicle_number', vehicleNumber);
        if (partNumber) params.append('part_number', partNumber);

        const response = await apiClient.get(`/api/dashboard/kpis?${params.toString()}`);
        return response.data;
    },

    /**
     * Get daily sales revenue and volume
     */
    getDailySalesVolume: async (
        dateFrom?: string,
        dateTo?: string,
        customerName?: string,
        vehicleNumber?: string,
        partNumber?: string
    ): Promise<DailySalesVolume[]> => {
        const params = new URLSearchParams();
        if (dateFrom) params.append('date_from', dateFrom);
        if (dateTo) params.append('date_to', dateTo);
        if (customerName) params.append('customer_name', customerName);
        if (vehicleNumber) params.append('vehicle_number', vehicleNumber);
        if (partNumber) params.append('part_number', partNumber);

        const response = await apiClient.get(`/api/dashboard/daily-sales-volume?${params.toString()}`);
        return response.data;
    },

    /**
     * Get inventory statistics by priority
     */
    getInventoryByPriority: async (priority?: string): Promise<InventoryPriorityResponse> => {
        const params = new URLSearchParams();
        if (priority) params.append('priority', priority);

        const response = await apiClient.get(`/api/dashboard/inventory-by-priority?${params.toString()}`);
        return response.data;
    },

    /**
     * Get customer name suggestions for autocomplete
     */
    getCustomerSuggestions: async (query: string): Promise<string[]> => {
        const params = new URLSearchParams();
        params.append('q', query);
        params.append('limit', '10');

        const response = await apiClient.get(`/api/dashboard/autocomplete/customers?${params.toString()}`);
        return response.data;
    },

    /**
     * Get vehicle number suggestions for autocomplete
     */
    getVehicleSuggestions: async (query: string): Promise<string[]> => {
        const params = new URLSearchParams();
        params.append('q', query);
        params.append('limit', '10');

        const response = await apiClient.get(`/api/dashboard/autocomplete/vehicles?${params.toString()}`);
        return response.data;
    },

    /**
     * Get part number suggestions for autocomplete
     */
    getPartSuggestions: async (query: string): Promise<string[]> => {
        const params = new URLSearchParams();
        params.append('q', query);
        params.append('limit', '10');

        const response = await apiClient.get(`/api/dashboard/autocomplete/parts?${params.toString()}`);
        return response.data;
    },

    /**
     * Search all inventory items by name or part number
     */
    searchInventory: async (query: string, limit: number = 100): Promise<{
        query: string;
        total_matches: number;
        returned_count: number;
        items: CriticalItem[];
    }> => {
        const params = new URLSearchParams();
        params.append('q', query);
        params.append('limit', limit.toString());

        const response = await apiClient.get(`/api/dashboard/inventory-search?${params.toString()}`);
        return response.data;
    },

    /**
     * Update stock value for an item
     */
    updateStock: async (partNumber: string, newStock: number): Promise<{ success: boolean; status_corrected?: boolean; message?: string }> => {
        const response = await apiClient.patch('/api/dashboard/update-stock', {
            part_number: partNumber,
            new_stock: newStock
        });
        return response.data;
    },
};

