import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, CheckCircle, Clock, Trash2, Calendar } from 'lucide-react';
import { vendorMappingAPI } from '../services/vendorMappingApi';
import type { VendorMappingEntry } from '../services/vendorMappingApi';

const InventoryMappedPage: React.FC = () => {
    const queryClient = useQueryClient();

    // Fetch all vendor mapping entries sorted by created_at DESC
    const { data, isLoading, error } = useQuery({
        queryKey: ['vendor-mapping-entries'],
        queryFn: () => vendorMappingAPI.getEntries(),
    });

    // Unmap (delete) mutation
    const unmapMutation = useMutation({
        mutationFn: async (entryId: number) => {
            return vendorMappingAPI.deleteEntry(entryId);
        },
        onSuccess: () => {
            // Refresh both pages
            queryClient.invalidateQueries({ queryKey: ['vendor-mapping-entries'] });
            queryClient.invalidateQueries({ queryKey: ['vendor-mapping-export-data'] });
        },
        onError: (error) => {
            alert(`Error unmapping item: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    const handleUnmap = (entry: VendorMappingEntry) => {
        if (confirm(`Are you sure you want to unlink "${entry.vendor_description}"? It will return to Link Items.`)) {
            if (entry.id) {
                unmapMutation.mutate(entry.id);
            }
        }
    };

    // Sort by created_at DESC (newest first)
    const entries: VendorMappingEntry[] = (data?.entries || []).sort((a, b) => {
        const dateA = new Date(a.created_at || 0).getTime();
        const dateB = new Date(b.created_at || 0).getTime();
        return dateB - dateA;
    });

    // Stats
    const totalMapped = entries.length;
    const addedCount = entries.filter(e => e.status === 'Pending' || e.status === 'Mark as Done').length;
    const skippedCount = entries.filter(e => e.status === 'Skip').length;

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
                Error loading mapping history. Please try again.
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold text-gray-900">Linked Items</h1>
                <p className="text-gray-600 mt-2">
                    View all linked vendor items. Unlink to return items to Link Items.
                </p>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-600">Total Mapped</p>
                            <p className="text-2xl font-bold text-gray-900 mt-1">{totalMapped}</p>
                        </div>
                        <Calendar className="text-blue-500" size={32} />
                    </div>
                </div>

                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-600">Added Items</p>
                            <p className="text-2xl font-bold text-green-600 mt-1">{addedCount}</p>
                        </div>
                        <CheckCircle className="text-green-500" size={32} />
                    </div>
                </div>

                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-gray-600">Skipped Records</p>
                            <p className="text-2xl font-bold text-gray-600 mt-1">{skippedCount}</p>
                        </div>
                        <Clock className="text-gray-500" size={32} />
                    </div>
                </div>
            </div>

            {/* Table */}
            {entries.length === 0 ? (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
                    <Calendar size={48} className="mx-auto mb-3 text-gray-300" />
                    <p className="text-gray-500">No linked items yet. Go to Link Items to start!</p>
                </div>
            ) : (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-200">
                        <p className="text-sm text-gray-600">
                            Showing <span className="font-medium">{entries.length}</span> mapped entries (newest first)
                        </p>
                    </div>
                    <div className="overflow-x-auto max-h-[500px]">
                        <table className="w-full">
                            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-44">Vendor Description</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-32">Part Number</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-48">Customer Item</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-16">Stock</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-16">Reorder</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-20">Status</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-24">Mapped On</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-24">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {entries.map((entry) => (
                                    <tr
                                        key={entry.id}
                                        className="hover:bg-gray-50"
                                    >
                                        <td className="px-4 py-3">
                                            <p className="font-medium text-gray-900 max-w-[200px] truncate" title={entry.vendor_description}>
                                                {entry.vendor_description}
                                            </p>
                                        </td>
                                        <td className="px-4 py-3 text-gray-600 font-mono text-xs">{entry.part_number || '-'}</td>
                                        <td className="px-4 py-3 text-gray-700">{entry.customer_item_name || '-'}</td>
                                        <td className="px-4 py-3 text-gray-700">{entry.stock ?? '-'}</td>
                                        <td className="px-4 py-3 text-gray-700">{entry.reorder ?? '-'}</td>
                                        <td className="px-4 py-3">
                                            <span className={`text-sm font-medium ${entry.status === 'Skip' ? 'text-gray-500' : 'text-green-600'}`}>
                                                {entry.status === 'Skip' ? 'Skipped' : 'Added'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <p className="text-sm text-gray-600">
                                                {entry.created_at ? new Date(entry.created_at).toLocaleDateString('en-IN', {
                                                    day: '2-digit',
                                                    month: 'short',
                                                    year: 'numeric'
                                                }) : '-'}
                                            </p>
                                        </td>
                                        <td className="px-4 py-3">
                                            <button
                                                onClick={() => handleUnmap(entry)}
                                                disabled={unmapMutation.isPending}
                                                className="flex items-center gap-1 px-3 py-1 rounded text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-50"
                                                title="Unmap this item"
                                            >
                                                <Trash2 size={14} />
                                                Unmap
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
    );
};

export default InventoryMappedPage;
