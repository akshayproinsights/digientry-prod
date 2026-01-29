/**
 * Vendor Mapping API client
 * Handles PDF export data, image upload, Gemini extraction, and entry management
 */
import apiClient from '../lib/api';

export interface VendorMappingExportItem {
    row_number: number;
    vendor_description: string;
    part_number: string | null;
    customer_item_name: string | null;
    stock: number | null;
    reorder: number | null;
    notes: string | null;
}

export interface CustomerItemSearchResult {
    customer_item: string;
}

export interface VendorMappingEntry {
    id?: number;
    row_number: number;
    vendor_description: string;
    part_number?: string | null;
    customer_item_name?: string | null;
    stock?: number | null;
    reorder?: number | null;
    notes?: string | null;
    status: 'Pending' | 'Skip' | 'Mark as Done';
    source_image_url?: string;
    extracted_at?: string;
    created_at?: string;
    updated_at?: string;
    system_qty?: number | null; // Added
    variance?: number | null;   // Added
}

export interface ExtractedRow {
    row_number: number;
    vendor_description: string;
    part_number?: string | null;
    stock?: number | null;
    reorder?: number | null;
    notes?: string | null;
    confidence: number;
    system_qty?: number | null; // Added
    variance?: number | null;   // Added
}

export const vendorMappingAPI = {
    /**
     * Get unique vendor items for PDF export
     */
    getExportData: async (): Promise<{ items: VendorMappingExportItem[]; total: number }> => {
        const response = await apiClient.get('/api/vendor-mapping/export-data');
        return response.data;
    },

    /**
     * Upload scanned mapping sheet to R2
     */
    uploadScan: async (file: File, onProgress?: (progressEvent: any) => void): Promise<{
        success: boolean;
        filename: string;
        key: string;
        url: string;
    }> => {
        const formData = new FormData();
        formData.append('file', file);

        const response = await apiClient.post('/api/vendor-mapping/upload-scan', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            onUploadProgress: onProgress,
        });

        return response.data;
    },

    /**
     * Upload multiple scanned mapping sheets (Bulk)
     */
    uploadScans: async (files: File[], onProgress?: (progressEvent: any) => void): Promise<{
        success: boolean;
        uploaded_files: string[];
        message: string;
    }> => {
        const formData = new FormData();
        files.forEach(file => formData.append('files', file));

        const response = await apiClient.post('/api/vendor-mapping/upload-scans', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            onUploadProgress: onProgress,
        });

        return response.data;
    },

    /**
     * Start background processing for uploaded scans
     */
    processScans: async (fileKeys: string[]): Promise<{
        task_id: string;
        status: string;
        message: string;
    }> => {
        const response = await apiClient.post('/api/vendor-mapping/process-scans', {
            file_keys: fileKeys
        });
        return response.data;
    },

    /**
     * Get processing status
     */
    getProcessStatus: async (taskId: string): Promise<{
        task_id: string;
        status: string;
        progress: any;
        message: string;
        rows: ExtractedRow[];
    }> => {
        const response = await apiClient.get(`/api/vendor-mapping/process/status/${taskId}`);
        return response.data;
    },


    /**
     * Extract handwritten data from scanned image using Gemini
     */
    extractFromImage: async (imageUrl: string): Promise<{
        success: boolean;
        data: { rows: ExtractedRow[] };
        source_image_url: string;
    }> => {
        const response = await apiClient.post('/api/vendor-mapping/extract', null, {
            params: { image_url: imageUrl },
        });
        return response.data;
    },

    /**
     * Get all vendor mapping entries
     */
    getEntries: async (status?: string): Promise<{
        entries: VendorMappingEntry[];
        total: number;
    }> => {
        const params = status ? { status } : {};
        const response = await apiClient.get('/api/vendor-mapping/entries', { params });
        return response.data;
    },

    /**
     * Update a single vendor mapping entry
     */
    updateEntry: async (entryId: number, updates: {
        stock?: number | null;
        reorder?: number | null;
        notes?: string | null;
        status?: string;
    }): Promise<{ success: boolean; entry: VendorMappingEntry }> => {
        const response = await apiClient.put(`/api/vendor-mapping/entries/${entryId}`, updates);
        return response.data;
    },

    /**
     * Bulk save extracted entries to database
     */
    bulkSaveEntries: async (entries: VendorMappingEntry[], sourceImageUrl?: string): Promise<{
        success: boolean;
        saved_count: number;
        errors: Array<{ row_number: number; error: string }>;
    }> => {
        const response = await apiClient.post('/api/vendor-mapping/entries/bulk-save', {
            entries,
            source_image_url: sourceImageUrl,
        });
        return response.data;
    },

    /**
     * Delete a vendor mapping entry
     */
    deleteEntry: async (entryId: number): Promise<{ success: boolean }> => {
        const response = await apiClient.delete(`/api/vendor-mapping/entries/${entryId}`);
        return response.data;
    },

    /**
     * Search customer items from verified_invoices for autocomplete
     * Returns ALL unique items for the user (no limit)
     */
    searchCustomerItems: async (query: string = ""): Promise<{
        items: Array<{ customer_item: string }>;
    }> => {
        const response = await apiClient.get('/api/vendor-mapping/customer-items/search', {
            params: { query },
        });
        return response.data;
    },
};
