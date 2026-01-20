import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { inventoryAPI } from '../services/inventoryApi';
import { Search, Loader2, ExternalLink, Download, Edit, Save, X, Trash2 } from 'lucide-react';

interface InventoryItem {
    id: number;
    invoice_date: string;
    invoice_number: string;
    part_number: string;
    description: string;
    qty: number;
    rate: number;
    net_bill: number;
    amount_mismatch: number;
    receipt_link: string;
    upload_date?: string;
    verification_status?: string;
    [key: string]: any;
}

interface ValidationError {
    field: string;
    message: string;
}

const VerifyPartsPage: React.FC = () => {
    // Get context from Layout to set header actions
    const { setHeaderActions } = useOutletContext<{ setHeaderActions: (actions: React.ReactNode) => void }>();

    // Filter states
    const [searchTerm, setSearchTerm] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [partNumber, setPartNumber] = useState('');
    const [descriptionFilter, setDescriptionFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('');

    // Edit states
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editedItem, setEditedItem] = useState<InventoryItem | null>(null);
    const [validationErrors, setValidationErrors] = useState<Record<number, ValidationError[]>>({});
    const [isExporting, setIsExporting] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

    // Auto-save refs
    const autoSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const isAutoSavingRef = React.useRef(false);

    const queryClient = useQueryClient();
    const [items, setItems] = useState<InventoryItem[]>([]);

    const { isLoading, error } = useQuery({
        queryKey: ['inventory-all'],
        queryFn: async () => {
            const data = await inventoryAPI.getInventoryItems(true);
            setItems(data?.items || []);
            return data;
        },
    });

    // Warning before navigating away with unsaved changes
    React.useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
                return e.returnValue;
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [hasUnsavedChanges]);

    // Set header actions (Export button)
    React.useEffect(() => {
        setHeaderActions(
            <button
                onClick={handleExport}
                disabled={isExporting}
                className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50"
            >
                <Download className="mr-2" size={16} />
                {isExporting ? 'Exporting...' : 'Export to Excel'}
            </button>
        );

        return () => setHeaderActions(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isExporting]);

    // Update item mutation
    const updateItemMutation = useMutation({
        mutationFn: async ({ id, updates }: { id: number; updates: Record<string, any> }) => {
            return inventoryAPI.updateInventoryItem(id, updates);
        },
        onSuccess: (_data, variables) => {
            // Update local state instead of refetching (row position locking)
            const updatedItems = items.map(item =>
                item.id === variables.id ? { ...item, ...variables.updates } : item
            );
            setItems(updatedItems);

            setEditingId(null);
            setEditedItem(null);
            setValidationErrors({});
            setHasUnsavedChanges(false);
            isAutoSavingRef.current = false;
        },
        onError: (error) => {
            isAutoSavingRef.current = false;
            alert(`Error updating item: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    // Update status mutation
    const updateStatusMutation = useMutation({
        mutationFn: async ({ id, status }: { id: number; status: string }) => {
            return inventoryAPI.updateInventoryItem(id, { verification_status: status });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inventory-all'] });
        },
        onError: (error) => {
            alert(`Error updating status: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    // Delete item mutation
    const deleteItemMutation = useMutation({
        mutationFn: async (itemId: number) => {
            return inventoryAPI.deleteInventoryItem(itemId);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inventory-all'] });
        },
        onError: (error) => {
            alert(`Error deleting item: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    // Validate field value
    const validateField = (field: string, value: any): string | null => {
        if (field === 'qty' || field === 'rate') {
            const num = parseFloat(value);
            if (isNaN(num) || num < 0) {
                return `${field === 'qty' ? 'Quantity' : 'Rate'} must be a positive number`;
            }
        }
        return null;
    };

    // Auto-save function
    const performAutoSave = () => {
        if (!editedItem || editingId === null) return;

        const errors = validationErrors[editedItem.id] || [];
        if (errors.length > 0) {
            // Don't auto-save if there are validation errors
            return;
        }

        // Check if there are actual changes
        const originalItem = items.find(i => i.id === editedItem.id);
        const hasChanges = originalItem && JSON.stringify(editedItem) !== JSON.stringify(originalItem);

        if (hasChanges && !isAutoSavingRef.current) {
            isAutoSavingRef.current = true;

            // Prepare updates
            const updates: Record<string, any> = {};
            Object.keys(editedItem).forEach(key => {
                if (editedItem[key] !== originalItem?.[key]) {
                    updates[key] = editedItem[key];
                }
            });

            if (Object.keys(updates).length > 0) {
                updateItemMutation.mutate({ id: editedItem.id, updates });
            }
        }
    };

    // Clear auto-save timer
    const clearAutoSaveTimer = () => {
        if (autoSaveTimerRef.current) {
            clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = null;
        }
    };


    // Handle edit button click
    const handleEdit = (item: InventoryItem) => {
        setEditingId(item.id);
        setEditedItem({ ...item });
        setValidationErrors(prev => ({ ...prev, [item.id]: [] }));
        setHasUnsavedChanges(false);
        clearAutoSaveTimer();
    };

    // Handle cancel edit
    const handleCancelEdit = () => {
        clearAutoSaveTimer();
        setEditingId(null);
        setEditedItem(null);
        setValidationErrors({});
        setHasUnsavedChanges(false);
    };

    // Handle field change with debounced auto-save
    const handleFieldChange = (field: string, value: any) => {
        if (!editedItem) return;

        const error = validateField(field, value);
        const itemErrors = validationErrors[editedItem.id] || [];

        if (error) {
            // Add or update error
            const newErrors = itemErrors.filter(e => e.field !== field);
            newErrors.push({ field, message: error });
            setValidationErrors(prev => ({ ...prev, [editedItem.id]: newErrors }));
        } else {
            // Remove error if exists
            const newErrors = itemErrors.filter(e => e.field !== field);
            setValidationErrors(prev => ({ ...prev, [editedItem.id]: newErrors }));
        }

        setEditedItem({ ...editedItem, [field]: value });
        setHasUnsavedChanges(true);

        // Clear existing timer
        clearAutoSaveTimer();

        // Set new timer for debounced auto-save (2 seconds)
        autoSaveTimerRef.current = setTimeout(() => {
            performAutoSave();
        }, 2000);
    };

    // Handle save (manual save button)
    const handleSave = () => {
        clearAutoSaveTimer();
        performAutoSave();
    };

    // Handle export
    const handleExport = async () => {
        try {
            setIsExporting(true);
            await inventoryAPI.exportInventoryToExcel({
                search: searchTerm || undefined,
                invoice_number: invoiceNumber || undefined,
                part_number: partNumber || undefined,
                description: descriptionFilter || undefined,
                date_from: dateFrom || undefined,
                date_to: dateTo || undefined,
                status: statusFilter || undefined,
            });
        } catch (error) {
            alert('Export failed. Please try again.');
        } finally {
            setIsExporting(false);
        }
    };

    // Filter and sort items
    const filteredItems = useMemo(() => {
        let filtered = items;

        if (searchTerm) {
            const search = searchTerm.toLowerCase();
            filtered = filtered.filter(item =>
                Object.values(item).some(val =>
                    val?.toString().toLowerCase().includes(search)
                )
            );
        }

        if (dateFrom) {
            filtered = filtered.filter(item =>
                item.invoice_date && item.invoice_date >= dateFrom
            );
        }

        if (dateTo) {
            filtered = filtered.filter(item =>
                item.invoice_date && item.invoice_date <= dateTo
            );
        }

        if (invoiceNumber) {
            filtered = filtered.filter(item =>
                item.invoice_number?.toLowerCase().includes(invoiceNumber.toLowerCase())
            );
        }

        if (partNumber) {
            filtered = filtered.filter(item =>
                item.part_number?.toLowerCase().includes(partNumber.toLowerCase())
            );
        }

        if (descriptionFilter) {
            filtered = filtered.filter(item =>
                item.description?.toLowerCase().includes(descriptionFilter.toLowerCase())
            );
        }

        if (statusFilter) {
            filtered = filtered.filter(item => {
                const status = item.amount_mismatch === 0 ? 'Done' : (item.verification_status || 'Pending');
                return status === statusFilter;
            });
        }

        // Sort by status (Pending first, then Done), then by upload_date descending within each status
        filtered.sort((a, b) => {
            const statusA = a.amount_mismatch === 0 ? 'Done' : (a.verification_status || 'Pending');
            const statusB = b.amount_mismatch === 0 ? 'Done' : (b.verification_status || 'Pending');

            // First sort by status (Pending before Done)
            if (statusA !== statusB) {
                return statusA === 'Pending' ? -1 : 1;
            }

            // Within same status, sort by upload_date descending
            const dateA = a.upload_date ? new Date(a.upload_date).getTime() : 0;
            const dateB = b.upload_date ? new Date(b.upload_date).getTime() : 0;
            return dateB - dateA;
        });

        return filtered;
    }, [items, searchTerm, dateFrom, dateTo, invoiceNumber, partNumber, descriptionFilter, statusFilter]);

    const handleClearFilters = () => {
        setSearchTerm('');
        setDateFrom('');
        setDateTo('');
        setInvoiceNumber('');
        setPartNumber('');
        setDescriptionFilter('');
        setStatusFilter('');
    };

    const handleDelete = (item: InventoryItem) => {
        if (confirm(`Are you sure you want to delete this item: ${item.part_number || item.description}?`)) {
            deleteItemMutation.mutate(item.id);
        }
    };

    const getFieldError = (itemId: number, field: string): string | null => {
        const errors = validationErrors[itemId] || [];
        const error = errors.find(e => e.field === field);
        return error ? error.message : null;
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="animate-spin text-blue-600" size={40} />
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-red-800">Error loading inventory items</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Filters */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Search</label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Search all fields..."
                                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Invoice Number</label>
                        <input
                            type="text"
                            value={invoiceNumber}
                            onChange={(e) => setInvoiceNumber(e.target.value)}
                            placeholder="Filter by invoice #..."
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Part Number</label>
                        <input
                            type="text"
                            value={partNumber}
                            onChange={(e) => setPartNumber(e.target.value)}
                            placeholder="Filter by part #..."
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                        <input
                            type="text"
                            value={descriptionFilter}
                            onChange={(e) => setDescriptionFilter(e.target.value)}
                            placeholder="Filter by description..."
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Invoice Date From</label>
                        <input
                            type="date"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Invoice Date To</label>
                        <input
                            type="date"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                        >
                            <option value="">All Statuses</option>
                            <option value="Pending">Pending</option>
                            <option value="Done">Done</option>
                        </select>
                    </div>

                    <div className="flex items-end">
                        <button
                            onClick={handleClearFilters}
                            className="w-full px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                        >
                            Clear Filters
                        </button>
                    </div>
                </div>
            </div>

            {/* Results */}
            {filteredItems.length === 0 ? (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
                    <p className="text-gray-500">No inventory items found</p>
                </div>
            ) : (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-200">
                        <p className="text-sm text-gray-600">
                            Showing <span className="font-medium">{filteredItems.length}</span> of <span className="font-medium">{items.length}</span> items
                        </p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-20">Actions</th>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-24">Date</th>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-32">Invoice #</th>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-32">Part #</th>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-24">HSN</th>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-16">Qty</th>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-20">Rate</th>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-16">CGST</th>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-16">SGST</th>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-24">Net Bill</th>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-32">Uploaded</th>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-16">Img</th>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-16">Del</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {filteredItems.map((item) => {
                                    const isEditing = editingId === item.id;
                                    const currentItem = isEditing && editedItem ? editedItem : item;

                                    return (
                                        <tr key={item.id} className="hover:bg-gray-50">
                                            {/* Actions */}
                                            <td className="px-2 py-2">
                                                {isEditing ? (
                                                    <div className="flex gap-1">
                                                        <button
                                                            onClick={handleSave}
                                                            className="text-green-600 hover:text-green-800 transition p-1"
                                                            title="Save"
                                                        >
                                                            <Save size={16} />
                                                        </button>
                                                        <button
                                                            onClick={handleCancelEdit}
                                                            className="text-red-600 hover:text-red-800 transition p-1"
                                                            title="Cancel"
                                                        >
                                                            <X size={16} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={() => handleEdit(item)}
                                                        className="text-blue-600 hover:text-blue-800 transition p-1"
                                                        title="Edit"
                                                    >
                                                        <Edit size={16} />
                                                    </button>
                                                )}

                                            </td>

                                            {/* Invoice Date */}
                                            <td className="px-2 py-2 text-xs">
                                                {isEditing ? (
                                                    <input
                                                        type="date"
                                                        value={currentItem.invoice_date || ''}
                                                        onChange={(e) => handleFieldChange('invoice_date', e.target.value)}
                                                        className="w-full px-1 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 text-xs"
                                                    />
                                                ) : (
                                                    <span className="text-gray-900">{item.invoice_date || '—'}</span>
                                                )}
                                            </td>

                                            {/* Invoice Number */}
                                            <td className="px-2 py-2 text-xs">
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={currentItem.invoice_number || ''}
                                                        onChange={(e) => handleFieldChange('invoice_number', e.target.value)}
                                                        className="w-full px-1 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 text-xs"
                                                    />
                                                ) : (
                                                    <span className="text-gray-900 break-all">{item.invoice_number || '—'}</span>
                                                )}
                                            </td>

                                            {/* Part Number */}
                                            <td className="px-2 py-2 text-xs">
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={currentItem.part_number || ''}
                                                        onChange={(e) => handleFieldChange('part_number', e.target.value)}
                                                        className="w-full px-1 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 text-xs"
                                                    />
                                                ) : (
                                                    <span className="text-gray-900 break-all">{item.part_number || '—'}</span>
                                                )}
                                            </td>

                                            {/* Description */}
                                            <td className="px-2 py-2 text-xs">
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={currentItem.description || ''}
                                                        onChange={(e) => handleFieldChange('description', e.target.value)}
                                                        className="w-full px-1 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 text-xs"
                                                    />
                                                ) : (
                                                    <span className="text-gray-900 max-w-[150px] truncate block" title={item.description}>
                                                        {item.description || '—'}
                                                    </span>
                                                )}
                                            </td>

                                            {/* HSN */}
                                            <td className="px-2 py-2 text-xs">
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={currentItem.hsn || ''}
                                                        onChange={(e) => handleFieldChange('hsn', e.target.value)}
                                                        className="w-full px-1 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 text-xs"
                                                    />
                                                ) : (
                                                    <span className="text-gray-900">{item.hsn || '—'}</span>
                                                )}
                                            </td>

                                            {/* Qty */}
                                            <td className="px-2 py-2 text-xs">
                                                {isEditing ? (
                                                    <div className="relative">
                                                        <input
                                                            type="number"
                                                            value={currentItem.qty || ''}
                                                            onChange={(e) => handleFieldChange('qty', e.target.value)}
                                                            className={`w-full px-1 py-1 border rounded focus:ring-1 focus:ring-blue-500 text-xs ${getFieldError(item.id, 'qty') ? 'border-red-500 bg-red-50' : 'border-gray-300'
                                                                }`}
                                                        />
                                                    </div>
                                                ) : (
                                                    <span className="text-gray-900">{item.qty || 0}</span>
                                                )}
                                            </td>

                                            {/* Rate */}
                                            <td className="px-2 py-2 text-xs">
                                                {isEditing ? (
                                                    <div className="relative">
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            value={currentItem.rate || ''}
                                                            onChange={(e) => handleFieldChange('rate', e.target.value)}
                                                            className={`w-full px-1 py-1 border rounded focus:ring-1 focus:ring-blue-500 text-xs ${getFieldError(item.id, 'rate') ? 'border-red-500 bg-red-50' : 'border-gray-300'
                                                                }`}
                                                        />
                                                    </div>
                                                ) : (
                                                    <span className="text-gray-900">₹{item.rate?.toFixed(2) || '0.00'}</span>
                                                )}
                                            </td>

                                            {/* CGST */}
                                            <td className="px-2 py-2 text-xs">
                                                {isEditing ? (
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        value={currentItem.cgst_percent || ''}
                                                        onChange={(e) => handleFieldChange('cgst_percent', e.target.value)}
                                                        className="w-full px-1 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 text-xs"
                                                    />
                                                ) : (
                                                    <span className="text-gray-900">{item.cgst_percent ? `${item.cgst_percent}%` : '—'}</span>
                                                )}
                                            </td>

                                            {/* SGST */}
                                            <td className="px-2 py-2 text-xs">
                                                {isEditing ? (
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        value={currentItem.sgst_percent || ''}
                                                        onChange={(e) => handleFieldChange('sgst_percent', e.target.value)}
                                                        className="w-full px-1 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 text-xs"
                                                    />
                                                ) : (
                                                    <span className="text-gray-900">{item.sgst_percent ? `${item.sgst_percent}%` : '—'}</span>
                                                )}
                                            </td>

                                            {/* Net Bill */}
                                            <td className="px-2 py-2 text-xs font-medium text-gray-900">
                                                ₹{item.net_bill?.toFixed(2) || '0.00'}
                                            </td>

                                            {/* Upload Date */}
                                            <td className="px-2 py-2 text-xs text-gray-600">
                                                {(item.upload_date || item.created_at)
                                                    ? new Date(item.upload_date || item.created_at).toLocaleString('en-IN', {
                                                        year: '2-digit',
                                                        month: 'short',
                                                        day: 'numeric',
                                                        hour: '2-digit',
                                                        minute: '2-digit'
                                                    })
                                                    : '—'}
                                            </td>

                                            {/* Image */}
                                            <td className="px-2 py-2 text-xs">
                                                {item.receipt_link ? (
                                                    <a
                                                        href={item.receipt_link}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-0.5 text-blue-600 hover:text-blue-800 transition"
                                                    >
                                                        <ExternalLink size={14} />
                                                        View
                                                    </a>
                                                ) : (
                                                    <span className="text-gray-400">N/A</span>
                                                )}
                                            </td>

                                            {/* Delete */}
                                            <td className="px-2 py-2 text-xs">
                                                <button
                                                    onClick={() => handleDelete(item)}
                                                    className="text-red-600 hover:text-red-800 transition p-1"
                                                    title="Delete item"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

export default VerifyPartsPage;
