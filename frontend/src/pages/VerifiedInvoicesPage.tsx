import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { verifiedAPI } from '../services/api';
import { Search, Download, Loader2, ExternalLink, Trash2, Edit, Save, X } from 'lucide-react';

interface VerifiedInvoice {
    row_id?: number;
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

    // Refs for auto-save
    const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isAutoSavingRef = useRef(false);

    const queryClient = useQueryClient();

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
            return verifiedAPI.updateSingleRow(record);
        },
        onSuccess: (_data, variables) => {
            // Don't invalidate queries yet - keep row position locked
            // Update local state instead
            const updatedRecords = records.map((r, idx) =>
                idx === editingId ? variables.record : r
            );
            setRecords(updatedRecords);

            // Clear edit state but don't refetch (keeps row in place)
            setEditingId(null);
            setEditedItem(null);
            setValidationErrors({});
            setHasUnsavedChanges(false);
            isAutoSavingRef.current = false;
        },
        onError: (error) => {
            isAutoSavingRef.current = false;
            alert(`Error updating record: ${error instanceof Error ? error.message : 'Unable to update. Please try again.'}`);
        }
    });

    // Delete row mutation
    const deleteRowMutation = useMutation({
        mutationFn: async (record: VerifiedInvoice) => {
            const allRecords = records.filter(r => r.row_id !== record.row_id);
            return verifiedAPI.save(allRecords);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['verified'] });
        },
        onError: (error) => {
            alert(`Error deleting row: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

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
            return;
        }

        // Check if there are actual changes
        const originalItem = records[editingId];
        const hasChanges = JSON.stringify(editedItem) !== JSON.stringify(originalItem);

        if (hasChanges && !isAutoSavingRef.current) {
            isAutoSavingRef.current = true;
            updateRowMutation.mutate({ record: editedItem });
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
        if (confirm('Are you sure you want to delete this row from Verified Invoices?')) {
            deleteRowMutation.mutate(record);
        }
    };

    const getFieldError = (index: number, field: string): string | null => {
        const errors = validationErrors[index] || [];
        const error = errors.find(e => e.field === field);
        return error ? error.message : null;
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Verified Invoices</h1>
                    <p className="text-gray-600 mt-2">
                        View, edit, and export verified invoice data
                        {hasUnsavedChanges && (
                            <span className="ml-2 text-orange-600 text-sm font-medium">
                                • Auto-saving...
                            </span>
                        )}
                    </p>
                </div>
                <button
                    onClick={handleExport}
                    disabled={isExporting}
                    className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50"
                >
                    <Download className="mr-2" size={16} />
                    {isExporting ? 'Exporting...' : 'Export to Excel'}
                </button>
            </div>

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
                    <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                        <p className="text-sm text-gray-600">
                            Showing <span className="font-medium">{records.length}</span> verified records
                        </p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Receipt #</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Vehicle #</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Qty</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rate</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Link</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Upload Date</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Delete</th>
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
                                            {/* Actions */}
                                            <td className="px-4 py-3">
                                                {isEditing ? (
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={handleSave}
                                                            className="text-green-600 hover:text-green-800 transition"
                                                            title="Save"
                                                        >
                                                            <Save size={18} />
                                                        </button>
                                                        <button
                                                            onClick={handleCancelEdit}
                                                            className="text-red-600 hover:text-red-800 transition"
                                                            title="Cancel"
                                                        >
                                                            <X size={18} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={() => handleEdit(record, index)}
                                                        className="text-blue-600 hover:text-blue-800 transition"
                                                        title="Edit"
                                                    >
                                                        <Edit size={18} />
                                                    </button>
                                                )}
                                            </td>

                                            {/* Receipt Number */}
                                            <td className="px-4 py-3 text-sm">
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={currentItem['Receipt Number'] || ''}
                                                        onChange={(e) => handleFieldChange('Receipt Number', e.target.value)}
                                                        className="w-20 px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                                    />
                                                ) : (
                                                    <span className="text-gray-900">{record['Receipt Number'] || '—'}</span>
                                                )}
                                            </td>

                                            {/* Date */}
                                            <td className="px-4 py-3 text-sm">
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={currentItem['Date'] || ''}
                                                        onChange={(e) => handleFieldChange('Date', e.target.value)}
                                                        className="w-28 px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                                        placeholder="DD-MMM-YYYY"
                                                    />
                                                ) : (
                                                    <span className="text-gray-900">{record['Date'] || '—'}</span>
                                                )}
                                            </td>

                                            {/* Customer Name */}
                                            <td className="px-4 py-3 text-sm">
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={currentItem['Customer Name'] || ''}
                                                        onChange={(e) => handleFieldChange('Customer Name', e.target.value)}
                                                        className="w-32 px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                                    />
                                                ) : (
                                                    <span className="text-gray-900">{record['Customer Name'] || '—'}</span>
                                                )}
                                            </td>

                                            {/* Vehicle Number */}
                                            <td className="px-4 py-3 text-sm">
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={currentItem['Car Number'] || currentItem['Vehicle Number'] || ''}
                                                        onChange={(e) => handleFieldChange('Car Number', e.target.value)}
                                                        className="w-28 px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                                    />
                                                ) : (
                                                    <span className="text-gray-900">{record['Car Number'] || record['Vehicle Number'] || '—'}</span>
                                                )}
                                            </td>

                                            {/* Description */}
                                            <td className="px-4 py-3 text-sm">
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={currentItem['Description'] || ''}
                                                        onChange={(e) => handleFieldChange('Description', e.target.value)}
                                                        className="w-40 px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                                    />
                                                ) : (
                                                    <span className="text-gray-900 max-w-xs truncate block" title={record['Description']}>
                                                        {record['Description'] || '—'}
                                                    </span>
                                                )}
                                            </td>

                                            {/* Type */}
                                            <td className="px-4 py-3 text-sm">
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={currentItem['Type'] || ''}
                                                        onChange={(e) => handleFieldChange('Type', e.target.value)}
                                                        className="w-24 px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                                        placeholder="Type"
                                                    />
                                                ) : (
                                                    <span className="text-gray-900">{record['Type'] || '—'}</span>
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
                                                            className={`w-16 px-2 py-1 border rounded focus:ring-2 focus:ring-blue-500 ${getFieldError(index, 'Quantity') ? 'border-red-500 bg-red-50' : 'border-gray-300'
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

                                            {/* Rate */}
                                            <td className="px-4 py-3 text-sm">
                                                {isEditing ? (
                                                    <div>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            value={currentItem['Rate'] || ''}
                                                            onChange={(e) => handleFieldChange('Rate', e.target.value)}
                                                            className={`w-20 px-2 py-1 border rounded focus:ring-2 focus:ring-blue-500 ${getFieldError(index, 'Rate') ? 'border-red-500 bg-red-50' : 'border-gray-300'
                                                                }`}
                                                        />
                                                        {getFieldError(index, 'Rate') && (
                                                            <p className="text-xs text-red-600 mt-1">{getFieldError(index, 'Rate')}</p>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-gray-900">{record['Rate'] || '—'}</span>
                                                )}
                                            </td>

                                            {/* Amount */}
                                            <td className="px-4 py-3 text-sm">
                                                {isEditing ? (
                                                    <div>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            value={currentItem['Amount'] || ''}
                                                            onChange={(e) => handleFieldChange('Amount', e.target.value)}
                                                            className={`w-24 px-2 py-1 border rounded focus:ring-2 focus:ring-blue-500 ${getFieldError(index, 'Amount') ? 'border-red-500 bg-red-50' : 'border-gray-300'
                                                                }`}
                                                        />
                                                        {getFieldError(index, 'Amount') && (
                                                            <p className="text-xs text-red-600 mt-1">{getFieldError(index, 'Amount')}</p>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-gray-900">{record['Amount'] || '—'}</span>
                                                )}
                                            </td>

                                            {/* Receipt Link */}
                                            <td className="px-4 py-3 text-sm">
                                                {record['Receipt Link'] && (
                                                    <a
                                                        href={record['Receipt Link']}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-blue-600 hover:text-blue-800 inline-flex items-center"
                                                    >
                                                        <ExternalLink size={16} />
                                                    </a>
                                                )}
                                            </td>

                                            {/* Upload Date */}
                                            <td className="px-4 py-3 text-sm text-gray-600">
                                                {record['Upload Date']
                                                    ? new Date(record['Upload Date']).toLocaleString('en-IN', {
                                                        year: 'numeric',
                                                        month: 'short',
                                                        day: 'numeric',
                                                        hour: '2-digit',
                                                        minute: '2-digit'
                                                    })
                                                    : '—'}
                                            </td>

                                            {/* Delete */}
                                            <td className="px-4 py-3 text-sm">
                                                <button
                                                    onClick={() => handleDeleteRow(record)}
                                                    className="text-red-600 hover:text-red-800 transition"
                                                    title="Delete row"
                                                >
                                                    <Trash2 size={18} />
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

export default VerifiedInvoicesPage;
