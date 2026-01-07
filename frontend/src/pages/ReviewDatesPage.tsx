import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { reviewAPI } from '../services/api';
import { RefreshCw, Loader2, Trash2 } from 'lucide-react';
import CroppedFieldPreview from '../components/CroppedFieldPreview';
import StatusToggle from '../components/StatusToggle';
import SyncProgressModal from '../components/SyncProgressModal';

const ReviewDatesPage: React.FC = () => {
    const [records, setRecords] = useState<any[]>([]);
    const [hasChanges, setHasChanges] = useState(false);
    const [showSuccessFor, setShowSuccessFor] = useState<{ [key: string]: boolean }>({});
    const [showCompleted, setShowCompleted] = useState(false);  // Toggle to show/hide completed records
    const [syncProgress, setSyncProgress] = useState({
        isOpen: false,
        stage: '',
        percentage: 0,
        message: ''
    });
    const queryClient = useQueryClient();

    // Debounce timer for auto-save (wait 500ms after user stops typing)
    const saveTimeoutRef = React.useRef<number | null>(null);
    // Timer for hiding success messages
    const successTimeoutRef = React.useRef<{ [key: string]: number }>({});

    const { isLoading, error } = useQuery({
        queryKey: ['review-dates'],
        queryFn: async () => {
            const data = await reviewAPI.getDates();
            setRecords(data.records || []);
            return data;
        },
    });

    // Calculate status counts from ALL records (not just filtered)
    const statusCounts = useMemo(() => {
        const counts = {
            pending: 0,
            completed: 0,
            duplicates: 0
        };

        records.forEach(r => {
            const status = (r['Verification Status'] || 'Pending').toLowerCase();
            if (status === 'pending') {
                counts.pending++;
            } else if (status === 'done') {
                counts.completed++;
            } else if (status === 'duplicate receipt number') {
                counts.duplicates++;
            }
        });

        return counts;
    }, [records]);

    // Filter records based on showCompleted toggle
    const filteredRecords = useMemo(() => {
        // Show Pending and Duplicate Receipt Number by default
        // If showCompleted is true, also show Done records
        return records.filter(r => {
            const status = r['Verification Status'] || 'Pending';
            if (status === 'Pending' || status === 'Duplicate Receipt Number') {
                return true;
            }
            if (status === 'Done' && showCompleted) {
                return true;
            }
            return false;
        });
    }, [records, showCompleted]);

    // Use filtered records directly without sorting
    const sortedRecords = filteredRecords;

    // Individual row update mutation
    const updateRowMutation = useMutation({
        mutationFn: async ({ record }: { record: any }) => {
            return reviewAPI.updateSingleDate(record);
        },
        onSuccess: () => {
            // Don't invalidate queries to avoid losing UI state
            // The local state is already updated
        },
        onError: (error) => {
            alert(`Error updating record: ${error instanceof Error ? error.message : 'Unable to update. Please try again.'}`);
            // Refresh to revert local changes
            queryClient.invalidateQueries({ queryKey: ['review-dates'] });
        }
    });

    // Combined Save + Sync mutation
    const syncMutation = useMutation({
        mutationFn: async () => {
            // Trigger sync & finish without saving (individual updates already saved)
            return reviewAPI.syncAndFinish();
        },
        onSuccess: () => {
            setHasChanges(false);
            queryClient.invalidateQueries({ queryKey: ['review-dates'] });
            queryClient.invalidateQueries({ queryKey: ['review-amounts'] });
            queryClient.invalidateQueries({ queryKey: ['verified'] });
            queryClient.invalidateQueries({ queryKey: ['sync-metadata'] });
            alert('All changes have been saved and verified successfully!');
        },
        onError: (error) => {
            alert(`Error: ${error instanceof Error ? error.message : 'Unable to complete operation. Please try again.'}`);
        }
    });

    const handleFieldChange = (index: number, field: string, value: string) => {
        // Find the actual index in original records array
        const sortedRecord = sortedRecords[index];
        const originalIndex = records.findIndex(r => r === sortedRecord);

        const updated = [...records];
        updated[originalIndex] = { ...updated[originalIndex], [field]: value };
        setRecords(updated);
        setHasChanges(true);

        // Clear existing timeout
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        // Debounced save - wait 500ms after user stops typing
        saveTimeoutRef.current = setTimeout(() => {
            // Validate before saving to database
            const recordToSave = updated[originalIndex];

            // Don't save if critical fields are empty or invalid
            if (!recordToSave['Date'] || recordToSave['Date'].trim() === '') {
                console.warn('Date field is empty. Skipping save.');
                return;
            }

            if (!recordToSave['Receipt Number'] || recordToSave['Receipt Number'].trim() === '') {
                console.warn('Receipt Number is empty. Skipping save.');
                return;
            }

            // Validate date format: YYYY-MM-DD (must be complete)
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (!dateRegex.test(recordToSave['Date'])) {
                console.warn('Date format incomplete. Skipping save.');
                return;
            }

            // Additional check: ensure it's a valid date
            const dateObj = new Date(recordToSave['Date']);
            if (isNaN(dateObj.getTime())) {
                console.warn('Invalid date. Skipping save.');
                return;
            }

            // All validations passed - save to database
            updateRowMutation.mutate({ record: recordToSave });

            // Show success message temporarily
            const recordKey = `${originalIndex}-${field}`;
            setShowSuccessFor(prev => ({ ...prev, [recordKey]: true }));

            // Clear any existing success timeout for this field
            if (successTimeoutRef.current[recordKey]) {
                clearTimeout(successTimeoutRef.current[recordKey]);
            }

            // Hide success message after 3 seconds
            successTimeoutRef.current[recordKey] = setTimeout(() => {
                setShowSuccessFor(prev => ({ ...prev, [recordKey]: false }));
            }, 3000);
        }, 500); // Wait 500ms after last keystroke
    };

    const handleSyncFinish = async () => {
        // Validate all records before syncing
        const invalidRecords = sortedRecords.filter(r =>
            !r['Date'] || r['Date'].trim() === '' ||
            !r['Receipt Number'] || r['Receipt Number'].trim() === ''
        );

        if (invalidRecords.length > 0) {
            alert(`Cannot sync: ${invalidRecords.length} record(s) have empty Date or Receipt Number. Please fill in all required fields.`);
            return;
        }

        if (!confirm('Are you sure you want to Sync & Finish? This will finalize all verified invoices.')) {
            return;
        }

        try {
            // Open progress modal
            setSyncProgress({
                isOpen: true,
                stage: 'reading',
                percentage: 0,
                message: 'Starting sync...'
            });

            // Execute sync with progress updates
            await reviewAPI.syncAndFinishWithProgress((event) => {
                setSyncProgress({
                    isOpen: true,
                    stage: event.stage,
                    percentage: event.percentage,
                    message: event.message
                });
            });

            // Close modal and refresh data
            setSyncProgress({ isOpen: false, stage: '', percentage: 0, message: '' });
            queryClient.invalidateQueries({ queryKey: ['review-dates'] });
            queryClient.invalidateQueries({ queryKey: ['review-amounts'] });
            queryClient.invalidateQueries({ queryKey: ['verified'] });
            queryClient.invalidateQueries({ queryKey: ['sync-metadata'] });
            alert('All changes have been saved and verified successfully!');
        } catch (error) {
            setSyncProgress({ isOpen: false, stage: '', percentage: 0, message: '' });
            alert(`Error: ${error instanceof Error ? error.message : 'Unable to complete operation. Please try again.'}`);
        }
    };

    const handleDeleteRow = async (index: number) => {
        const sortedRecord = sortedRecords[index];
        const receiptNumber = sortedRecord['Receipt Number'];

        if (!receiptNumber) {
            alert('Cannot delete: No receipt number found');
            return;
        }

        if (confirm(`Are you sure you want to delete Receipt #${receiptNumber}? This will remove ALL records for this receipt from the entire system.`)) {
            try {
                // Call API to delete from all sheets
                await reviewAPI.deleteReceipt(receiptNumber);

                // Update frontend state
                const originalIndex = records.findIndex(r => r === sortedRecord);
                const updated = records.filter((_, i) => i !== originalIndex);
                setRecords(updated);

                // Refresh the page data
                queryClient.invalidateQueries({ queryKey: ['review-dates'] });
                queryClient.invalidateQueries({ queryKey: ['review-amounts'] });
                queryClient.invalidateQueries({ queryKey: ['verified'] });

                alert(`Receipt #${receiptNumber} deleted successfully from all sheets`);
            } catch (error) {
                alert(`Error deleting receipt: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
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
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Review Dates & Receipts</h1>
                        <p className="text-gray-600 mt-2">
                            Verify and correct receipt numbers and dates
                        </p>
                    </div>
                    <div className="flex space-x-3">
                        <button
                            onClick={() => setShowCompleted(!showCompleted)}
                            className={`flex items-center px-4 py-2 rounded-lg transition ${showCompleted
                                ? 'bg-green-100 text-green-700 hover:bg-green-200'
                                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                }`}
                        >
                            {showCompleted ? '✓ Showing Completed' : 'Show Completed'}
                        </button>
                        <button
                            onClick={handleSyncFinish}
                            disabled={syncMutation.isPending}
                            className={`flex items-center px-4 py-2 rounded-lg transition disabled:opacity-50 ${statusCounts.completed > 0
                                ? 'bg-green-600 text-white hover:bg-green-700 animate-pulse'
                                : 'bg-green-600 text-white hover:bg-green-700'
                                }`}
                        >
                            {syncMutation.isPending ? (
                                <Loader2 className="animate-spin mr-2" size={16} />
                            ) : (
                                <RefreshCw className="mr-2" size={16} />
                            )}
                            Sync & Finish
                            {statusCounts.completed > 0 && (
                                <span className="ml-2 bg-white text-green-600 rounded-full px-2 py-0.5 text-xs font-semibold">
                                    {statusCounts.completed}
                                </span>
                            )}
                        </button>
                    </div>
                </div>

                {/* Status Summary Bar */}
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
                                    className="bg-gradient-to-r from-green-500 to-green-600 h-2.5 rounded-full transition-all duration-500 ease-out"
                                    style={{ width: `${(statusCounts.completed / records.length) * 100}%` }}
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
                    {/* Sync Action Prompt */}
                    {statusCounts.completed > 0 && (
                        <div className="mt-3 pt-3 border-t border-blue-200">
                            <p className="text-sm text-green-700 flex items-center gap-2">
                                <span className="text-green-600 font-semibold">✓</span>
                                You have {statusCounts.completed} completed record{statusCounts.completed !== 1 ? 's' : ''} ready to sync. Click "Sync & Finish" to finalize your changes.
                            </p>
                        </div>
                    )}
                    {statusCounts.completed === 0 && statusCounts.pending === 0 && (
                        <div className="mt-3 pt-3 border-t border-blue-200">
                            <p className="text-sm text-gray-600">
                                No records to sync. All caught up! 🎉
                            </p>
                        </div>
                    )}
                </div>

                {sortedRecords.length === 0 ? (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
                        <p className="text-gray-500">No records to review. All caught up!</p>
                    </div>
                ) : (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-200">
                            <p className="text-sm text-gray-600">
                                Showing <span className="font-medium">{sortedRecords.length}</span> records
                                {hasChanges && <span className="ml-2 text-orange-600">(unsaved changes)</span>}
                            </p>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-gray-50 border-b border-gray-200">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Image Preview</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Receipt Number</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Audit Findings</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Receipt Link</th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {sortedRecords.map((record, index) => (
                                        <tr key={index} className="hover:bg-gray-50">
                                            <td className="px-6 py-4">
                                                <StatusToggle
                                                    status={record['Verification Status'] || 'Pending'}
                                                    onChange={(newStatus: string) => handleFieldChange(index, 'Verification Status', newStatus)}
                                                />
                                            </td>
                                            <td className="px-4 py-4">
                                                {record['Receipt Link'] ? (
                                                    record['date_and_receipt_combined_bbox'] ? (
                                                        <div className="flex flex-col gap-2">
                                                            <CroppedFieldPreview
                                                                imageUrl={record['Receipt Link']}
                                                                bboxes={{
                                                                    combined: record['date_and_receipt_combined_bbox']
                                                                }}
                                                                fields={['combined']}
                                                                fieldLabels={{
                                                                    combined: 'Receipt & Date'
                                                                }}
                                                            />
                                                        </div>
                                                    ) : (
                                                        <CroppedFieldPreview
                                                            imageUrl={record['Receipt Link']}
                                                            bboxes={{
                                                                date: record['date_bbox'],
                                                                receipt_number: record['receipt_number_bbox']
                                                            }}
                                                            fields={['receipt_number', 'date']}
                                                            fieldLabels={{
                                                                receipt_number: 'Receipt #',
                                                                date: 'Date'
                                                            }}
                                                        />
                                                    )
                                                ) : (
                                                    <span className="text-gray-400 text-xs">No image</span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="space-y-1">
                                                    <input
                                                        type="text"
                                                        value={record['Receipt Number'] || ''}
                                                        onChange={(e) => handleFieldChange(index, 'Receipt Number', e.target.value)}
                                                        className={`border rounded px-2 py-1 w-full ${!record['Receipt Number'] || record['Receipt Number'].trim() === ''
                                                            ? 'border-red-500 bg-red-50'
                                                            : showSuccessFor[`${records.findIndex(r => r === sortedRecords[index])}-Receipt Number`]
                                                                ? 'border-green-500 bg-green-50'
                                                                : 'border-gray-300'
                                                            }`}
                                                        placeholder="e.g., 801"
                                                    />
                                                    {(!record['Receipt Number'] || record['Receipt Number'].trim() === '') && (
                                                        <p className="text-xs text-red-600">
                                                            🧾 Please add a receipt number
                                                        </p>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="space-y-1">
                                                    <input
                                                        type="date"
                                                        value={record['Date'] || ''}
                                                        onChange={(e) => handleFieldChange(index, 'Date', e.target.value)}
                                                        className={`border rounded px-2 py-1 w-full ${!record['Date'] || record['Date'].trim() === ''
                                                            ? 'border-red-500 bg-red-50'
                                                            : showSuccessFor[`${records.findIndex(r => r === sortedRecords[index])}-Date`]
                                                                ? 'border-green-500 bg-green-50'
                                                                : 'border-gray-300'
                                                            }`}
                                                    />
                                                    {(!record['Date'] || record['Date'].trim() === '') && (
                                                        <p className="text-xs text-red-600">
                                                            📅 Please select a date
                                                        </p>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-sm text-gray-600">
                                                {record['Audit Findings'] || '—'}
                                            </td>
                                            <td className="px-6 py-4">
                                                {record['Receipt Link'] && (
                                                    <a
                                                        href={record['Receipt Link']}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-blue-600 hover:text-blue-800 text-sm underline"
                                                    >
                                                        View
                                                    </a>
                                                )}
                                            </td>
                                            <td className="px-6 py-4">
                                                <button
                                                    onClick={() => handleDeleteRow(index)}
                                                    className="text-red-600 hover:text-red-800 transition"
                                                    title="Delete row"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>

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

export default ReviewDatesPage;
