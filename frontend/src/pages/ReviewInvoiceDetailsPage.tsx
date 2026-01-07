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
        onSuccess: () => { },
        onError: (error) => {
            alert(`Error updating: ${error instanceof Error ? error.message : 'Unable to update'}`);
            queryClient.invalidateQueries({ queryKey: ['review-invoice-details'] });
        }
    });

    const updateAmountMutation = useMutation({
        mutationFn: async ({ record }: { record: any }) => {
            return reviewAPI.updateSingleAmount(record);
        },
        onSuccess: () => { },
        onError: (error) => {
            alert(`Error updating: ${error instanceof Error ? error.message : 'Unable to update'}`);
            queryClient.invalidateQueries({ queryKey: ['review-invoice-details'] });
        }
    });

    const deleteMutation = useMutation({
        mutationFn: (rowId: string) => {
            return fetch(`${import.meta.env.VITE_API_URL}/api/review/record/${rowId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
                },
            }).then(res => res.json());
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['review-invoice-details'] });
        },
    });

    const handleFieldChange = (index: number, field: string, value: string, isDateField: boolean = false) => {
        const updated = [...records];
        updated[index] = { ...updated[index], [field]: value };
        setRecords(updated);

        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        saveTimeoutRef.current = setTimeout(() => {
            const recordToSave = updated[index];

            // Auto-save based on record type (header vs line item)
            if (isDateField) {
                updateDateMutation.mutate({ record: recordToSave });
            } else {
                updateAmountMutation.mutate({ record: recordToSave });
            }
        }, 500);
    };

    const handleSyncFinish = async () => {
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
            alert(`Cannot sync: ${errorMsg.join(', ')}.`);
            return;
        }

        if (!confirm('Are you sure you want to Sync & Finish? This will finalize all verified invoices.')) {
            return;
        }

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
                            <div className="flex items-center gap-2">
                                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
                                    {statusCounts.pending} Pending
                                </span>
                            </div>
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
                                                                const idx = records.findIndex(r => r === headerRecord);
                                                                handleFieldChange(idx, 'Verification Status', newStatus, true);
                                                            }}
                                                        />
                                                        {headerRecord['Row_Id'] && (
                                                            <button
                                                                onClick={() => {
                                                                    if (window.confirm('Are you sure you want to delete this record? This action cannot be undone.')) {
                                                                        deleteMutation.mutate(headerRecord['Row_Id']);
                                                                    }
                                                                }}
                                                                className="px-3 py-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded border border-red-300 transition-colors"
                                                                title="Delete record"
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
                                                        value={headerRecord['Receipt Number'] || ''}
                                                        onChange={(e) => {
                                                            const idx = records.findIndex(r => r === headerRecord);
                                                            handleFieldChange(idx, 'Receipt Number', e.target.value, true);
                                                        }}
                                                        className={`border rounded px - 3 py - 2 w - full ${!headerRecord['Receipt Number'] || headerRecord['Receipt Number'].trim() === ''
                                                            ? 'border-red-500 bg-red-50'
                                                            : 'border-gray-300'
                                                            } `}
                                                        placeholder="e.g., 810"
                                                    />
                                                </div>

                                                {/* Date */}
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                                                    <input
                                                        type="date"
                                                        value={headerRecord['Date'] || ''}
                                                        onChange={(e) => {
                                                            const idx = records.findIndex(r => r === headerRecord);
                                                            handleFieldChange(idx, 'Date', e.target.value, true);
                                                        }}
                                                        className="border rounded px-3 py-2 w-full border-gray-300"
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
                            <div className="px-6 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                                <h3 className="text-lg font-semibold text-gray-900">Line Items</h3>
                                <span className="text-sm text-gray-600">
                                    Delete Receipt button removed - use delete on header if needed
                                </span>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50 border-b border-gray-200">
                                        <tr>
                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Receipt #</th>
                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Image Preview</th>
                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Quantity</th>
                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Rate</th>
                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Mismatch</th>
                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200">
                                        {filteredData.receiptNumbers.map(receiptNum => {
                                            const lineItemRecords = filteredData.lineItems[receiptNum];

                                            // Skip if no line items for this receipt
                                            if (!lineItemRecords || lineItemRecords.length === 0) return null;

                                            return lineItemRecords.map((record: any, localIdx: number) => {
                                                const globalIdx = records.findIndex(r => r === record);
                                                return (
                                                    <tr key={`${receiptNum} -${localIdx} `} className="hover:bg-gray-50">
                                                        <td className="px-4 py-3 font-mono text-xs text-gray-600">
                                                            {receiptNum}
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <div className="flex gap-2">
                                                                <StatusToggle
                                                                    status={record['Verification Status'] || 'Pending'}
                                                                    onChange={(newStatus: string) => handleFieldChange(globalIdx, 'Verification Status', newStatus, true)}
                                                                />
                                                                {record['Row_Id'] && (
                                                                    <button
                                                                        onClick={() => {
                                                                            if (window.confirm('Are you sure you want to delete this record? This action cannot be undone.')) {
                                                                                deleteMutation.mutate(record['Row_Id']);
                                                                            }
                                                                        }}
                                                                        className="px-2 py-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded border border-red-300 transition-colors"
                                                                        title="Delete record"
                                                                    >
                                                                        <Trash2 size={14} />
                                                                    </button>
                                                                )}
                                                            </div>
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
                                                                className="border border-gray-300 rounded px-2 py-1 w-full min-w-[150px]"
                                                            />
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <input
                                                                type="number"
                                                                step="0.1"
                                                                value={record['Quantity'] || ''}
                                                                onChange={(e) => handleFieldChange(globalIdx, 'Quantity', e.target.value, false)}
                                                                className="border border-gray-300 rounded px-2 py-1 w-20"
                                                            />
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                value={record['Rate'] || ''}
                                                                onChange={(e) => handleFieldChange(globalIdx, 'Rate', e.target.value, false)}
                                                                className="border border-gray-300 rounded px-2 py-1 w-24"
                                                            />
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                value={record['Amount'] || ''}
                                                                onChange={(e) => handleFieldChange(globalIdx, 'Amount', e.target.value, false)}
                                                                className="border border-gray-300 rounded px-2 py-1 w-24"
                                                            />
                                                        </td>
                                                        <td className="px-4 py-3 text-red-600 font-medium">
                                                            {record['Amount Mismatch'] ? `₹${record['Amount Mismatch']} ` : '—'}
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            {record['Receipt Link'] && (
                                                                <a
                                                                    href={record['Receipt Link']}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="text-blue-600 hover:text-blue-800 text-xs underline"
                                                                >
                                                                    View
                                                                </a>
                                                            )}
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
