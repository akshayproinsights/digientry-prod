import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { verifiedAPI } from '../services/api';
import { Search, Download, Loader2, ExternalLink, Trash2 } from 'lucide-react';

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
    const [records, setRecords] = useState<any[]>([]);
    const [hasChanges, setHasChanges] = useState(false);

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

    // Individual row update mutation
    const updateRowMutation = useMutation({
        mutationFn: async ({ record }: { record: any }) => {
            return verifiedAPI.updateSingleRow(record);
        },
        onSuccess: () => {
            // Don't invalidate queries to avoid losing UI state
            // The local state is already updated
        },
        onError: (error) => {
            alert(`Error updating record: ${error instanceof Error ? error.message : 'Unable to update. Please try again.'}`);
            // Refresh to revert local changes
            queryClient.invalidateQueries({ queryKey: ['verified'] });
        }
    });

    const handleFieldChange = (index: number, field: string, value: string) => {
        const updated = [...records];
        updated[index] = { ...updated[index], [field]: value };
        setRecords(updated);
        setHasChanges(true);

        // Immediately update the specific row in the database
        updateRowMutation.mutate({ record: updated[index] });
    };

    const handleExport = async () => {
        try {
            await verifiedAPI.export('csv');
            alert('Export initiated! Check your downloads.');
        } catch (err) {
            alert('Export failed. Please try again.');
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

    const handleDeleteRow = async (index: number) => {
        if (confirm('Are you sure you want to delete this row from Verified Invoices?')) {
            try {
                // Remove from local state
                const updated = records.filter((_, i) => i !== index);
                setRecords(updated);

                // Save immediately to backend (Invoice Verified sheet only)
                await verifiedAPI.save(updated);

                // Refresh data
                queryClient.invalidateQueries({ queryKey: ['verified'] });

                alert('Row deleted successfully from Verified Invoices');
            } catch (error) {
                alert(`Error deleting row: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Verified Invoices</h1>
                    <p className="text-gray-600 mt-2">
                        View, edit, and export verified invoice data
                    </p>
                </div>
                <button
                    onClick={handleExport}
                    className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                >
                    <Download className="mr-2" size={16} />
                    Export to CSV
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
                            className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
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
                            {hasChanges && <span className="ml-2 text-orange-600">(unsaved changes)</span>}
                        </p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
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
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Upload Time</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {records.map((record, index) => (
                                    <tr key={index} className="hover:bg-gray-50">
                                        <td className="px-4 py-3">
                                            <input
                                                type="text"
                                                value={record['Receipt Number'] || ''}
                                                onChange={(e) => handleFieldChange(index, 'Receipt Number', e.target.value)}
                                                className="border border-gray-300 rounded px-2 py-1 w-20 text-sm"
                                            />
                                        </td>
                                        <td className="px-4 py-3">
                                            <input
                                                type="text"
                                                value={record['Date'] || ''}
                                                onChange={(e) => handleFieldChange(index, 'Date', e.target.value)}
                                                className="border border-gray-300 rounded px-2 py-1 w-28 text-sm"
                                                placeholder="DD-MMM-YYYY"
                                            />
                                        </td>
                                        <td className="px-4 py-3">
                                            <input
                                                type="text"
                                                value={record['Customer Name'] || ''}
                                                onChange={(e) => handleFieldChange(index, 'Customer Name', e.target.value)}
                                                className="border border-gray-300 rounded px-2 py-1 w-32 text-sm"
                                            />
                                        </td>
                                        <td className="px-4 py-3">
                                            <input
                                                type="text"
                                                value={record['Car Number'] || record['Vehicle Number'] || ''}
                                                onChange={(e) => handleFieldChange(index, 'Car Number', e.target.value)}
                                                className="border border-gray-300 rounded px-2 py-1 w-28 text-sm"
                                            />
                                        </td>
                                        <td className="px-4 py-3">
                                            <input
                                                type="text"
                                                value={record['Description'] || ''}
                                                onChange={(e) => handleFieldChange(index, 'Description', e.target.value)}
                                                className="border border-gray-300 rounded px-2 py-1 w-40 text-sm"
                                            />
                                        </td>
                                        <td className="px-4 py-3">
                                            <input
                                                type="text"
                                                value={record['Type'] || ''}
                                                onChange={(e) => handleFieldChange(index, 'Type', e.target.value)}
                                                className="border border-gray-300 rounded px-2 py-1 w-24 text-sm"
                                                placeholder="Type"
                                            />
                                        </td>
                                        <td className="px-4 py-3">
                                            <input
                                                type="number"
                                                step="0.1"
                                                value={record['Quantity'] || ''}
                                                onChange={(e) => handleFieldChange(index, 'Quantity', e.target.value)}
                                                className="border border-gray-300 rounded px-2 py-1 w-16 text-sm"
                                            />
                                        </td>
                                        <td className="px-4 py-3">
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={record['Rate'] || ''}
                                                onChange={(e) => handleFieldChange(index, 'Rate', e.target.value)}
                                                className="border border-gray-300 rounded px-2 py-1 w-20 text-sm"
                                            />
                                        </td>
                                        <td className="px-4 py-3">
                                            <input
                                                type="number"
                                                step="0.01"
                                                value={record['Amount'] || ''}
                                                onChange={(e) => handleFieldChange(index, 'Amount', e.target.value)}
                                                className="border border-gray-300 rounded px-2 py-1 w-24 text-sm"
                                            />
                                        </td>
                                        <td className="px-4 py-3">
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
                                        <td className="px-4 py-3 text-sm text-gray-600">
                                            {record['Upload Date'] ? new Date(record['Upload Date']).toLocaleDateString() : '—'}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-600">
                                            {record['Upload Date'] ? new Date(record['Upload Date']).toLocaleTimeString() : '—'}
                                        </td>
                                        <td className="px-4 py-3">
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
    );
};

export default VerifiedInvoicesPage;
