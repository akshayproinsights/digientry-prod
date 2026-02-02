/**
 * Inventory API client
 * Handles all inventory-related API calls
 */
import apiClient from '../lib/api';

export const inventoryAPI = {
    /**
     * Upload inventory files
     */
    uploadFiles: async (files: File[], onProgress?: (progressEvent: any) => void) => {
        const formData = new FormData();
        files.forEach((file) => {
            formData.append('files', file);
        });

        const response = await apiClient.post('/api/inventory/upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            onUploadProgress: onProgress,
        });

        return response.data;
    },

    /**
     * Process inventory files
     */
    processInventory: async (fileKeys: string[], forceUpload: boolean = false) => {
        const response = await apiClient.post('/api/inventory/process', {
            file_keys: fileKeys,
            force_upload: forceUpload,
        });
        return response.data;
    },

    /**
     * Get processing status
     */
    getProcessStatus: async (taskId: string) => {
        const response = await apiClient.get(`/api/inventory/status/${taskId}`);
        return response.data;
    },

    /**
     * Get the most recent inventory processing task
     */
    getRecentTask: async () => {
        const response = await apiClient.get('/api/inventory/recent-task');
        return response.data;
    },

    /**
     * Get inventory items with optional filtering
     */
    getInventoryItems: async (showAll: boolean = false) => {
        const response = await apiClient.get('/api/inventory/items', {
            params: { show_all: showAll },
        });
        return response.data;
    },

    /**
     * Update inventory item
     */
    updateInventoryItem: async (itemId: number, updates: Record<string, any>) => {
        const response = await apiClient.patch(`/api/inventory/items/${itemId}`, updates);
        return response.data;
    },

    /**
     * Delete inventory item by ID
     */
    deleteInventoryItem: async (itemId: number) => {
        const response = await apiClient.delete(`/api/inventory/items/${itemId}`);
        return response.data;
    },

    /**
     * Delete multiple inventory items by IDs
     */
    deleteBulkInventoryItems: async (ids: number[]) => {
        const response = await apiClient.post('/api/inventory/items/delete-bulk', { ids });
        return response.data;
    },

    deleteByImageHash: async (imageHash: string) => {
        const response = await apiClient.delete(`/api/inventory/by-hash/${imageHash}`);
        return response.data;
    },

    // Inventory Mapping APIs
    /**
     * Get grouped items from verified_invoices
     */
    getGroupedItems: async (page: number = 1, limit: number = 20, status?: string) => {
        const response = await apiClient.get('/api/inventory-mapping/grouped-items', {
            params: { page, limit, status },
        });
        return response.data;
    },

    /**
     * Get top 5 inventory suggestions for a customer item
     */
    getInventorySuggestions: async (customerItem: string) => {
        const response = await apiClient.get('/api/inventory-mapping/suggestions', {
            params: { customer_item: customerItem },
        });
        return response.data;
    },

    /**
     * Search inventory items
     */
    searchInventory: async (query: string, limit: number = 10) => {
        const response = await apiClient.get('/api/inventory-mapping/search', {
            params: { query, limit },
        });
        return response.data;
    },

    /**
     * Confirm an inventory mapping
     */
    confirmMapping: async (mappingData: {
        customer_item: string;
        grouped_invoice_ids: number[];
        mapped_inventory_item_id: number;
        mapped_inventory_description: string;
    }) => {
        const response = await apiClient.post('/api/inventory-mapping/confirm', mappingData);
        return response.data;
    },

    /**
     * Update mapping status
     */
    updateMappingStatus: async (mappingId: number, status: string) => {
        const response = await apiClient.put(`/api/inventory-mapping/${mappingId}/status`, { status });
        return response.data;
    },

    /**
     * Export filtered inventory items to Excel
     */
    exportInventoryToExcel: async (filters: {
        search?: string;
        invoice_number?: string;
        part_number?: string;
        description?: string;
        date_from?: string;
        date_to?: string;
        status?: string;
    }) => {
        const response = await apiClient.get('/api/inventory/export', {
            params: filters,
            responseType: 'blob',
        });

        // Create download link with proper Excel MIME type
        const blob = new Blob([response.data], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `inventory_export_${new Date().toISOString().split('T')[0]}.xlsx`);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);

        return response.data;
    },

    // ==================== CUSTOMER ITEM MAPPING APIS ====================

    /**
     * Get unmapped customer items with optional search filter
     */
    getUnmappedCustomerItems: async (search?: string) => {
        const params = search ? { search } : {};
        const response = await apiClient.get('/api/inventory-mapping/customer-items/unmapped', { params });
        return response.data;
    },

    /**
     * Get fuzzy match suggestions for a customer item
     */
    getCustomerItemSuggestions: async (customerItem: string) => {
        const response = await apiClient.get('/api/inventory-mapping/customer-items/suggestions', {
            params: { customer_item: customerItem },
        });
        return response.data;
    },

    /**
     * Live search vendor items as user types
     */
    searchVendorItems: async (query: string, limit: number = 20) => {
        const response = await apiClient.get('/api/inventory-mapping/customer-items/search', {
            params: { query, limit },
        });
        return response.data;
    },

    /**
     * Confirm customer item mapping
     */
    confirmCustomerItemMapping: async (data: {
        customer_item: string;
        normalized_description: string;
        vendor_item_id?: number;
        vendor_description?: string;
        vendor_part_number?: string;
        priority?: number;
    }) => {
        const response = await apiClient.post('/api/inventory-mapping/customer-items/confirm', data);
        return response.data;
    },

    /**
     * Skip customer item
     */
    skipCustomerItem: async (customerItem: string) => {
        const response = await apiClient.post('/api/inventory-mapping/customer-items/skip', {
            customer_item: customerItem,
        });
        return response.data;
    },

    /**
     * Sync & Finish all Done mappings
     */
    syncCustomerItemMappings: async () => {
        const response = await apiClient.post('/api/inventory-mapping/customer-items/sync');
        return response.data;
    },

    /**
     * Get mapping stats for progress tracking
     */
    getCustomerItemMappingStats: async () => {
        const response = await apiClient.get('/api/inventory-mapping/customer-items/stats');
        return response.data;
    },
};
