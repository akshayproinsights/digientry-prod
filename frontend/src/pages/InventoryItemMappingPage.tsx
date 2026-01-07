import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryAPI } from '../services/inventoryApi';
import apiClient from '../lib/api';
import { Loader2, ChevronDown, X, Check, RefreshCw, Search } from 'lucide-react';


interface CustomerItem {
    customer_item: string;
    occurrence_count: number;
    total_qty: number;
    normalized_description?: string | null;
    variation_count?: number;
    variations?: {
        original_description: string;
        occurrence_count: number;
        total_qty: number;
    }[];
}

interface VendorItem {
    id: number;
    description: string;
    part_number: string;
    qty?: number;
    rate?: number;
    match_score?: number;
}

const InventoryItemMappingPage: React.FC = () => {
    const [selectedMappings, setSelectedMappings] = useState<{ [key: string]: VendorItem | null }>({});
    const [customVendorInputs, setCustomVendorInputs] = useState<{ [key: string]: string }>({});
    const [priorities, setPriorities] = useState<{ [key: string]: number }>({});
    const [statuses, setStatuses] = useState<{ [key: string]: 'Pending' | 'Done' | 'Skipped' }>({});
    const [searchQueries, setSearchQueries] = useState<{ [key: string]: string }>({});
    const [searchResults, setSearchResults] = useState<{ [key: string]: VendorItem[] }>({});
    const [suggestions, setSuggestions] = useState<{ [key: string]: VendorItem[] }>({});
    const [openDropdowns, setOpenDropdowns] = useState<{ [key: string]: boolean }>({});
    const [loadingSuggestions, setLoadingSuggestions] = useState<{ [key: string]: boolean }>({});
    const [customerItemSearch, setCustomerItemSearch] = useState('');

    const queryClient = useQueryClient();
    const searchTimeoutRef = useRef<{ [key: string]: number }>({});
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdowns when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setOpenDropdowns({});
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Fetch unmapped items with search filter
    const { data: unmappedData, isLoading, error } = useQuery({
        queryKey: ['unmapped-customer-items', customerItemSearch],
        queryFn: () => inventoryAPI.getUnmappedCustomerItems(customerItemSearch || undefined),
    });



    const customerItems: CustomerItem[] = unmappedData?.items || [];

    // Compute page-level stats from displayed items and local statuses
    const pageStats = React.useMemo(() => {
        const doneCount = Object.values(statuses).filter(s => s === 'Done').length;
        const skippedCount = Object.values(statuses).filter(s => s === 'Skipped').length;
        const totalItems = customerItems.length + doneCount + skippedCount; // All items this session
        const pendingCount = customerItems.length; // Items still needing action
        const completionPercentage = totalItems > 0 ? Math.round(((doneCount + skippedCount) / totalItems) * 100) : 0;

        return {
            total: totalItems,
            pending: pendingCount,
            done: doneCount,
            skipped: skippedCount,
            completion_percentage: completionPercentage
        };
    }, [customerItems.length, statuses]);

    // Load suggestions for each item on mount
    useEffect(() => {
        customerItems.forEach(async (item) => {
            if (!suggestions[item.customer_item] && !loadingSuggestions[item.customer_item]) {
                setLoadingSuggestions(prev => ({ ...prev, [item.customer_item]: true }));
                try {
                    const response = await inventoryAPI.getCustomerItemSuggestions(item.customer_item);
                    setSuggestions(prev => ({
                        ...prev,
                        [item.customer_item]: response.suggestions || []
                    }));
                } catch (err) {
                    console.error('Error loading suggestions:', err);
                } finally {
                    setLoadingSuggestions(prev => ({ ...prev, [item.customer_item]: false }));
                }
            }
        });
    }, [customerItems]);

    const handleSearchChange = (customerItem: string, query: string) => {
        setSearchQueries(prev => ({ ...prev, [customerItem]: query }));

        // Clear existing timeout
        if (searchTimeoutRef.current[customerItem]) {
            clearTimeout(searchTimeoutRef.current[customerItem]);
        }

        // Debounce search (150ms for faster response)
        searchTimeoutRef.current[customerItem] = setTimeout(async () => {
            if (query.trim().length > 0) {
                try {
                    const response = await inventoryAPI.searchVendorItems(query, 20);
                    setSearchResults(prev => ({ ...prev, [customerItem]: response.results || [] }));
                } catch (err) {
                    console.error('Error searching:', err);
                }
            } else {
                setSearchResults(prev => ({ ...prev, [customerItem]: [] }));
            }
        }, 150);
    };

    const handleSelectItem = (customerItem: string, item: VendorItem) => {
        setSelectedMappings(prev => ({ ...prev, [customerItem]: item }));
        setCustomVendorInputs(prev => ({ ...prev, [customerItem]: item.description }));
        setOpenDropdowns(prev => ({ ...prev, [customerItem]: false }));
        setSearchQueries(prev => ({ ...prev, [customerItem]: '' }));
        setSearchResults(prev => ({ ...prev, [customerItem]: [] }));
    };

    const handleCustomVendorInput = (customerItem: string, value: string) => {
        setCustomVendorInputs(prev => ({ ...prev, [customerItem]: value }));
        // Clear selection if user types
        if (value !== selectedMappings[customerItem]?.description) {
            setSelectedMappings(prev => ({ ...prev, [customerItem]: null }));
        }
    };

    const handleClearSelection = (customerItem: string) => {
        setSelectedMappings(prev => ({ ...prev, [customerItem]: null }));
        setCustomVendorInputs(prev => ({ ...prev, [customerItem]: '' }));
    };

    // Remove a variation from its group (marks as Skipped)
    const handleRemoveVariation = async (variationDesc: string) => {
        if (!confirm(`Remove "${variationDesc}" from this group?\n\nIt will be marked as skipped.`)) {
            return;
        }

        try {
            await apiClient.post('/api/inventory-mapping/customer-items/remove-variation', null, {
                params: { customer_item: variationDesc }
            });
            queryClient.invalidateQueries({ queryKey: ['unmapped-customer-items'] });
        } catch (error) {
            alert(`Error removing variation: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    };


    const handlePriorityChange = (customerItem: string, value: number) => {
        setPriorities(prev => ({ ...prev, [customerItem]: value }));
    };

    // Confirm mapping mutation (no refresh, items stay visible)
    const confirmMutation = useMutation({
        mutationFn: async (customerItem: string) => {
            const selectedItem = selectedMappings[customerItem];
            const customInput = customVendorInputs[customerItem];
            const priority = priorities[customerItem] || 0;

            if (!customInput || customInput.trim() === '') {
                throw new Error('Please select or enter a vendor item');
            }

            return inventoryAPI.confirmCustomerItemMapping({
                customer_item: customerItem,
                normalized_description: customInput,
                vendor_item_id: selectedItem?.id,
                vendor_description: selectedItem?.description,
                vendor_part_number: selectedItem?.part_number,
                priority,
            });
        },
        onSuccess: (_data, customerItem) => {
            // Just update status locally, don't refresh the list
            setStatuses(prev => ({ ...prev, [customerItem]: 'Done' }));
            queryClient.invalidateQueries({ queryKey: ['customer-item-mapping-stats'] });
        },
        onError: (error) => {
            alert(`Error confirming mapping: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    // Skip mutation (no refresh, items stay visible)
    const skipMutation = useMutation({
        mutationFn: (customerItem: string) => inventoryAPI.skipCustomerItem(customerItem),
        onSuccess: (_data, customerItem) => {
            // Just update status locally, don't refresh the list
            setStatuses(prev => ({ ...prev, [customerItem]: 'Skipped' }));
            queryClient.invalidateQueries({ queryKey: ['customer-item-mapping-stats'] });
        },
        onError: (error) => {
            alert(`Error skipping item: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    // Sync mutation (refresh list to remove Done/Skipped items)
    const syncMutation = useMutation({
        mutationFn: inventoryAPI.syncCustomerItemMappings,
        onSuccess: (data) => {
            // Now refresh to remove synced items
            queryClient.invalidateQueries({ queryKey: ['unmapped-customer-items'] });
            queryClient.invalidateQueries({ queryKey: ['customer-item-mapping-stats'] });
            alert(`Successfully synced ${data.mappings_synced} mappings!`);
            // Clear local statuses
            setStatuses({});
        },
        onError: (error) => {
            alert(`Error syncing: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    });

    const handleStatusChange = (customerItem: string, newStatus: 'Pending' | 'Done' | 'Skipped') => {
        if (newStatus === 'Done') {
            confirmMutation.mutate(customerItem);
        } else if (newStatus === 'Skipped') {
            skipMutation.mutate(customerItem);
        }
        // Status is set by the mutation callbacks
    };

    const handleSyncFinish = () => {
        if (confirm('Are you sure you want to Sync & Finish? This will apply all completed mappings.')) {
            syncMutation.mutate();
        }
    };

    const getDropdownOptions = (customerItem: string): VendorItem[] => {
        const query = searchQueries[customerItem] || '';
        if (query.trim().length > 0) {
            return searchResults[customerItem] || [];
        }
        return suggestions[customerItem]?.slice(0, 7) || [];
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
            {/* Header */}
            <div>
                <h1 className="text-3xl font-bold text-gray-900">Map Items</h1>
                <p className="text-gray-600 mt-2">
                    Map your invoice items to standardized vendor parts inventory
                </p>
            </div>

            {/* Search Filter */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                    <input
                        type="text"
                        value={customerItemSearch}
                        onChange={(e) => setCustomerItemSearch(e.target.value)}
                        placeholder="Search customer items..."
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                </div>
            </div>

            {/* Sync Button */}
            <div className="flex justify-end">
                <button
                    onClick={handleSyncFinish}
                    disabled={syncMutation.isPending || pageStats.done === 0}
                    className={`flex items-center px-4 py-2 rounded-lg transition ${pageStats.done > 0
                        ? 'bg-green-600 text-white hover:bg-green-700 animate-pulse'
                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        }`}
                >
                    {syncMutation.isPending ? (
                        <Loader2 className="animate-spin mr-2" size={16} />
                    ) : (
                        <RefreshCw className="mr-2" size={16} />
                    )}
                    Sync & Finish
                    {pageStats.done > 0 && (
                        <span className="ml-2 bg-white text-green-600 rounded-full px-2 py-0.5 text-xs font-semibold">
                            {pageStats.done}
                        </span>
                    )}
                </button>
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
                                {pageStats.pending} Pending
                            </span>
                        </div>
                        {pageStats.done > 0 && (
                            <div className="flex items-center gap-2">
                                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                                    {pageStats.done} Done
                                </span>
                            </div>
                        )}
                        {pageStats.skipped > 0 && (
                            <div className="flex items-center gap-2">
                                <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-800">
                                    {pageStats.skipped} Skipped
                                </span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Progress Bar */}
                {pageStats.total > 0 && (
                    <div className="mt-4">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium text-gray-600">Mapping Progress</span>
                            <span className="text-xs font-semibold text-gray-700">
                                {pageStats.completion_percentage}% Complete
                            </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2.5">
                            <div
                                className="bg-gradient-to-r from-green-500 to-green-600 h-2.5 rounded-full transition-all duration-500 ease-out"
                                style={{ width: `${pageStats.completion_percentage}%` }}
                            ></div>
                        </div>
                        <div className="flex items-center justify-between mt-1">
                            <span className="text-xs text-gray-500">
                                {pageStats.done} of {pageStats.total} mapped
                            </span>
                            {pageStats.pending > 0 && (
                                <span className="text-xs text-yellow-600">
                                    {pageStats.pending} remaining
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Table */}
            {customerItems.length === 0 ? (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
                    <p className="text-gray-500">No items to map. All caught up! 🎉</p>
                </div>
            ) : (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-200">
                        <p className="text-sm text-gray-600">
                            Showing <span className="font-medium">{customerItems.length}</span> unmapped items
                        </p>
                    </div>
                    <div className="overflow-x-auto" ref={dropdownRef}>
                        <table className="w-full">
                            <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Customer Item</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Vendor Item Name</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Priority</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {customerItems.map((item) => {
                                    const status = statuses[item.customer_item] || 'Pending';
                                    const isCompleted = status === 'Done';

                                    return (
                                        <tr key={item.customer_item} className={isCompleted ? 'bg-green-50' : status === 'Skipped' ? 'bg-red-50' : 'hover:bg-gray-50'}>
                                            {/* Customer Item */}
                                            <td className="px-6 py-4">
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <p className="font-medium text-gray-900">{item.customer_item}</p>
                                                        {item.variation_count && item.variation_count > 1 && (
                                                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                                                                {item.variation_count} variations
                                                            </span>
                                                        )}
                                                    </div>
                                                    {item.normalized_description && (
                                                        <p className="text-xs text-blue-600">Normalized: {item.normalized_description}</p>
                                                    )}
                                                    <p className="text-xs text-gray-500">{item.occurrence_count} invoice(s)</p>

                                                    {/* Show variations inline */}
                                                    {item.variations && item.variations.length > 1 && (
                                                        <div className="mt-2 space-y-1 pl-3 border-l-2 border-gray-200">
                                                            {item.variations.map((variation, idx) => (
                                                                <div key={idx} className="flex items-center justify-between text-xs group">
                                                                    <span className="text-gray-600">
                                                                        <span className="text-gray-400">├─</span> {variation.original_description}
                                                                        <span className="text-gray-400 ml-1">({variation.occurrence_count} invoice(s))</span>
                                                                    </span>
                                                                    <button
                                                                        onClick={() => handleRemoveVariation(variation.original_description)}
                                                                        className="opacity-0 group-hover:opacity-100 transition ml-2 text-red-600 hover:text-red-800"
                                                                        title="Remove this variation from group"
                                                                        disabled={isCompleted}
                                                                    >
                                                                        <X size={14} />
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Vendor Item Name - Unified Combo-Box */}
                                            <td className="px-6 py-4">
                                                <div className="relative">
                                                    {/* Unified Input with integrated dropdown trigger */}
                                                    <div className="flex gap-2">
                                                        <div className="relative flex-1">
                                                            <input
                                                                type="text"
                                                                value={customVendorInputs[item.customer_item] || ''}
                                                                onChange={(e) => {
                                                                    handleCustomVendorInput(item.customer_item, e.target.value);
                                                                    // Also trigger search on typing
                                                                    handleSearchChange(item.customer_item, e.target.value);
                                                                    // Open dropdown when typing
                                                                    if (!openDropdowns[item.customer_item]) {
                                                                        setOpenDropdowns(prev => ({ ...prev, [item.customer_item]: true }));
                                                                    }
                                                                }}
                                                                onFocus={() => {
                                                                    // Open dropdown on focus
                                                                    if (!isCompleted) {
                                                                        setOpenDropdowns(prev => ({ ...prev, [item.customer_item]: true }));
                                                                    }
                                                                }}
                                                                placeholder="Type or select vendor item..."
                                                                className="w-full border rounded-lg px-3 py-2 pr-8 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                                                disabled={isCompleted}
                                                            />
                                                            {/* Integrated chevron icon */}
                                                            <button
                                                                onClick={() => setOpenDropdowns(prev => ({ ...prev, [item.customer_item]: !prev[item.customer_item] }))}
                                                                className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                                                disabled={isCompleted}
                                                                type="button"
                                                            >
                                                                <ChevronDown size={16} className={`transition-transform ${openDropdowns[item.customer_item] ? 'rotate-180' : ''}`} />
                                                            </button>
                                                        </div>
                                                        {customVendorInputs[item.customer_item] && (
                                                            <button
                                                                onClick={() => handleClearSelection(item.customer_item)}
                                                                className="px-3 py-2 border rounded-lg bg-white hover:bg-red-50 text-red-600 transition"
                                                                disabled={isCompleted}
                                                                title="Clear"
                                                            >
                                                                <X size={16} />
                                                            </button>
                                                        )}
                                                    </div>

                                                    {/* Dropdown - appears on focus or click */}
                                                    {openDropdowns[item.customer_item] && (
                                                        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-xl max-h-72 overflow-y-auto">
                                                            {/* Results */}
                                                            <div>
                                                                {loadingSuggestions[item.customer_item] ? (
                                                                    <div className="p-4 text-center text-gray-500 text-sm flex items-center justify-center gap-2">
                                                                        <Loader2 className="animate-spin" size={16} />
                                                                        Loading suggestions...
                                                                    </div>
                                                                ) : getDropdownOptions(item.customer_item).length === 0 ? (
                                                                    <div className="p-4 text-center text-gray-500 text-sm">
                                                                        {customVendorInputs[item.customer_item] ?
                                                                            'No matches found. Press Enter to use custom value.' :
                                                                            'Start typing to search...'}
                                                                    </div>
                                                                ) : (
                                                                    getDropdownOptions(item.customer_item).map((vendorItem) => (
                                                                        <button
                                                                            key={vendorItem.id}
                                                                            onClick={() => handleSelectItem(item.customer_item, vendorItem)}
                                                                            className="w-full px-4 py-3 text-left hover:bg-blue-50 border-b last:border-b-0 transition"
                                                                        >
                                                                            <div className="flex justify-between items-start">
                                                                                <div className="flex-1">
                                                                                    <p className="font-medium text-gray-900 text-sm">{vendorItem.description}</p>
                                                                                    <p className="text-xs text-gray-500 mt-1">Part: {vendorItem.part_number || 'N/A'}</p>
                                                                                </div>
                                                                                {vendorItem.match_score && (
                                                                                    <span className={`ml-2 px-2 py-1 rounded text-xs font-medium ${vendorItem.match_score >= 80 ? 'bg-green-100 text-green-800' :
                                                                                        vendorItem.match_score >= 60 ? 'bg-yellow-100 text-yellow-800' :
                                                                                            'bg-gray-100 text-gray-800'
                                                                                        }`}>
                                                                                        {Math.round(vendorItem.match_score)}% match
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                        </button>
                                                                    ))
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Priority */}
                                            <td className="px-6 py-4">
                                                <select
                                                    value={priorities[item.customer_item] || 0}
                                                    onChange={(e) => handlePriorityChange(item.customer_item, parseInt(e.target.value))}
                                                    className="border rounded px-3 py-2"
                                                    disabled={isCompleted}
                                                >
                                                    <option value={0}>0</option>
                                                    <option value={1}>1</option>
                                                    <option value={2}>2</option>
                                                    <option value={3}>3</option>
                                                    <option value={4}>4</option>
                                                </select>
                                            </td>

                                            {/* Status */}
                                            <td className="px-6 py-4">
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => handleStatusChange(item.customer_item, 'Skipped')}
                                                        className="px-3 py-1 rounded text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition"
                                                    >
                                                        Skip
                                                    </button>
                                                    <button
                                                        onClick={() => handleStatusChange(item.customer_item, 'Done')}
                                                        className="px-3 py-1 rounded text-sm font-medium bg-green-600 text-white hover:bg-green-700 transition flex items-center gap-1"
                                                    >
                                                        <Check size={14} />
                                                        Mark as Done
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )
            }
        </div >
    );
};

export default InventoryItemMappingPage;
