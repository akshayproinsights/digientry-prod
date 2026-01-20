import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { reviewAPI } from '../services/api';
import { RefreshCw, Loader2, Trash2 } from 'lucide-react';
import CroppedFieldPreview from '../components/CroppedFieldPreview';
import StatusToggle from '../components/StatusToggle';
import SyncProgressModal from '../components/SyncProgressModal';

const ReviewInvoiceDetailsPage: React.FC = () => {
    const [records, setRecords] = useState<any[]>([]);
    const [showCompleted, setShowCompleted] = useState(false); // Default: show only pending
    const [syncProgress, setSyncProgress] = useState({
        isOpen: false,
        stage: '',
        percentage: 0,
        message: ''
    });
    const queryClient = useQueryClient();

    const saveTimeoutRef = React.useRef<number | null>(null);
    const refetchDelayRef = React.useRef<number | null>(null); // Delay refetch to avoid interrupting user

    // Track field states: 'idle' | 'editing' | 'saving' | 'saved' | 'error'
    // Map structure: rowId -> fieldName -> state
    const [fieldStates, setFieldStates] = useState<{ [key: string]: { [key: string]: string } }>({});

    // Track in-progress edit values that shouldn't be overwritten by refetches
    // Map structure: rowId -> fieldName -> value
    const [editValues, setEditValues] = useState<{ [key: string]: { [key: string]: string } }>({});

    // Get the current value for a field, preferring local edit value over records value
    const getFieldValue = (globalIdx: number, field: string, rowId: string) => {
        // If we have a local edit value, use it
        if (editValues[rowId]?.[field] !== undefined) {
            return editValues[rowId][field];
        }
        // Otherwise use the records value
        return records[globalIdx]?.[field] || '';
    };

    // Set a local edit value
    const setEditValue = (rowId: string, field: string, value: string) => {
        setEditValues(prev => ({
            ...prev,
            [rowId]: {
                ...prev[rowId],
                [field]: value
            }
        }));
    };

    // Clear a local edit value (after save completes)
    const clearEditValue = (rowId: string, field: string) => {
        setEditValues(prev => {
            const newState = { ...prev };
            if (newState[rowId]) {
                const { [field]: _, ...rest } = newState[rowId];
                if (Object.keys(rest).length === 0) {
                    delete newState[rowId];
                } else {
                    newState[rowId] = rest;
                }
            }
            return newState;
        });
    };


    // Helper function to get border color based on field state
    const getFieldBorderClass = (rowId: string, fieldName: string, hasError: boolean = false) => {
        const state = fieldStates[rowId]?.[fieldName] || 'idle';

        if (hasError) {
            return 'border-red-500 bg-red-50';
        }

        switch (state) {
            case 'editing':
                return 'border-yellow-400 border-2 bg-yellow-50';
            case 'saving':
                return 'border-blue-400 border-2 bg-blue-50';
            case 'saved':
                return 'border-green-400 border-2 bg-green-50';
            case 'error':
                return 'border-red-500 border-2 bg-red-50';
            default:
                return 'border-gray-300';
        }
    };

    // Update field state
    const updateFieldState = (rowId: string, fieldName: string, state: string) => {
        setFieldStates(prev => ({
            ...prev,
            [rowId]: {
                ...prev[rowId],
                [fieldName]: state
            }
        }));
    };

    // Schedule a delayed refetch to avoid interrupting user input
    const scheduleDelayedRefetch = () => {
        // Clear any existing delayed refetch
        if (refetchDelayRef.current) {
            clearTimeout(refetchDelayRef.current);
        }

        // Schedule refetch after 3 seconds of no activity
        refetchDelayRef.current = window.setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ['review-invoice-details'] });
            refetchDelayRef.current = null;
        }, 3000);
    };


    // Fetch combined data (dates + amounts)
    const { isLoading, error } = useQuery({
        queryKey: ['review-invoice-details'],
        queryFn: async () => {
            // Fetch both dates and amounts data
            const [datesData, amountsData] = await Promise.all([
                reviewAPI.getDates(),
                reviewAPI.getAmounts()
            ]);

            // Store all records for status counting
            setRecords([...datesData.records, ...amountsData.records]);
            return { datesRecords: datesData.records, amountsRecords: amountsData.records };
        },
    });

    // Group by receipt: header from dates, line items from amounts
    const groupedRecords = useMemo(() => {
        const groups: { [key: string]: { header: any; lineItems: any[] } } = {};

        // Get all unique receipt numbers from both datasets
        const allReceiptNumbers = new Set<string>();
        records.forEach(r => {
            const receiptNum = r['Receipt Number'];
            if (receiptNum) allReceiptNumbers.add(receiptNum);
        });

        // For each receipt, get header from dates and line items from amounts
        allReceiptNumbers.forEach(receiptNum => {
            const headerRecord = records.find(r =>
                r['Receipt Number'] === receiptNum &&
                (r['Date'] !== undefined || r['date_bbox'] !== undefined)
            );

            const lineItemRecords = records.filter(r =>
                r['Receipt Number'] === receiptNum &&
                (r['Description'] !== undefined || r['line_item_row_bbox'] !== undefined)
            );

            if (headerRecord) {
                groups[receiptNum] = {
                    header: headerRecord,
                    lineItems: lineItemRecords.length > 0 ? lineItemRecords : [headerRecord]
                };
            }
        });

        return groups;
    }, [records]);

    // Calculate status counts from ALL records
    const statusCounts = useMemo(() => {
        const counts = { pending: 0, completed: 0, duplicates: 0 };

        records.forEach(r => {
            const status = (r['Verification Status'] || 'Pending').toLowerCase();
            if (status === 'pending') counts.pending++;
            else if (status === 'done') counts.completed++;
            else if (status === 'duplicate receipt number') counts.duplicates++;
        });

        return counts;
    }, [records]);


    // Filter individual records (headers and line items) by status
    const filteredData = useMemo(() => {
        const filteredHeaders: { [key: string]: any } = {};
        const filteredLineItems: { [key: string]: any[] } = {};

        Object.keys(groupedRecords).forEach(receiptNum => {
            const group = groupedRecords[receiptNum];

            // Filter header
            const headerStatus = group.header['Verification Status'] || 'Pending';
            const isHeaderPending = headerStatus === 'Pending' || headerStatus === 'Duplicate Receipt Number';

            if (showCompleted || isHeaderPending) {
                filteredHeaders[receiptNum] = group.header;
            }

            // Filter line items
            const pendingLineItems = group.lineItems.filter((item: any) => {
                const itemStatus = item['Verification Status'] || 'Pending';
                const isItemPending = itemStatus === 'Pending' || itemStatus === 'Duplicate Receipt Number';
                return showCompleted || isItemPending;
            });

            if (pendingLineItems.length > 0) {
                filteredLineItems[receiptNum] = pendingLineItems;
            }
        });

        // Get receipt numbers that have either filtered headers or filtered line items
        const allFilteredReceipts = new Set([
            ...Object.keys(filteredHeaders),
            ...Object.keys(filteredLineItems)
        ]);

        return {
            receiptNumbers: Array.from(allFilteredReceipts),
            headers: filteredHeaders,
            lineItems: filteredLineItems
        };
    }, [groupedRecords, showCompleted]);

    // Update mutations
    const updateDateMutation = useMutation({
        mutationFn: async ({ record }: { record: any }) => {
            return reviewAPI.updateSingleDate(record);
        },
        onSuccess: () => {
            // Query invalidation handled in inline callbacks
        },
        onError: (error) => {
            alert(`Error updating: ${error instanceof Error ? error.message : 'Unable to update'}`);
            queryClient.invalidateQueries({ queryKey: ['review-invoice-details'] });
        }
    });

    const updateAmountMutation = useMutation({
        mutationFn: async ({ record }: { record: any }) => {
            return reviewAPI.updateSingleAmount(record);
        },
        onSuccess: () => {
            // Query invalidation handled in inline callbacks
        },
        onError: (error) => {
            alert(`Error updating: ${error instanceof Error ? error.message : 'Unable to update'}`);
            queryClient.invalidateQueries({ queryKey: ['review-invoice-details'] });
        }
    });

    const deleteMutation = useMutation({
        mutationFn: async (receiptNumber: string) => {
            return reviewAPI.deleteReceipt(receiptNumber);
        },
        onSuccess: async () => {
            // CRITICAL: Force immediate refetch instead of just invalidating
            // Note: We don't refetch 'verified' because deleteReceipt doesn't touch verified_invoices
            await queryClient.refetchQueries({ queryKey: ['review-invoice-details'] });
            await queryClient.refetchQueries({ queryKey: ['review-dates'] });
            await queryClient.refetchQueries({ queryKey: ['review-amounts'] });
        },
    });

    const handleFieldChange = (index: number, field: string, value: string, isDateField: boolean = false) => {
        const updated = [...records];
        updated[index] = { ...updated[index], [field]: value };
        setRecords(updated);

        const rowId = updated[index]['Row_Id'] || `temp-${index}`;

        // Set to editing state immediately
        updateFieldState(rowId, field, 'editing');

        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        saveTimeoutRef.current = setTimeout(() => {
            const recordToSave = updated[index];

            // Set to saving state
            updateFieldState(rowId, field, 'saving');

            // Auto-save based on record type (header vs line item)
            if (isDateField) {
                updateDateMutation.mutate({ record: recordToSave }, {
                    onSuccess: () => {
                        updateFieldState(rowId, field, 'saved');
                        // Reset to idle after 2 seconds
                        setTimeout(() => updateFieldState(rowId, field, 'idle'), 2000);
                        // Schedule delayed refetch (3 seconds) to avoid interrupting user
                        scheduleDelayedRefetch();
                    },
                    onError: () => {
                        updateFieldState(rowId, field, 'error');
                    }
                });
            } else {
                updateAmountMutation.mutate({ record: recordToSave }, {
                    onSuccess: () => {
                        updateFieldState(rowId, field, 'saved');
                        // Reset to idle after 2 seconds
                        setTimeout(() => updateFieldState(rowId, field, 'idle'), 2000);
                        // Schedule delayed refetch (3 seconds) to avoid interrupting user
                        scheduleDelayedRefetch();
                    },
                    onError: () => {
                        updateFieldState(rowId, field, 'error');
                    }
                });
            }
        }, 10000); // 10 seconds timeout - only saves if user stays in field
    };

    // Handle blur event - save immediately when user clicks outside
    const handleFieldBlur = (index: number, field: string, isDateField: boolean = false) => {
        // Clear the timeout if it exists
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = null;
        }

        const recordToSave = records[index];
        const rowId = recordToSave['Row_Id'] || `temp-${index}`;

        // Set to saving state
        updateFieldState(rowId, field, 'saving');

        // Save based on record type
        if (isDateField) {
            updateDateMutation.mutate({ record: recordToSave }, {
                onSuccess: () => {
                    updateFieldState(rowId, field, 'saved');
                    setTimeout(() => updateFieldState(rowId, field, 'idle'), 2000);
                    // Schedule delayed refetch (3 seconds) to avoid interrupting if user clicks back
                    scheduleDelayedRefetch();
                },
                onError: () => {
                    updateFieldState(rowId, field, 'error');
                }
            });
        } else {
            updateAmountMutation.mutate({ record: recordToSave }, {
                onSuccess: () => {
                    updateFieldState(rowId, field, 'saved');
                    setTimeout(() => updateFieldState(rowId, field, 'idle'), 2000);
                    // Schedule delayed refetch (3 seconds) to avoid interrupting if user clicks back
                    scheduleDelayedRefetch();
                },
                onError: () => {
                    updateFieldState(rowId, field, 'error');
                }
            });
        }
    };

    const [isProcessing, setIsProcessing] = useState(false);

    const handleSyncFinish = async () => {
        // Prevent multiple simultaneous clicks
        if (isProcessing) {
            return;
        }

        setIsProcessing(true);

        // Validate headers (records with Date field) - must have Receipt Number and Date
        const invalidHeaders = records.filter(r =>
            (r['Date'] !== undefined || r['date_bbox'] !== undefined) &&
            (!r['Receipt Number'] || r['Receipt Number'].trim() === '' || !r['Date'] || r['Date'].trim() === '')
        );

        // Validate line items (records with Description) - must have Receipt Number
        const invalidLineItems = records.filter(r =>
            (r['Description'] !== undefined || r['line_item_row_bbox'] !== undefined) &&
            (!r['Receipt Number'] || r['Receipt Number'].trim() === '')
        );

        if (invalidHeaders.length > 0 || invalidLineItems.length > 0) {
            const errorMsg = [];
            if (invalidHeaders.length > 0) {
                errorMsg.push(`${invalidHeaders.length} header(s) missing Date or Receipt Number`);
            }
            if (invalidLineItems.length > 0) {
                errorMsg.push(`${invalidLineItems.length} line item(s) missing Receipt Number`);
            }
            console.error('❌ Validation failed:', errorMsg.join(', '));
            alert(`Cannot sync: ${errorMsg.join(', ')}.`);
            setIsProcessing(false);
            return;
        }

        // NO CONFIRMATION DIALOG - Start sync immediately
        try {
            setSyncProgress({
                isOpen: true,
                stage: 'reading',
                percentage: 0,
                message: 'Starting sync...'
            });

            await reviewAPI.syncAndFinishWithProgress((event) => {
                setSyncProgress({
                    isOpen: true,
                    stage: event.stage,
                    percentage: event.percentage,
                    message: event.message
                });
            });

            setSyncProgress({ isOpen: false, stage: '', percentage: 0, message: '' });
            queryClient.invalidateQueries({ queryKey: ['review-invoice-details'] });
            queryClient.invalidateQueries({ queryKey: ['review-dates'] });
            queryClient.invalidateQueries({ queryKey: ['review-amounts'] });
            queryClient.invalidateQueries({ queryKey: ['verified'] });
            queryClient.invalidateQueries({ queryKey: ['sync-metadata'] });
            alert('All changes have been saved and verified successfully!');
        } catch (error) {
            setSyncProgress({ isOpen: false, stage: '', percentage: 0, message: '' });
            alert(`Error: ${error instanceof Error ? error.message : 'Unable to complete operation'} `);
        } finally {
            setIsProcessing(false);
        }
    };



    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="animate-spin text-blue-600" size={32} />
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                Error loading data. Please try again.
            </div>
        );
    }

    return (
        <div>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Review Invoice Details</h1>
                        <p className="text-gray-600 mt-2">
                            Manage your invoice processing workflow
                        </p>
                    </div>
                    <div className="flex space-x-3">
                        <button
                            onClick={() => setShowCompleted(!showCompleted)}
                            className={`flex items - center px - 4 py - 2 rounded - lg transition ${showCompleted
                                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                } `}
                        >
                            {showCompleted ? '✓ Showing Completed' : 'Show Completed'}
                        </button>
                    </div>
                </div>

                {/* Status Summary */}
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                        <div className="flex gap-6">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-700">Status Summary:</span>
                            </div>
                            {statusCounts.pending > 0 && (
                                <div className="flex items-center gap-2">
                                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
                                        {statusCounts.pending} Pending
                                    </span>
                                </div>
                            )}
                            {statusCounts.completed > 0 && (
                                <div className="flex items-center gap-2">
                                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                                        {statusCounts.completed} Completed
                                    </span>
                                </div>
                            )}
                            {statusCounts.duplicates > 0 && (
                                <div className="flex items-center gap-2">
                                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-orange-100 text-orange-800">
                                        {statusCounts.duplicates} Duplicates
                                    </span>
                                </div>
                            )}
                        </div>
                        {statusCounts.pending === 0 && statusCounts.completed === 0 && statusCounts.duplicates === 0 && (
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-gray-600">All caught up! 🎉</span>
                            </div>
                        )}
                    </div>

                    {/* Progress Bar */}
                    {records.length > 0 && (
                        <div className="mt-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-medium text-gray-600">Review Progress</span>
                                <span className="text-xs font-semibold text-gray-700">
                                    {Math.round((statusCounts.completed / records.length) * 100)}% Complete
                                </span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2.5">
                                <div
                                    className="bg-gradient-to-r from-green-500 to-green-600 h-2.5 rounded-full transition-all duration-500"
                                    style={{ width: `${(statusCounts.completed / records.length) * 100}% ` }}
                                ></div>
                            </div>
                            <div className="flex items-center justify-between mt-1">
                                <span className="text-xs text-gray-500">
                                    {statusCounts.completed} of {records.length} completed
                                </span>
                                {statusCounts.pending > 0 && (
                                    <span className="text-xs text-yellow-600">
                                        {statusCounts.pending} remaining
                                    </span>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* All Header Details Section */}
                {filteredData.receiptNumbers.length === 0 ? (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
                        <p className="text-gray-500">No records to review. All caught up!</p>
                    </div>
                ) : (
                    <>
                        {/* Header Details - All Receipts */}
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6">
                            <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
                                <h3 className="text-lg font-semibold text-gray-900">Header Details</h3>
                            </div>
                            <div className="p-6 space-y-6">
                                {filteredData.receiptNumbers.map(receiptNum => {
                                    const headerRecord = filteredData.headers[receiptNum];

                                    // Skip if no header for this receipt
                                    if (!headerRecord) return null;

                                    // CRITICAL: Calculate global index ONCE at render time (same pattern as Line Items)
                                    const globalIdx = records.findIndex(r => r === headerRecord);

                                    return (
                                        <div key={`header - ${receiptNum} `} className="p-4 border border-gray-200 rounded-lg">
                                            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                                                {/* Status */}
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                                                    <div className="flex gap-2">
                                                        <StatusToggle
                                                            status={headerRecord['Verification Status'] || 'Pending'}
                                                            onChange={(newStatus: string) => {
                                                                // Update local state
                                                                const updated = [...records];
                                                                updated[globalIdx] = { ...updated[globalIdx], 'Verification Status': newStatus };
                                                                setRecords(updated);
                                                                // CRITICAL FIX: Save immediately to database
                                                                updateDateMutation.mutate({ record: updated[globalIdx] }, {
                                                                    onSuccess: () => {
                                                                        queryClient.invalidateQueries({ queryKey: ['review-invoice-details'] });
                                                                    }
                                                                });
                                                            }}
                                                        />
                                                        {headerRecord['Receipt Number'] && (
                                                            <button
                                                                onClick={() => {
                                                                    if (window.confirm(`Are you sure you want to delete Receipt #${headerRecord['Receipt Number']}? This will remove ALL records for this receipt from the entire system.`)) {
                                                                        deleteMutation.mutate(headerRecord['Receipt Number']);
                                                                    }
                                                                }}
                                                                className="px-3 py-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded border border-red-300 transition-colors"
                                                                title="Delete entire receipt"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Image Preview */}
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-1">Image Preview</label>
                                                    {headerRecord['Receipt Link'] ? (
                                                        headerRecord['date_and_receipt_combined_bbox'] ? (
                                                            <CroppedFieldPreview
                                                                imageUrl={headerRecord['Receipt Link']}
                                                                bboxes={{
                                                                    combined: headerRecord['date_and_receipt_combined_bbox']
                                                                }}
                                                                fields={['combined']}
                                                                fieldLabels={{
                                                                    combined: 'Receipt & Date'
                                                                }}
                                                            />
                                                        ) : (
                                                            <CroppedFieldPreview
                                                                imageUrl={headerRecord['Receipt Link']}
                                                                bboxes={{
                                                                    date: headerRecord['date_bbox'],
                                                                    receipt_number: headerRecord['receipt_number_bbox']
                                                                }}
                                                                fields={['receipt_number', 'date']}
                                                                fieldLabels={{
                                                                    receipt_number: 'Receipt #',
                                                                    date: 'Date'
                                                                }}
                                                            />
                                                        )
                                                    ) : (
                                                        <span className="text-gray-400 text-sm">No image</span>
                                                    )}
                                                </div>

                                                {/* Receipt Number */}
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-1">Receipt Number</label>
                                                    <input
                                                        type="text"
                                                        value={getFieldValue(globalIdx, 'Receipt Number', headerRecord['Row_Id'] || `temp-${globalIdx}`)}
                                                        onFocus={() => {
                                                            // Initialize local edit value on focus
                                                            const rowId = headerRecord['Row_Id'] || `temp-${globalIdx}`;
                                                            const currentValue = records[globalIdx]?.['Receipt Number'] || '';
                                                            setEditValue(rowId, 'Receipt Number', currentValue);
                                                            updateFieldState(rowId, 'Receipt Number', 'editing');
                                                        }}
                                                        onChange={(e) => {
                                                            // Only update local edit state, don't touch records
                                                            const rowId = headerRecord['Row_Id'] || `temp-${globalIdx}`;
                                                            setEditValue(rowId, 'Receipt Number', e.target.value);
                                                        }}
                                                        onBlur={() => {
                                                            // Save the local edit value to the database
                                                            const rowId = headerRecord['Row_Id'] || `temp-${globalIdx}`;
                                                            const editedValue = editValues[rowId]?.['Receipt Number'];

                                                            // Only save if we have an edit value (user actually focused and potentially edited)
                                                            if (editedValue !== undefined) {
                                                                // Update records state with the edited value
                                                                const updated = [...records];
                                                                updated[globalIdx] = { ...updated[globalIdx], 'Receipt Number': editedValue };
                                                                setRecords(updated);

                                                                // Clear any pending timeout
                                                                if (saveTimeoutRef.current) {
                                                                    clearTimeout(saveTimeoutRef.current);
                                                                    saveTimeoutRef.current = null;
                                                                }

                                                                // Set to saving state
                                                                updateFieldState(rowId, 'Receipt Number', 'saving');

                                                                // Save to database
                                                                updateDateMutation.mutate({ record: updated[globalIdx] }, {
                                                                    onSuccess: () => {
                                                                        updateFieldState(rowId, 'Receipt Number', 'saved');
                                                                        setTimeout(() => updateFieldState(rowId, 'Receipt Number', 'idle'), 2000);
                                                                        // Clear local edit value after successful save
                                                                        clearEditValue(rowId, 'Receipt Number');
                                                                        scheduleDelayedRefetch();
                                                                    },
                                                                    onError: () => {
                                                                        updateFieldState(rowId, 'Receipt Number', 'error');
                                                                    }
                                                                });
                                                            }
                                                        }}
                                                        className={`border rounded px-3 py-2 w-[30%] transition-all ${!getFieldValue(globalIdx, 'Receipt Number', headerRecord['Row_Id'] || `temp-${globalIdx}`) || getFieldValue(globalIdx, 'Receipt Number', headerRecord['Row_Id'] || `temp-${globalIdx}`).trim() === ''
                                                            ? 'border-red-500 bg-red-50'
                                                            : getFieldBorderClass(headerRecord['Row_Id'] || `temp-${globalIdx}`, 'Receipt Number')
                                                            }`}
                                                        placeholder="e.g., 810"
                                                    />
                                                </div>

                                                {/* Date */}
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                                                    <input
                                                        type="date"
                                                        value={records[globalIdx]?.['Date'] || ''}
                                                        onChange={(e) => {
                                                            handleFieldChange(globalIdx, 'Date', e.target.value, true);
                                                        }}
                                                        onBlur={() => {
                                                            handleFieldBlur(globalIdx, 'Date', true);
                                                        }}
                                                        className={`border rounded px-3 py-2 w-full transition-all ${getFieldBorderClass(headerRecord['Row_Id'] || `temp-${globalIdx}`, 'Date')
                                                            }`}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Line Items - All Receipts */}
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                            <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
                                <h3 className="text-lg font-semibold text-gray-900">Line Items</h3>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50 border-b border-gray-200">
                                        <tr>
                                            <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase w-20">Receipt #</th>
                                            <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase w-14">Status</th>
                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-[600px]">Image Preview</th>
                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-56">Description</th>
                                            <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase w-16">Qty</th>
                                            <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase w-28">Rate</th>
                                            <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase w-28">Amount</th>
                                            <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase w-20">Mismatch</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200">
                                        {filteredData.receiptNumbers.map(receiptNum => {
                                            const lineItemRecords = filteredData.lineItems[receiptNum];

                                            // Skip if no line items for this receipt
                                            if (!lineItemRecords || lineItemRecords.length === 0) return null;

                                            return lineItemRecords.map((record: any, localIdx: number) => {
                                                const globalIdx = records.findIndex(r => r === record);
                                                const rowId = record['Row_Id'] || `temp-${globalIdx}`;

                                                // Check if any field in this row is being edited
                                                const isRowEditing = ['Description', 'Quantity', 'Rate', 'Amount'].some(
                                                    field => fieldStates[rowId]?.[field] === 'editing'
                                                );

                                                return (
                                                    <tr
                                                        key={`${receiptNum}-${localIdx}`}
                                                        className={`hover:bg-gray-50 transition-colors ${isRowEditing ? 'bg-yellow-50/30' : ''
                                                            }`}
                                                    >
                                                        <td className="px-2 py-3 font-mono text-xs text-gray-600">
                                                            {receiptNum}
                                                        </td>
                                                        <td className="px-2 py-3">
                                                            <StatusToggle
                                                                status={record['Verification Status'] || 'Pending'}
                                                                onChange={(newStatus: string) => {
                                                                    // Update local state
                                                                    const updated = [...records];
                                                                    updated[globalIdx] = { ...updated[globalIdx], 'Verification Status': newStatus };
                                                                    setRecords(updated);
                                                                    // CRITICAL FIX: Save immediately to database
                                                                    updateAmountMutation.mutate({ record: updated[globalIdx] }, {
                                                                        onSuccess: () => {
                                                                            queryClient.invalidateQueries({ queryKey: ['review-invoice-details'] });
                                                                        }
                                                                    });
                                                                }}
                                                            />
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            {record['Receipt Link'] && record['line_item_row_bbox'] ? (
                                                                <CroppedFieldPreview
                                                                    imageUrl={record['Receipt Link']}
                                                                    bboxes={{
                                                                        line_item_row: record['line_item_row_bbox']
                                                                    }}
                                                                    fields={['line_item_row']}
                                                                    fieldLabels={{
                                                                        line_item_row: 'Line Item'
                                                                    }}
                                                                />
                                                            ) : (
                                                                <span className="text-gray-400 text-xs">No preview</span>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <input
                                                                type="text"
                                                                value={record['Description'] || ''}
                                                                onChange={(e) => handleFieldChange(globalIdx, 'Description', e.target.value, false)}
                                                                onBlur={() => handleFieldBlur(globalIdx, 'Description', false)}
                                                                className={`border rounded px-2 py-1 w-full max-w-[200px] transition-all ${getFieldBorderClass(rowId, 'Description')
                                                                    }`}
                                                            />
                                                        </td>
                                                        <td className="px-2 py-3">
                                                            <input
                                                                type="number"
                                                                step="0.1"
                                                                value={record['Quantity'] || ''}
                                                                onChange={(e) => handleFieldChange(globalIdx, 'Quantity', e.target.value, false)}
                                                                onBlur={() => handleFieldBlur(globalIdx, 'Quantity', false)}
                                                                className={`border rounded px-2 py-1 w-14 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${getFieldBorderClass(rowId, 'Quantity')
                                                                    }`}
                                                            />
                                                        </td>
                                                        <td className="px-2 py-3">
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                value={record['Rate'] || ''}
                                                                onChange={(e) => handleFieldChange(globalIdx, 'Rate', e.target.value, false)}
                                                                onBlur={() => handleFieldBlur(globalIdx, 'Rate', false)}
                                                                className={`border rounded px-2 py-1 w-20 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${getFieldBorderClass(rowId, 'Rate')
                                                                    }`}
                                                            />
                                                        </td>
                                                        <td className="px-2 py-3">
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                value={record['Amount'] || ''}
                                                                onChange={(e) => handleFieldChange(globalIdx, 'Amount', e.target.value, false)}
                                                                onBlur={() => handleFieldBlur(globalIdx, 'Amount', false)}
                                                                className={`border rounded px-2 py-1 w-20 transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${getFieldBorderClass(rowId, 'Amount')
                                                                    }`}
                                                            />
                                                        </td>
                                                        <td className="px-2 py-3 text-red-600 text-xs">
                                                            {record['Amount Mismatch'] ? `₹${record['Amount Mismatch']} ` : '—'}
                                                        </td>
                                                    </tr>
                                                );
                                            });
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Sticky Floating Sync & Finish Button */}
            {statusCounts.completed > 0 && (
                <div className="fixed bottom-6 right-6 z-50">
                    <button
                        onClick={handleSyncFinish}
                        className="flex items-center gap-3 px-6 py-4 bg-green-600 text-white rounded-full shadow-2xl hover:bg-green-700 transition-all hover:scale-105 animate-pulse hover:animate-none"
                    >
                        <RefreshCw size={24} />
                        <div className="flex flex-col items-start">
                            <span className="font-semibold text-lg">Sync & Finish</span>
                            <span className="text-xs opacity-90">{statusCounts.completed} completed</span>
                        </div>
                    </button>
                </div>
            )}

            {/* Sync Progress Modal */}
            <SyncProgressModal
                isOpen={syncProgress.isOpen}
                stage={syncProgress.stage}
                percentage={syncProgress.percentage}
                message={syncProgress.message}
            />
        </div>
    );
};

export default ReviewInvoiceDetailsPage;
