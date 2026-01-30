
import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { X, Search, Download, Trash2, Loader2, CheckSquare, Square, Save, Edit, ExternalLink } from 'lucide-react';


import { useGlobalStatus } from '../contexts/GlobalStatusContext';
import { inventoryAPI } from '../services/inventoryApi';
import DeleteConfirmModal from '../components/DeleteConfirmModal';

interface InventoryItem {
    id: number;
    invoice_date: string;
    invoice_number: string;
    vendor_name?: string; // New field
    part_number: string;
    description: string;
    qty: number;
    rate: number;
    net_bill: number;
    amount_mismatch: number;
    receipt_link: string;
    upload_date?: string;
    verification_status?: string;
    row_accuracy?: number; // New field
    [key: string]: any;
}

interface ValidationError {
    field: string;
    message: string;
}

const VerifyPartsPage: React.FC = () => {
    const { setInventoryStatus } = useGlobalStatus();

    // Get context from Layout to set header actions
    const { setHeaderActions } = useOutletContext<{ setHeaderActions: (actions: React.ReactNode) => void }>();
    const [searchParams] = useSearchParams();

    // Filter states
    const [searchTerm, setSearchTerm] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [partNumber, setPartNumber] = useState('');
    const [descriptionFilter, setDescriptionFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState(() => {
        // Read from URL parameter if available
        return searchParams.get('status') || '';
    });

    // Edit states
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editedItem, setEditedItem] = useState<InventoryItem | null>(null);
    const [validationErrors, setValidationErrors] = useState<Record<number, ValidationError[]>>({});
    const [isExporting, setIsExporting] = useState(false);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'editing' | 'saving' | 'saved'>('idle');
    const [errorNotification, setErrorNotification] = useState<string | null>(null);

    // Selection states
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [isSelectAllChecked, setIsSelectAllChecked] = useState(false);

    // Delete confirmation states
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [deleteType, setDeleteType] = useState<'single' | 'bulk'>('single');
    const [itemToDelete, setItemToDelete] = useState<InventoryItem | null>(null);

    // Auto-save refs
    const autoSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const isAutoSavingRef = React.useRef(false);

    const queryClient = useQueryClient();
    const [items, setItems] = useState<InventoryItem[]>([]);

    // Clear the "Review/Sync" badge when visiting this page
    // Update Global Status based on pending items
    useEffect(() => {
        // Calculate pending items (amount_mismatch > 0 or status != 'Done')
        // We consider 'Done' as verified/synced for the purpose of the badge count
        const pendingCount = items.filter(i =>
            i.amount_mismatch > 0 || (i.verification_status !== 'Done')
        ).length;

        // Update global status
        // isComplete: false -> Clears the green tick from upload
        // reviewCount: pendingCount -> Updates sidebar badge
        // syncCount: 0 -> Clears any previous completion counts (from upload success)
        setInventoryStatus({
            reviewCount: pendingCount,
            isComplete: false,
            syncCount: 0
        });
    }, [items, setInventoryStatus]);

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

    // Set header actions (Export button and Bulk Delete if items selected)
    React.useEffect(() => {
        setHeaderActions(
            <div className="flex gap-3">
                {selectedIds.size > 0 && (
                    <button
                        onClick={handleBulkDelete}
                        className="flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
                    >
                        <Trash2 className="mr-2" size={16} />
                        Delete Selected ({selectedIds.size})
                    </button>
                )}
                <button
                    onClick={handleExport}
                    disabled={isExporting}
                    className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50"
                >
                    <Download className="mr-2" size={16} />
                    {isExporting ? 'Exporting...' : 'Export to Excel'}
                </button>
            </div>
        );

        return () => setHeaderActions(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isExporting, selectedIds]);

    // Individual item update mutation
    const updateItemMutation = useMutation({
        mutationFn: async ({ id, updates }: { id: number; updates: Record<string, any> }) => {
            setSaveStatus('saving');
            setErrorNotification(null);
            return inventoryAPI.updateInventoryItem(id, updates);
        },
        onSuccess: (_data, variables) => {
            // Update local state to reflect changes without full refetch if possible
            // We keep the editing state open for a moment to show "Saved"

            // Update local items state for immediate feedback
            setItems(prevItems =>
                prevItems.map(item =>
                    item.id === variables.id
                        ? { ...item, ...variables.updates }
                        : item
                )
            );

            setSaveStatus('saved');

            // Clear edit state after a brief delay
            setTimeout(() => {
                setEditingId(null);
                setEditedItem(null);
                setValidationErrors({});
                setHasUnsavedChanges(false);
                setSaveStatus('idle');
                isAutoSavingRef.current = false;
            }, 3000);
        },
        onError: (error) => {
            isAutoSavingRef.current = false;
            setSaveStatus('editing');
            const errorMsg = error instanceof Error ? error.message : 'Unable to update. Please try again.';
            setErrorNotification(errorMsg);
            setTimeout(() => setErrorNotification(null), 5000);
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
            alert(`Error updating status: ${error instanceof Error ? error.message : 'Unknown error'} `);
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
            alert(`Error deleting item: ${error instanceof Error ? error.message : 'Unknown error'} `);
        }
    });

    // Bulk delete mutation
    const bulkDeleteMutation = useMutation({
        mutationFn: async (ids: number[]) => {
            return inventoryAPI.deleteBulkInventoryItems(ids);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inventory-all'] });
        },
        onError: (error) => {
            alert(`Error deleting items: ${error instanceof Error ? error.message : 'Unknown error'} `);
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

        // Required fields
        if (['invoice_number', 'invoice_date', 'part_number'].includes(field)) {
            if (!value || value.toString().trim() === '') {
                const formattedName = field.replace('_', ' ');
                return `${formattedName.charAt(0).toUpperCase() + formattedName.slice(1)} is required`;
            }
        }

        return null;
    };

    // Auto-save function
    const performAutoSave = () => {
        if (!editedItem || editingId === null) return;

        const errors = validationErrors[editingId] || []; // Fix: use editingId key
        if (errors.length > 0) {
            // Don't auto-save if there are validation errors
            setErrorNotification('Please fix validation errors before saving.');
            setTimeout(() => setErrorNotification(null), 5000);
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
                // @ts-ignore - Index signature
                const editedValue = editedItem[key];
                // @ts-ignore - Index signature
                const originalValue = originalItem?.[key];

                if (editedValue !== originalValue) {
                    updates[key] = editedValue;
                }
            });

            if (Object.keys(updates).length > 0) {
                updateItemMutation.mutate({ id: editedItem.id, updates });
            } else {
                // No actual changes logic
                setEditingId(null);
                setEditedItem(null);
                setValidationErrors({});
                setHasUnsavedChanges(false);
                setSaveStatus('idle');
            }
        } else if (!hasChanges) {
            // No changes, just exit
            setEditingId(null);
            setEditedItem(null);
            setValidationErrors({});
            setHasUnsavedChanges(false);
            setSaveStatus('idle');
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
        // Auto-save previous row if editing another one
        if (editingId !== null && editingId !== item.id && hasUnsavedChanges) {
            performAutoSave();
        }

        setEditingId(item.id);
        setEditedItem({ ...item });
        setValidationErrors(prev => ({ ...prev, [item.id]: [] }));
        setHasUnsavedChanges(false);
        setSaveStatus('editing');
        setErrorNotification(null);
        clearAutoSaveTimer();
    };

    // Handle cancel edit
    const handleCancelEdit = () => {
        clearAutoSaveTimer();
        setEditingId(null);
        setEditedItem(null);
        setValidationErrors({});
        setHasUnsavedChanges(false);
        setSaveStatus('idle');
        setErrorNotification(null);
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
        setSaveStatus('editing');

        // Clear existing timer
        clearAutoSaveTimer();

        // Set new timer for debounced auto-save (10 seconds)
        autoSaveTimerRef.current = setTimeout(() => {
            performAutoSave();
        }, 10000);
    };

    // Handle clicking away from a row (blur) - auto-save immediately
    const handleRowBlur = () => {
        if (hasUnsavedChanges && editingId !== null) {
            clearAutoSaveTimer();
            performAutoSave();
        }
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
        // Show confirmation modal
        setItemToDelete(item);
        setDeleteType('single');
        setDeleteConfirmOpen(true);
    };

    const handleSelectRow = (rowId: number) => {
        const newSelected = new Set(selectedIds);
        if (newSelected.has(rowId)) {
            newSelected.delete(rowId);
        } else {
            newSelected.add(rowId);
        }
        setSelectedIds(newSelected);

        // Update select all checkbox state
        setIsSelectAllChecked(newSelected.size === filteredItems.length && filteredItems.length > 0);
    };

    const handleSelectAll = () => {
        if (isSelectAllChecked) {
            // Deselect all
            setSelectedIds(new Set());
            setIsSelectAllChecked(false);
        } else {
            // Select all visible records
            const allIds = new Set(filteredItems.map(item => item.id));
            setSelectedIds(allIds);
            setIsSelectAllChecked(true);
        }
    };

    const handleBulkDelete = () => {
        if (selectedIds.size === 0) return;

        // Show confirmation modal
        setDeleteType('bulk');
        setDeleteConfirmOpen(true);
    };

    const confirmDelete = () => {
        if (deleteType === 'single' && itemToDelete) {
            // Optimistic update: remove from UI immediately
            const originalItems = [...items];
            setItems(items.filter(i => i.id !== itemToDelete.id));

            // Perform deletion
            deleteItemMutation.mutate(itemToDelete.id, {
                onError: () => {
                    // Revert optimistic update on error
                    setItems(originalItems);
                }
            });
        } else if (deleteType === 'bulk') {
            const idsToDelete = Array.from(selectedIds);

            // Optimistic update: remove from UI immediately
            const originalItems = [...items];
            setItems(items.filter(i => !selectedIds.has(i.id)));
            setSelectedIds(new Set());
            setIsSelectAllChecked(false);

            // Perform deletion
            bulkDeleteMutation.mutate(idsToDelete, {
                onError: () => {
                    // Revert optimistic update on error
                    setItems(originalItems);
                    setSelectedIds(new Set(idsToDelete));
                }
            });
        }

        // Close modal
        setDeleteConfirmOpen(false);
        setItemToDelete(null);
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
                    {/* Error Notification */}
                    {errorNotification && (
                        <div className="mx-6 mt-6 bg-red-50 border border-red-300 text-red-800 px-4 py-3 rounded-lg flex items-start gap-3">
                            <span className="text-red-600 font-bold text-lg">⚠</span>
                            <div className="flex-1">
                                <p className="font-medium">Error</p>
                                <p className="text-sm">{errorNotification}</p>
                            </div>
                        </div>
                    )}
                    <div className="px-6 py-4 border-b border-gray-200">

                        <p className="text-sm text-gray-600">
                            Showing <span className="font-medium">{filteredItems.length}</span> of <span className="font-medium">{items.length}</span> items
                        </p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                    <th className="px-4 py-3 text-left w-12">
                                        <button
                                            onClick={handleSelectAll}
                                            className="text-gray-600 hover:text-gray-900 transition cursor-pointer p-1"
                                            title={isSelectAllChecked ? "Deselect all" : "Select all"}
                                        >
                                            {isSelectAllChecked ? <CheckSquare size={18} /> : <Square size={18} />}
                                        </button>
                                    </th>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-32">Invoice #</th>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-24">Date</th>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-32">Vendor</th>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-32">Part #</th>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-24">HSN</th>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-16">Qty</th>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-20">Rate</th>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-16">CGST</th>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-16">SGST</th>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-24">Net Bill</th>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-16">Acc%</th>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-32">Uploaded</th>
                                    <th className="px-2 py-3 text-left text-xs font-medium text-gray-500 uppercase w-24 sticky right-0 bg-gray-50 shadow-sm">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {filteredItems.map((item) => {
                                    const isEditing = editingId === item.id;
                                    const currentItem = isEditing && editedItem ? editedItem : item;

                                    return (
                                        <tr
                                            key={item.id}
                                            className="hover:bg-gray-50"
                                            onBlur={(e) => {
                                                // Only trigger blur if clicking outside the row
                                                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                                    if (isEditing) {
                                                        handleRowBlur();
                                                    }
                                                }
                                            }}
                                        >
                                            {/* Checkbox */}
                                            <td className="px-4 py-3">
                                                <button
                                                    onClick={() => handleSelectRow(item.id)}
                                                    className="text-gray-600 hover:text-gray-900 transition cursor-pointer p-1"
                                                >
                                                    {selectedIds.has(item.id) ? <CheckSquare size={18} /> : <Square size={18} />}
                                                </button>
                                            </td>

                                            {/* Invoice Number */}
                                            <td className="px-2 py-2 text-xs">
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={currentItem.invoice_number || ''}
                                                        onChange={(e) => handleFieldChange('invoice_number', e.target.value)}
                                                        disabled={saveStatus === 'saving'}
                                                        className="w-full px-1 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 text-xs disabled:bg-gray-100 disabled:cursor-not-allowed"
                                                    />
                                                ) : (
                                                    item.receipt_link ? (
                                                        <a
                                                            href={item.receipt_link}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-1"
                                                        >
                                                            {item.invoice_number || '—'}
                                                            <ExternalLink size={14} />
                                                        </a>
                                                    ) : (
                                                        <span className="text-gray-900 break-all">{item.invoice_number || '—'}</span>
                                                    )
                                                )}
                                            </td>

                                            {/* Invoice Date */}
                                            <td className="px-2 py-2 text-xs">
                                                {isEditing ? (
                                                    <input
                                                        type="date"
                                                        value={currentItem.invoice_date || ''}
                                                        onChange={(e) => handleFieldChange('invoice_date', e.target.value)}
                                                        disabled={saveStatus === 'saving'}
                                                        className="w-full px-1 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 text-xs disabled:bg-gray-100 disabled:cursor-not-allowed"
                                                    />
                                                ) : (
                                                    <span className="text-gray-900">{item.invoice_date || '—'}</span>
                                                )}
                                            </td>

                                            {/* Vendor Name */}
                                            <td className="px-2 py-2 text-xs">
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={currentItem.vendor_name || ''}
                                                        onChange={(e) => handleFieldChange('vendor_name', e.target.value)}
                                                        disabled={saveStatus === 'saving'}
                                                        className="w-full px-1 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 text-xs disabled:bg-gray-100 disabled:cursor-not-allowed"
                                                        placeholder="Vendor"
                                                    />
                                                ) : (
                                                    <span className="text-gray-900 font-medium truncate block max-w-[120px]" title={item.vendor_name}>
                                                        {item.vendor_name || '—'}
                                                    </span>
                                                )}
                                            </td>

                                            {/* Part Number */}
                                            <td className="px-2 py-2 text-xs">
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={currentItem.part_number || ''}
                                                        onChange={(e) => handleFieldChange('part_number', e.target.value)}
                                                        disabled={saveStatus === 'saving'}
                                                        className="w-full px-1 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 text-xs disabled:bg-gray-100 disabled:cursor-not-allowed"
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
                                                        disabled={saveStatus === 'saving'}
                                                        className="w-full px-1 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 text-xs disabled:bg-gray-100 disabled:cursor-not-allowed"
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
                                                        disabled={saveStatus === 'saving'}
                                                        className="w-full px-1 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 text-xs disabled:bg-gray-100 disabled:cursor-not-allowed"
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
                                                            disabled={saveStatus === 'saving'}
                                                            className={`w-full px-1 py-1 border rounded focus:ring-1 focus:ring-blue-500 text-xs disabled:bg-gray-100 disabled:cursor-not-allowed ${getFieldError(item.id, 'qty') ? 'border-red-500 bg-red-50' : 'border-gray-300'
                                                                } `}
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
                                                            disabled={saveStatus === 'saving'}
                                                            className={`w-full px-1 py-1 border rounded focus:ring-1 focus:ring-blue-500 text-xs disabled:bg-gray-100 disabled:cursor-not-allowed ${getFieldError(item.id, 'rate') ? 'border-red-500 bg-red-50' : 'border-gray-300'
                                                                } `}
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
                                                        disabled={saveStatus === 'saving'}
                                                        className="w-full px-1 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 text-xs disabled:bg-gray-100 disabled:cursor-not-allowed"
                                                    />
                                                ) : (
                                                    <span className="text-gray-900">{item.cgst_percent ? `${item.cgst_percent}% ` : '—'}</span>
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
                                                        disabled={saveStatus === 'saving'}
                                                        className="w-full px-1 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 text-xs disabled:bg-gray-100 disabled:cursor-not-allowed"
                                                    />
                                                ) : (
                                                    <span className="text-gray-900">{item.sgst_percent ? `${item.sgst_percent}% ` : '—'}</span>
                                                )}
                                            </td>

                                            {/* Net Bill */}
                                            <td className="px-2 py-2 text-xs font-medium text-gray-900">
                                                ₹{item.net_bill?.toFixed(2) || '0.00'}
                                            </td>

                                            {/* Acc% */}
                                            <td className="px-2 py-2 text-xs">
                                                {(() => {
                                                    const acc = item.row_accuracy !== undefined ? item.row_accuracy : (item.accuracy_score || 0);
                                                    let colorClass = 'text-gray-400';
                                                    if (acc >= 90) colorClass = 'text-green-600 font-medium';
                                                    else if (acc >= 70) colorClass = 'text-blue-600';
                                                    else if (acc >= 50) colorClass = 'text-orange-500';
                                                    else if (acc > 0) colorClass = 'text-red-500 font-bold';

                                                    return (
                                                        <span className={colorClass} title={`Confidence: ${acc}% `}>
                                                            {acc > 0 ? `${acc}% ` : '—'}
                                                        </span>
                                                    );
                                                })()}
                                            </td>

                                            {/* Uploaded */}
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

                                            {/* Actions */}
                                            <td className="px-2 py-2 text-xs sticky right-0 bg-white shadow-sm">
                                                {isEditing ? (
                                                    <div className="flex gap-1 items-center">
                                                        {/* Status Badge */}
                                                        {saveStatus === 'editing' && (
                                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-yellow-100 text-yellow-800">
                                                                ✏️
                                                            </span>
                                                        )}
                                                        {saveStatus === 'saving' && (
                                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-800">
                                                                <Loader2 className="animate-spin" size={10} />
                                                            </span>
                                                        )}
                                                        {saveStatus === 'saved' && (
                                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-800">
                                                                ✓
                                                            </span>
                                                        )}
                                                        <button
                                                            onClick={handleCancelEdit}
                                                            disabled={saveStatus === 'saving'}
                                                            className="text-red-600 hover:text-red-800 transition p-1 disabled:opacity-50"
                                                            title="Cancel"
                                                        >
                                                            <X size={16} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="flex gap-1">
                                                        <button
                                                            onClick={() => handleEdit(item)}
                                                            className="text-blue-600 hover:text-blue-800 transition p-1"
                                                            title="Edit"
                                                        >
                                                            <Edit size={16} />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDelete(item)}
                                                            className="text-red-600 hover:text-red-800 transition p-1"
                                                            title="Delete"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            <DeleteConfirmModal
                isOpen={deleteConfirmOpen}
                onClose={() => {
                    setDeleteConfirmOpen(false);
                    setItemToDelete(null);
                }}
                onConfirm={confirmDelete}
                title={deleteType === 'single' ? 'Delete This Item?' : 'Delete Selected Items?'}
                message={
                    deleteType === 'single'
                        ? `Are you sure you want to delete this item: ${itemToDelete?.part_number || itemToDelete?.description}? This data will be permanently removed from your system.`
                        : `You are about to delete ${selectedIds.size} items.This data will be permanently removed from your system.`
                }
                itemCount={deleteType === 'bulk' ? selectedIds.size : undefined}
                isDeleting={deleteItemMutation.isPending || bulkDeleteMutation.isPending}
            />
        </div>
    );
};

export default VerifyPartsPage;
