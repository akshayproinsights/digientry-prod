import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { reviewAPI } from '../services/api';
import { RefreshCw, Loader2, Trash2 } from 'lucide-react';
import CroppedFieldPreview from '../components/CroppedFieldPreview';
import StatusToggle from '../components/StatusToggle';
import SyncProgressModal from '../components/SyncProgressModal';

const ReviewAmountsPage: React.FC = () => {
    const [records, setRecords] = useState<any[]>([]);
    const [hasChanges, setHasChanges] = useState(false);
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

    const { isLoading, error } = useQuery({
        queryKey: ['review-amounts'],
        queryFn: async () => {
            const data = await reviewAPI.getAmounts();
            setRecords(data.records || []);
            return data;
        },
    });

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
            return reviewAPI.updateSingleAmount(record);
        },
        onSuccess: () => {
            // Don't invalidate queries to avoid losing UI state
            // The local state is already updated
        },
        onError: (error) => {
            alert(`Error updating record: ${error instanceof Error ? error.message : 'Unable to update. Please try again.'}`);
            // Refresh to revert local changes
            queryClient.invalidateQueries({ queryKey: ['review-amounts'] });
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
            // All validations passed - save to database
            updateRowMutation.mutate({ record: updated[originalIndex] });
        }, 500); // Wait 500ms after last keystroke
    };

    const handleSyncFinish = async () => {
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
            alert('All changes have been saved and verified successfully!');
        } catch (error) {
            setSyncProgress({ isOpen: false, stage: '', percentage: 0, message: '' });
            alert(`Error: ${error instanceof Error ? error.message : 'Unable to complete operation. Please try again.'}`);
        }
    };

    const handleDeleteRow = (index: number) => {
        if (confirm('Are you sure you want to delete this row?')) {
            const sortedRecord = sortedRecords[index];
            const originalIndex = records.findIndex(r => r === sortedRecord);
            const updated = records.filter((_, i) => i !== originalIndex);
            setRecords(updated);
            setHasChanges(true);
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
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Review Amounts</h1>
                    <p className="text-gray-600 mt-2">
                        Verify quantities, rates, and amounts
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
                        className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50"
                    >
                        {syncMutation.isPending ? (
                            <Loader2 className="animate-spin mr-2" size={16} />
                        ) : (
                            <RefreshCw className="mr-2" size={16} />
                        )}
                        Sync & Finish
                    </button>
                </div>
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
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Receipt #</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Quantity</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rate</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Mismatch</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Receipt</th>
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
                                                <span className="text-gray-400 text-xs">No image</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-sm">{record['Receipt Number'] || '—'}</td>
                                        <td className="px-6 py-4">
                                            <input
                                                type="text"
                                                value={record['Description'] || ''}
                                                onChange={(e) => handleFieldChange(index, 'Description', e.target.value)}
                                                className="border border-gray-300 rounded px-2 py-1 w-full min-w-[200px]"
                                            />
                                        </td>
                                        <td className="px-6 py-4">
                                            <input
                                                type="number"
                                                step="0.1"
                                                value={record['Quantity'] || ''}
                                                onChange={(e) => handleFieldChange(index, 'Quantity', e.target.value)}
                                                className="border border-gray-300 rounded px-2 py-1 w-20"
                                            />
                                        </td>
                                        <td className="px-6 py-4">
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={record['Rate'] || ''}
                                                onChange={(e) => handleFieldChange(index, 'Rate', e.target.value)}
                                                className="border border-gray-300 rounded px-2 py-1 w-24"
                                            />
                                        </td>
                                        <td className="px-6 py-4">
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={record['Amount'] || ''}
                                                onChange={(e) => handleFieldChange(index, 'Amount', e.target.value)}
                                                className="border border-gray-300 rounded px-2 py-1 w-24"
                                            />
                                        </td>
                                        <td className="px-6 py-4 text-sm text-red-600">
                                            ₹{record['Amount Mismatch'] || '0'}
                                        </td>
                                        <td className="px-6 py-4 text-sm">
                                            {record['Receipt Link'] ? (
                                                <a
                                                    href={record['Receipt Link']}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-blue-600 hover:text-blue-800 hover:underline"
                                                >
                                                    View
                                                </a>
                                            ) : (
                                                '—'
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

export default ReviewAmountsPage;
