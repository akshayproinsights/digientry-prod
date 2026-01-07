import apiClient from '../lib/api';
import { mapArrayToFrontend, mapArrayToBackend } from '../utils/columnMapping';

export interface LoginCredentials {
    username: string;
    password: string;
}

export interface User {
    username: string;
    r2_bucket: string;
    sheet_id: string;
    dashboard_url?: string;
}

export interface LoginResponse {
    access_token: string;
    token_type: string;
    user: User;
}

// Authentication
export const authAPI = {
    login: async (credentials: LoginCredentials): Promise<LoginResponse> => {
        const response = await apiClient.post('/api/auth/login', {
            username: credentials.username,
            password: credentials.password
        });
        return response.data;
    },

    getMe: async (): Promise<User> => {
        const response = await apiClient.get('/api/auth/me');
        return response.data;
    },

    logout: async (): Promise<void> => {
        await apiClient.post('/api/auth/logout');
        localStorage.removeItem('auth_token');
    },
};

// Upload & Processing
export const uploadAPI = {
    uploadFiles: async (files: File[], onUploadProgress?: (progressEvent: any) => void) => {
        const formData = new FormData();
        files.forEach((file) => {
            formData.append('files', file);
        });

        const response = await apiClient.post('/api/upload/files', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            onUploadProgress: onUploadProgress,
        });
        return response.data;
    },

    processInvoices: async (fileKeys: string[], forceUpload: boolean = false) => {
        const response = await apiClient.post('/api/upload/process', {
            file_keys: fileKeys,
            force_upload: forceUpload,
        });
        return response.data;
    },

    getProcessStatus: async (taskId: string) => {
        const response = await apiClient.get(`/api/upload/process/status/${taskId}`);
        return response.data;
    },

    getFileUrl: async (fileKey: string) => {
        const response = await apiClient.get(`/api/upload/files/view/${encodeURIComponent(fileKey)}`);
        return response.data.url;
    }
};

// Invoices
export const invoicesAPI = {
    getAll: async (params?: { limit?: number; offset?: number }) => {
        const response = await apiClient.get('/api/invoices/', { params });
        // Transform snake_case to Title Case for frontend
        return {
            ...response.data,
            invoices: mapArrayToFrontend(response.data.invoices || [])
        };
    },

    getStats: async () => {
        const response = await apiClient.get('/api/invoices/stats');
        return response.data;
    },
};

// Review
export const reviewAPI = {
    getDates: async () => {
        const response = await apiClient.get('/api/review/dates');
        // Transform snake_case to Title Case for frontend
        return {
            ...response.data,
            records: mapArrayToFrontend(response.data.records || [])
        };
    },

    saveDates: async (records: any[]) => {
        // Transform Title Case to snake_case for backend
        const transformedRecords = mapArrayToBackend(records);
        const response = await apiClient.put('/api/review/dates', { records: transformedRecords });
        return response.data;
    },

    updateSingleDate: async (record: any) => {
        // Transform Title Case to snake_case for backend
        const transformedRecord = mapArrayToBackend([record])[0];
        const response = await apiClient.put('/api/review/dates/update', transformedRecord);
        return response.data;
    },

    getAmounts: async () => {
        const response = await apiClient.get('/api/review/amounts');
        // Transform snake_case to Title Case for frontend
        return {
            ...response.data,
            records: mapArrayToFrontend(response.data.records || [])
        };
    },

    saveAmounts: async (records: any[]) => {
        // Transform Title Case to snake_case for backend
        const transformedRecords = mapArrayToBackend(records);
        const response = await apiClient.put('/api/review/amounts', { records: transformedRecords });
        return response.data;
    },

    updateSingleAmount: async (record: any) => {
        // Transform Title Case to snake_case for backend
        const transformedRecord = mapArrayToBackend([record])[0];
        const response = await apiClient.put('/api/review/amounts/update', transformedRecord);
        return response.data;
    },

    deleteReceipt: async (receiptNumber: string) => {
        const response = await apiClient.delete(`/api/review/receipt/${receiptNumber}`);
        return response.data;
    },

    syncAndFinish: async () => {
        const response = await apiClient.post('/api/review/sync-finish');
        return response.data;
    },

    getSyncMetadata: async () => {
        const response = await apiClient.get('/api/review/sync-metadata');
        return response.data;
    },

    syncAndFinishWithProgress: (onProgress: (event: {
        stage: string;
        percentage: number;
        message: string;
        success?: boolean;
        records_synced?: number;
    }) => void): Promise<void> => {
        return new Promise((resolve, reject) => {
            // Get token from localStorage (same as axios interceptor uses)
            const token = localStorage.getItem('auth_token');

            if (!token) {
                reject(new Error('Not authenticated'));
                return;
            }

            // Pass token as query parameter since EventSource doesn't support headers
            const url = `${import.meta.env.VITE_API_URL}/api/review/sync-finish/stream?token=${encodeURIComponent(token)}`;
            const eventSource = new EventSource(url);

            eventSource.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    onProgress(data);

                    // Close connection on completion or error
                    if (data.stage === 'complete') {
                        eventSource.close();
                        resolve();
                    } else if (data.stage === 'error') {
                        eventSource.close();
                        reject(new Error(data.message));
                    }
                } catch (error) {
                    console.error('Error parsing SSE event:', error);
                    eventSource.close();
                    reject(error);
                }
            };

            eventSource.onerror = (error) => {
                console.error('SSE error:', error);
                eventSource.close();
                reject(new Error('Connection error during sync'));
            };
        });
    },
};

// Verified Invoices
export const verifiedAPI = {
    getAll: async (params?: {
        search?: string;
        date_from?: string;
        date_to?: string;
        receipt_number?: string;
        vehicle_number?: string;
        customer_name?: string;
        description?: string;
        limit?: number;
        offset?: number;
    }) => {
        const response = await apiClient.get('/api/verified/', { params });
        // Transform snake_case to Title Case for frontend
        return {
            ...response.data,
            records: mapArrayToFrontend(response.data.records || [])
        };
    },

    save: async (records: any[]) => {
        // Transform Title Case to snake_case for backend
        const transformedRecords = mapArrayToBackend(records);
        const response = await apiClient.post('/api/verified/save', { records: transformedRecords });
        return response.data;
    },

    updateSingleRow: async (record: any) => {
        // Transform Title Case to snake_case for backend
        const transformedRecord = mapArrayToBackend([record])[0];
        const response = await apiClient.put('/api/verified/update', transformedRecord);
        return response.data;
    },

    export: async (format: 'csv' | 'excel' = 'csv') => {
        const response = await apiClient.get('/api/verified/export', {
            params: { format },
        });
        return response.data;
    },

    exportToExcel: async (filters: {
        search?: string;
        date_from?: string;
        date_to?: string;
        receipt_number?: string;
        vehicle_number?: string;
        customer_name?: string;
        description?: string;
    }) => {
        const response = await apiClient.get('/api/verified/export', {
            params: { ...filters, format: 'excel' },
            responseType: 'blob',
        });

        // Create download link
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `verified_invoices_${new Date().toISOString().split('T')[0]}.xlsx`);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);

        return response.data;
    },
};

// User Configuration
export const configAPI = {
    getConfig: async () => {
        const response = await apiClient.get('/api/config');
        return response.data;
    },

    getColumns: async () => {
        const response = await apiClient.get('/api/config/columns');
        return response.data;
    },
};
