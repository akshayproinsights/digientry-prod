import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOutletContext } from 'react-router-dom';
import { verifiedAPI } from '../services/api';
import { Search, Download, Loader2, ExternalLink, Trash2, Edit, X, CheckSquare, Square } from 'lucide-react';
import DeleteConfirmModal from '../components/DeleteConfirmModal';

interface VerifiedInvoice {
    Row_Id?: number;
    'Receipt Number'?: string;
    'Date'?: string;
    'Customer Name'?: string;
    'Car Number'?: string;
    'Vehicle Number'?: string;
    'Description'?: string;
    'Type'?: string;
    'Quantity'?: number | string;
    'Rate'?: number | string;
    'Amount'?: number | string;
    'Receipt Link'?: string;
    'Upload Date'?: string;
    [key: string]: any;
}

interface ValidationError {
    field: string;
    message: string;
}

const VerifiedInvoicesPage: React.FC = () => {
    // Filter states
    const [searchTerm, setSearchTerm] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [receiptNumber, setReceiptNumber] = useState('');
    const [vehicleNumber, setVehicleNumber] = useState('');
    const [customerName, setCustomerName] = useState('');
    const [descriptionFilter, setDescriptionFilter] = useState('');

    // Edit states
    const [records, setRecords] = useState<VerifiedInvoice[]>([]);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editedItem, setEditedItem] = useState<VerifiedInvoice | null>(null);
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
    const [recordToDelete, setRecordToDelete] = useState<VerifiedInvoice | null>(null);

    // Refs for auto-save
    const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isAutoSavingRef = useRef(false);

    const queryClient = useQueryClient();

    // Get context from Layout to set header actions
    const { setHeaderActions } = useOutletContext<{ setHeaderActions: (actions: React.ReactNode) => void }>();

    const { isLoading, error } = useQuery({
        queryKey: ['verified', searchTerm, dateFrom, dateTo, receiptNumber, vehicleNumber, customerName, descriptionFilter],
        queryFn: async () => {
            const data = await verifiedAPI.getAll({
                search: searchTerm || undefined,
                date_from: dateFrom || undefined,
                date_to: dateTo || undefined,
                receipt_number: receiptNumber || undefined,
                vehicle_number: vehicleNumber || undefined,
                customer_name: customerName || undefined,
                description: descriptionFilter || undefined,
            });
            setRecords(data.records || []);
            // Clear selections when data changes due to filters
            setSelectedIds(new Set());
            setIsSelectAllChecked(false);
            return data;
        },
    });

    // Warning before navigating away with unsaved changes
    useEffect(() => {
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

    // Individual row update mutation
    const updateRowMutation = useMutation({
        mutationFn: async ({ record }: { record: VerifiedInvoice }) => {
            setSaveStatus('saving');
            setErrorNotification(null);
            return verifiedAPI.updateSingleRow(record);
        },
        onSuccess: (_data, variables) => {
            // Don't invalidate queries yet - keep row position locked
            // Update local state instead
            const updatedRecords = records.map((r, idx) =>
                idx === editingId ? variables.record : r
            );
            setRecords(updatedRecords);

            // Show saved status
            setSaveStatus('saved');

            // Clear edit state after a brief delay to show "Saved!" message
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
            // Auto-clear error after 5 seconds
            setTimeout(() => setErrorNotification(null), 5000);
        }
    });

    // Delete row mutation - uses the same bulk delete API for single rows
    const deleteRowMutation = useMutation({
        mutationFn: async (rowId: number) => {
            return verifiedAPI.deleteBulk([rowId]);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['verified'] });
        },
        onError: (error) => {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            setErrorNotification(`Failed to delete record: ${errorMsg}`);
            setTimeout(() => setErrorNotification(null), 5000);
        }
    });

    // Bulk delete mutation
    const bulkDeleteMutation = useMutation({
        mutationFn: async (rowIds: number[]) => {
            return verifiedAPI.deleteBulk(rowIds);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['verified'] });
            setSelectedIds(new Set());
            setIsSelectAllChecked(false);
        },
        onError: (error) => {
            alert(`Error deleting records: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    // Set header actions (Export button + Bulk Delete button)
    useEffect(() => {
        setHeaderActions(
            <div className="flex items-center gap-3">
                {selectedIds.size > 0 && (
                    <button
                        onClick={handleBulkDelete}
                        disabled={bulkDeleteMutation.isPending}
                        className="flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition disabled:opacity-50"
                    >
                        <Trash2 className="mr-2" size={16} />
                        {bulkDeleteMutation.isPending ? 'Deleting...' : `Delete Selected (${selectedIds.size})`}
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
    }, [isExporting, selectedIds.size, bulkDeleteMutation.isPending]);

    // Validate field value
    const validateField = (field: string, value: any): string | null => {
        if (field === 'Quantity' || field === 'Rate' || field === 'Amount') {
            const num = parseFloat(value);
            if (isNaN(num) || num < 0) {
                return `${field} must be a positive number`;
            }
        }
        return null;
    };

    // Auto-save function
    const performAutoSave = () => {
        if (!editedItem || editingId === null) return;

        const errors = validationErrors[editingId] || [];
        if (errors.length > 0) {
            // Don't auto-save if there are validation errors
            setErrorNotification('Please fix validation errors before saving.');
            setTimeout(() => setErrorNotification(null), 5000);
            return;
        }

        // Check if there are actual changes
        const originalItem = records[editingId];
        const hasChanges = JSON.stringify(editedItem) !== JSON.stringify(originalItem);

        if (hasChanges && !isAutoSavingRef.current) {
            isAutoSavingRef.current = true;
            updateRowMutation.mutate({ record: editedItem });
        } else if (!hasChanges) {
            // No changes, just exit edit mode
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
    const handleEdit = (record: VerifiedInvoice, index: number) => {
        // Auto-save previous row if editing another one
        if (editingId !== null && editingId !== index && hasUnsavedChanges) {
            performAutoSave();
        }

        setEditingId(index);
        setEditedItem({ ...record });
        setValidationErrors(prev => ({ ...prev, [index]: [] }));
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
        if (!editedItem || editingId === null) return;

        const error = validateField(field, value);
        const itemErrors = validationErrors[editingId] || [];

        if (error) {
            // Add or update error
            const newErrors = itemErrors.filter(e => e.field !== field);
            newErrors.push({ field, message: error });
            setValidationErrors(prev => ({ ...prev, [editingId]: newErrors }));
        } else {
            // Remove error if exists
            const newErrors = itemErrors.filter(e => e.field !== field);
            setValidationErrors(prev => ({ ...prev, [editingId]: newErrors }));
        }

        setEditedItem({ ...editedItem, [field]: value });
        setHasUnsavedChanges(true);
        setSaveStatus('editing');

        // Clear existing timer
        clearAutoSaveTimer();

        // Set new timer for debounced auto-save (10 seconds) - gives user time to finish typing
        autoSaveTimerRef.current = setTimeout(() => {
            performAutoSave();
        }, 10000);
    };

    // Manual save removed - using auto-save only

    // Handle clicking away from a row (blur) - auto-save immediately
    // Row stays in place since we don't refetch data until filters/navigation change
    const handleRowBlur = () => {
        if (hasUnsavedChanges && editingId !== null) {
            clearAutoSaveTimer();
            performAutoSave();
        }
    };

    const handleExport = async () => {
        try {
            setIsExporting(true);
            await verifiedAPI.exportToExcel({
                search: searchTerm || undefined,
                date_from: dateFrom || undefined,
                date_to: dateTo || undefined,
                receipt_number: receiptNumber || undefined,
                vehicle_number: vehicleNumber || undefined,
                customer_name: customerName || undefined,
                description: descriptionFilter || undefined,
            });
        } catch (error) {
            alert('Export failed. Please try again.');
        } finally {
            setIsExporting(false);
        }
    };

    const handleClearFilters = () => {
        setSearchTerm('');
        setDateFrom('');
        setDateTo('');
        setReceiptNumber('');
        setVehicleNumber('');
        setCustomerName('');
        setDescriptionFilter('');
    };

    const handleDeleteRow = async (record: VerifiedInvoice) => {
        if (!record.Row_Id) {
            setErrorNotification('Cannot delete: Record ID is missing');
            setTimeout(() => setErrorNotification(null), 3000);
            return;
        }

        // Show confirmation modal
        setRecordToDelete(record);
        setDeleteType('single');
        setDeleteConfirmOpen(true);
    };

    const confirmDelete = () => {
        if (deleteType === 'single' && recordToDelete?.Row_Id) {
            // Optimistic update: remove from UI immediately
            const originalRecords = [...records];
            setRecords(records.filter(r => r.Row_Id !== recordToDelete.Row_Id));

            // Perform deletion
            deleteRowMutation.mutate(recordToDelete.Row_Id, {
                onError: () => {
                    // Revert optimistic update on error
                    setRecords(originalRecords);
                }
            });
        } else if (deleteType === 'bulk') {
            const idsToDelete = Array.from(selectedIds);

            // Optimistic update: remove from UI immediately
            const originalRecords = [...records];
            setRecords(records.filter(r => !selectedIds.has(r.Row_Id || -1)));
            setSelectedIds(new Set());
            setIsSelectAllChecked(false);

            // Perform deletion
            bulkDeleteMutation.mutate(idsToDelete, {
                onError: () => {
                    // Revert optimistic update on error
                    setRecords(originalRecords);
                    setSelectedIds(new Set(idsToDelete));
                }
            });
        }

        // Close modal
        setDeleteConfirmOpen(false);
        setRecordToDelete(null);
    };

    const handleSelectRow = (rowId: number | undefined) => {
        if (rowId === undefined) return;

        const newSelected = new Set(selectedIds);
        if (newSelected.has(rowId)) {
            newSelected.delete(rowId);
        } else {
            newSelected.add(rowId);
        }
        setSelectedIds(newSelected);

        // Update select all checkbox state
        setIsSelectAllChecked(newSelected.size === records.length && records.length > 0);
    };

    const handleSelectAll = () => {
        if (isSelectAllChecked) {
            // Deselect all
            setSelectedIds(new Set());
            setIsSelectAllChecked(false);
        } else {
            // Select all visible records
            const allIds = new Set(records.map(r => r.Row_Id).filter((id): id is number => id !== undefined));
            setSelectedIds(allIds);
            setIsSelectAllChecked(true);
        }
    };

    const handleBulkDelete = async () => {
        if (selectedIds.size === 0) return;

        // Show confirmation modal
        setDeleteType('bulk');
        setDeleteConfirmOpen(true);
    };

    const getFieldError = (index: number, field: string): string | null => {
        const errors = validationErrors[index] || [];
        const error = errors.find(e => e.field === field);
        return error ? error.message : null;
    };

    // Format date to DD-MM-YYYY (Indian format)
    const formatIndianDate = (dateString: string | undefined): string => {
        if (!dateString) return '—';
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return dateString;
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            return `${day}-${month}-${year}`;
        } catch {
            return dateString;
        }
    };

    // Format currency with ₹ symbol
    const formatCurrency = (value: number | string | undefined): string => {
        if (value === undefined || value === null || value === '') return '—';
        const num = typeof value === 'string' ? parseFloat(value) : value;
        if (isNaN(num)) return '—';
        return `₹${num.toLocaleString('en-IN')}`;
    };

    // Get type badge with icon and color
    const getTypeBadge = (type: string | undefined) => {
        if (!type) return <span className="text-gray-400">—</span>;

        const typeUpper = type.toUpperCase();
        if (typeUpper.includes('PART')) {
            return (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                    <span>📦</span> Part
                </span>
            );
        } else if (typeUpper.includes('LABOUR') || typeUpper.includes('LABOR') || typeUpper.includes('SERVICE')) {
            return (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium bg-orange-100 text-orange-800">
                    <span>🔧</span> Labour
                </span>
            );
        }
        return <span className="text-gray-900">{type}</span>;
    };

    return (
        <div className="space-y-6">
            {/* Filters */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {/* General Search */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Search
                        </label>
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

                    {/* Receipt Number */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Receipt Number
                        </label>
                        <input
                            type="text"
                            value={receiptNumber}
                            onChange={(e) => setReceiptNumber(e.target.value)}
                            placeholder="Filter by receipt #..."
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                        />
                    </div>

                    {/* Vehicle Number */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Vehicle Number
                        </label>
                        <input
                            type="text"
                            value={vehicleNumber}
                            onChange={(e) => setVehicleNumber(e.target.value)}
                            placeholder="Filter by vehicle #..."
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                        />
                    </div>

                    {/* Customer Name */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Customer Name
                        </label>
                        <input
                            type="text"
                            value={customerName}
                            onChange={(e) => setCustomerName(e.target.value)}
                            placeholder="Filter by customer..."
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                        />
                    </div>

                    {/* Description */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Description
                        </label>
                        <input
                            type="text"
                            value={descriptionFilter}
                            onChange={(e) => setDescriptionFilter(e.target.value)}
                            placeholder="Filter by description..."
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                        />
                    </div>

                    {/* Date From */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Date From
                        </label>
                        <input
                            type="date"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                        />
                    </div>

                    {/* Date To */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Date To
                        </label>
                        <input
                            type="date"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                        />
                    </div>

                    {/* Clear Filters */}
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
            {isLoading ? (
                <div className="flex items-center justify-center h-64">
                    <Loader2 className="animate-spin text-blue-600" size={32} />
                </div>
            ) : error ? (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                    Error loading data. Please try again.
                </div>
            ) : records.length === 0 ? (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
                    <p className="text-gray-500">No verified invoices found.</p>
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
                            Showing <span className="font-medium">{records.length}</span> verified records
                        </p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                    <th className="px-4 py-3 text-left">
                                        <button
                                            type="button"
                                            onClick={handleSelectAll}
                                            className="text-gray-600 hover:text-gray-900 transition cursor-pointer p-1"
                                            title={isSelectAllChecked ? "Deselect All" : "Select All"}
                                        >
                                            {isSelectAllChecked ? <CheckSquare size={20} /> : <Square size={20} />}
                                        </button>
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Receipt #</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Vehicle #</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Qty</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rate</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Upload Date</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase sticky right-0 bg-gray-50">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {records.map((record, index) => {
                                    const isEditing = editingId === index;
                                    const currentItem = isEditing && editedItem ? editedItem : record;

                                    return (
                                        <tr
                                            key={index}
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
                                                    type="button"
                                                    onClick={() => handleSelectRow(record.Row_Id)}
                                                    className="text-gray-600 hover:text-gray-900 transition cursor-pointer p-1"
                                                >
                                                    {selectedIds.has(record.Row_Id || -1) ?
                                                        <CheckSquare size={18} /> :
                                                        <Square size={18} />
                                                    }
                                                </button>
                                            </td>

                                            {/* Receipt Number - Clickable link to receipt */}
                                            <td className="px-4 py-3 text-sm">
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={currentItem['Receipt Number'] || ''}
                                                        onChange={(e) => handleFieldChange('Receipt Number', e.target.value)}
                                                        disabled={saveStatus === 'saving'}
                                                        className="w-20 px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                                    />
                                                ) : record['Receipt Link'] ? (
                                                    <a
                                                        href={record['Receipt Link']}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-1"
                                                    >
                                                        {record['Receipt Number'] || '—'}
                                                        <ExternalLink size={14} />
                                                    </a>
                                                ) : (
                                                    <span className="text-gray-900">{record['Receipt Number'] || '—'}</span>
                                                )}
                                            </td>

                                            {/* Date - DD-MM-YYYY format */}
                                            <td className="px-4 py-3 text-sm">
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={currentItem['Date'] || ''}
                                                        onChange={(e) => handleFieldChange('Date', e.target.value)}
                                                        disabled={saveStatus === 'saving'}
                                                        className="w-28 px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                                        placeholder="DD-MM-YYYY"
                                                    />
                                                ) : (
                                                    <span className="text-gray-900">{formatIndianDate(record['Date'])}</span>
                                                )}
                                            </td>

                                            {/* Customer Name */}
                                            <td className="px-4 py-3 text-sm">
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={currentItem['Customer Name'] || ''}
                                                        onChange={(e) => handleFieldChange('Customer Name', e.target.value)}
                                                        disabled={saveStatus === 'saving'}
                                                        className="w-32 px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                                    />
                                                ) : (
                                                    <span className="text-gray-900">{record['Customer Name'] || '—'}</span>
                                                )}
                                            </td>

                                            {/* Vehicle Number - Bold and larger font for visual prominence */}
                                            <td className="px-4 py-3">
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={currentItem['Car Number'] || currentItem['Vehicle Number'] || ''}
                                                        onChange={(e) => handleFieldChange('Car Number', e.target.value)}
                                                        disabled={saveStatus === 'saving'}
                                                        className="w-28 px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed font-bold"
                                                    />
                                                ) : (
                                                    <span className="text-gray-900 font-bold text-base">
                                                        {record['Car Number'] || record['Vehicle Number'] || '—'}
                                                    </span>
                                                )}
                                            </td>

                                            {/* Description */}
                                            <td className="px-4 py-3 text-sm">
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={currentItem['Description'] || ''}
                                                        onChange={(e) => handleFieldChange('Description', e.target.value)}
                                                        disabled={saveStatus === 'saving'}
                                                        className="w-40 px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                                    />
                                                ) : (
                                                    <span className="text-gray-900 max-w-xs truncate block" title={record['Description']}>
                                                        {record['Description'] || '—'}
                                                    </span>
                                                )}
                                            </td>

                                            {/* Type - Color-coded badges */}
                                            <td className="px-4 py-3 text-sm">
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={currentItem['Type'] || ''}
                                                        onChange={(e) => handleFieldChange('Type', e.target.value)}
                                                        disabled={saveStatus === 'saving'}
                                                        className="w-24 px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                                        placeholder="Part/Labour"
                                                    />
                                                ) : (
                                                    getTypeBadge(record['Type'])
                                                )}
                                            </td>

                                            {/* Quantity */}
                                            <td className="px-4 py-3 text-sm">
                                                {isEditing ? (
                                                    <div>
                                                        <input
                                                            type="number"
                                                            step="0.1"
                                                            value={currentItem['Quantity'] || ''}
                                                            onChange={(e) => handleFieldChange('Quantity', e.target.value)}
                                                            disabled={saveStatus === 'saving'}
                                                            className={`w-16 px-2 py-1 border rounded focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed ${getFieldError(index, 'Quantity') ? 'border-red-500 bg-red-50' : 'border-gray-300'
                                                                }`}
                                                        />
                                                        {getFieldError(index, 'Quantity') && (
                                                            <p className="text-xs text-red-600 mt-1">{getFieldError(index, 'Quantity')}</p>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-gray-900">{record['Quantity'] || '—'}</span>
                                                )}
                                            </td>

                                            {/* Rate - with ₹ symbol */}
                                            <td className="px-4 py-3 text-sm">
                                                {isEditing ? (
                                                    <div>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            value={currentItem['Rate'] || ''}
                                                            onChange={(e) => handleFieldChange('Rate', e.target.value)}
                                                            disabled={saveStatus === 'saving'}
                                                            className={`w-20 px-2 py-1 border rounded focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed ${getFieldError(index, 'Rate') ? 'border-red-500 bg-red-50' : 'border-gray-300'
                                                                }`}
                                                        />
                                                        {getFieldError(index, 'Rate') && (
                                                            <p className="text-xs text-red-600 mt-1">{getFieldError(index, 'Rate')}</p>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-gray-900">{formatCurrency(record['Rate'])}</span>
                                                )}
                                            </td>

                                            {/* Amount - with ₹ symbol */}
                                            <td className="px-4 py-3 text-sm">
                                                {isEditing ? (
                                                    <div>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            value={currentItem['Amount'] || ''}
                                                            onChange={(e) => handleFieldChange('Amount', e.target.value)}
                                                            disabled={saveStatus === 'saving'}
                                                            className={`w-24 px-2 py-1 border rounded focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed ${getFieldError(index, 'Amount') ? 'border-red-500 bg-red-50' : 'border-gray-300'
                                                                }`}
                                                        />
                                                        {getFieldError(index, 'Amount') && (
                                                            <p className="text-xs text-red-600 mt-1">{getFieldError(index, 'Amount')}</p>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-gray-900">{formatCurrency(record['Amount'])}</span>
                                                )}
                                            </td>

                                            {/* Upload Date - DD-MM-YYYY format */}
                                            <td className="px-4 py-3 text-sm text-gray-600">
                                                {formatIndianDate(record['Upload Date'])}
                                            </td>

                                            {/* Actions - Sticky column with Edit + Delete side by side */}
                                            <td className="px-4 py-3 text-sm sticky right-0 bg-white">
                                                {isEditing ? (
                                                    <div className="flex items-center gap-2">
                                                        {/* Status Badge */}
                                                        {saveStatus === 'editing' && (
                                                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                                                ✏️ Editing
                                                            </span>
                                                        )}
                                                        {saveStatus === 'saving' && (
                                                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                                                <Loader2 className="animate-spin" size={12} />
                                                                Saving...
                                                            </span>
                                                        )}
                                                        {saveStatus === 'saved' && (
                                                            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                                                ✓ Saved!
                                                            </span>
                                                        )}
                                                        {/* Cancel Button */}
                                                        <button
                                                            onClick={handleCancelEdit}
                                                            disabled={saveStatus === 'saving'}
                                                            className="text-red-600 hover:text-red-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
                                                            title="Cancel"
                                                        >
                                                            <X size={18} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={() => handleEdit(record, index)}
                                                            className="text-blue-600 hover:text-blue-800 transition"
                                                            title="Edit"
                                                        >
                                                            <Edit size={18} />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteRow(record)}
                                                            className="text-red-600 hover:text-red-800 transition"
                                                            title="Delete row"
                                                        >
                                                            <Trash2 size={18} />
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
                    setRecordToDelete(null);
                }}
                onConfirm={confirmDelete}
                title={deleteType === 'single' ? 'Delete This Record?' : 'Delete Selected Records?'}
                message={
                    deleteType === 'single'
                        ? 'Are you sure you want to delete this record? This data will be permanently removed from your system.'
                        : `You are about to delete ${selectedIds.size} records. This data will be permanently removed from your system.`
                }
                itemCount={deleteType === 'bulk' ? selectedIds.size : undefined}
                isDeleting={deleteRowMutation.isPending || bulkDeleteMutation.isPending}
            />
        </div>
    );
};

export default VerifiedInvoicesPage;
