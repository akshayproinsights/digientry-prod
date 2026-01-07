import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryAPI } from '../services/inventoryApi';
import { Loader2, ChevronDown, Info, X } from 'lucide-react';
import StatusToggle from '../components/StatusToggle';

interface GroupedItem {
    id?: number;
    customer_item: string;
    grouped_count: number;
    grouped_invoice_ids: number[];
    grouped_descriptions: string[];  // Add new field
    status: string;
    mapped_description: string | null;
    mapped_inventory_item_id: number | null;
    confirmed_at: string | null;
}

interface InventoryItem {
    id: number;
    description: string;
    part_number: string;
}

const InventoryMappingPage: React.FC = () => {
    const [page, setPage] = useState(1);
    const [showCompleted, setShowCompleted] = useState(false);
    const [selectedMappings, setSelectedMappings] = useState<{ [key: string]: InventoryItem | null }>({});
    const [searchQueries, setSearchQueries] = useState<{ [key: string]: string }>({});
    const [searchResults, setSearchResults] = useState<{ [key: string]: InventoryItem[] }>({});
    const [suggestions, setSuggestions] = useState<{ [key: string]: InventoryItem[] }>({});
    const [openDropdowns, setOpenDropdowns] = useState<{ [key: string]: boolean }>({});
    const [loadingSuggestions, setLoadingSuggestions] = useState<{ [key: string]: boolean }>({});

    const queryClient = useQueryClient();
    const searchTimeoutRef = useRef<{ [key: string]: number }>({});
    const limit = 20;

    // Fetch grouped items
    const { data, isLoading, error } = useQuery({
        queryKey: ['inventory-mapping', page, showCompleted],
        queryFn: async () => {
            const status = showCompleted ? undefined : 'Pending';
            return inventoryAPI.getGroupedItems(page, limit, status);
        },
    });

    const groupedItems: GroupedItem[] = data?.items || [];
    const total = data?.total || 0;
    const totalPages = Math.ceil(total / limit);

    // Load suggestions for each item on mount
    useEffect(() => {
        groupedItems.forEach(async (item) => {
            if (!suggestions[item.customer_item] && !loadingSuggestions[item.customer_item]) {
                setLoadingSuggestions(prev => ({ ...prev, [item.customer_item]: true }));
                try {
                    const response = await inventoryAPI.getInventorySuggestions(item.customer_item);
                    setSuggestions(prev => ({
                        ...prev,
                        [item.customer_item]: response.suggestions || []
                    }));

                    // Pre-select if already mapped
                    if (item.mapped_inventory_item_id && item.mapped_description) {
                        setSelectedMappings(prev => ({
                            ...prev,
                            [item.customer_item]: {
                                id: item.mapped_inventory_item_id!,
                                description: item.mapped_description!,
                                part_number: 'N/A'
                            }
                        }));
                    }
                } catch (err) {
                    console.error('Error loading suggestions:', err);
                } finally {
                    setLoadingSuggestions(prev => ({ ...prev, [item.customer_item]: false }));
                }
            }
        });
    }, [groupedItems]);

    // Confirm mapping mutation
    const confirmMappingMutation = useMutation({
        mutationFn: async (data: {
            customer_item: string;
            grouped_invoice_ids: number[];
            mapped_inventory_item_id: number;
            mapped_inventory_description: string;
        }) => {
            return inventoryAPI.confirmMapping(data);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inventory-mapping'] });
        },
        onError: (error) => {
            alert(`Error confirming mapping: ${error instanceof Error ? error.message : 'Unknown error'} `);
        }
    });

    // Update status mutation
    const updateStatusMutation = useMutation({
        mutationFn: async (data: { id: number; status: string }) => {
            return inventoryAPI.updateMappingStatus(data.id, data.status);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['inventory-mapping'] });
        },
        onError: (error) => {
            alert(`Error updating status: ${error instanceof Error ? error.message : 'Unknown error'} `);
        }
    });

    const handleSearchChange = (customerItem: string, query: string) => {
        setSearchQueries(prev => ({ ...prev, [customerItem]: query }));

        // Clear existing timeout
        if (searchTimeoutRef.current[customerItem]) {
            clearTimeout(searchTimeoutRef.current[customerItem]);
        }

        // Debounce search (300ms)
        searchTimeoutRef.current[customerItem] = setTimeout(async () => {
            if (query.trim().length > 0) {
                try {
                    const response = await inventoryAPI.searchInventory(query, 10);
                    setSearchResults(prev => ({
                        ...prev,
                        [customerItem]: response.results || []
                    }));
                } catch (err) {
                    console.error('Error searching inventory:', err);
                }
            } else {
                setSearchResults(prev => ({ ...prev, [customerItem]: [] }));
            }
        }, 300);
    };

    const handleSelectItem = (customerItem: string, item: InventoryItem) => {
        setSelectedMappings(prev => ({ ...prev, [customerItem]: item }));
        setOpenDropdowns(prev => ({ ...prev, [customerItem]: false }));
        setSearchQueries(prev => ({ ...prev, [customerItem]: '' }));
        setSearchResults(prev => ({ ...prev, [customerItem]: [] }));
    };

    const handleClearSelection = (customerItem: string) => {
        setSelectedMappings(prev => ({ ...prev, [customerItem]: null }));
    };

    const handleStatusChange = (item: GroupedItem, newStatus: string) => {
        // If changing to "Done" (Confirm Match), validate and confirm mapping first
        if (newStatus === 'Done') {
            const selectedItem = selectedMappings[item.customer_item];

            if (!selectedItem) {
                alert('Please select an inventory item before confirming');
                return;
            }

            // Auto-confirm the mapping
            confirmMappingMutation.mutate({
                customer_item: item.customer_item,
                grouped_invoice_ids: item.grouped_invoice_ids,
                mapped_inventory_item_id: selectedItem.id,
                mapped_inventory_description: selectedItem.description
            });
        } else if (item.id) {
            // Just update status if going back to Pending
            updateStatusMutation.mutate({ id: item.id, status: newStatus });
        }
    };

    const getDropdownOptions = (customerItem: string): InventoryItem[] => {
        const query = searchQueries[customerItem] || '';
        if (query.trim().length > 0) {
            return searchResults[customerItem] || [];
        }
        return suggestions[customerItem]?.slice(0, 5) || [];
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
                    <h1 className="text-3xl font-bold text-gray-900">Inventory Mapping</h1>
                    <p className="text-gray-600 mt-2">
                        Map customer items from invoices to standardized inventory items
                    </p>
                </div>
                <button
                    onClick={() => setShowCompleted(!showCompleted)}
                    className={`flex items - center px - 4 py - 2 rounded - lg transition ${showCompleted
                        ? 'bg-green-100 text-green-700 hover:bg-green-200'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        } `}
                >
                    {showCompleted ? '✓ Showing All' : 'Show Pending Only'}
                </button>
            </div>

            {groupedItems.length === 0 ? (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
                    <p className="text-gray-500">No items to map. All caught up!</p>
                </div>
            ) : (
                <>
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-200">
                            <p className="text-sm text-gray-600">
                                Showing <span className="font-medium">{groupedItems.length}</span> of{' '}
                                <span className="font-medium">{total}</span> items
                            </p>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-gray-50 border-b border-gray-200">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                                            Customer Item (Bill)
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                                            Grouped Items
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                                            Mapped Vendor Item (Invoice)
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                                            Confirm Match
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {groupedItems.map((item, index) => {
                                        const isConfirmed = item.status === 'Done';
                                        const rowClass = isConfirmed ? 'bg-green-50' : 'hover:bg-gray-50';

                                        return (
                                            <tr key={index} className={rowClass}>
                                                {/* Customer Item Column */}
                                                <td className="px-6 py-4">
                                                    <div className="space-y-1">
                                                        <p className="font-medium text-gray-900">
                                                            {item.customer_item}
                                                        </p>
                                                        <div className="flex items-center gap-2 text-xs text-gray-500">
                                                            <Info size={12} />
                                                            <span>
                                                                {item.grouped_count} invoice(s) grouped
                                                            </span>
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* Grouped Items Column - NEW */}
                                                <td className="px-6 py-4">
                                                    <div className="space-y-1">
                                                        {item.grouped_descriptions && item.grouped_descriptions.length > 0 ? (
                                                            <details className="text-xs">
                                                                <summary className="cursor-pointer text-blue-600 hover:text-blue-800 font-medium">
                                                                    View {item.grouped_descriptions.length} unique item(s)
                                                                </summary>
                                                                <ul className="mt-2 space-y-1 pl-4 list-disc text-gray-700 max-h-32 overflow-y-auto">
                                                                    {item.grouped_descriptions.map((desc, idx) => (
                                                                        <li key={idx} className="text-xs">{desc}</li>
                                                                    ))}
                                                                </ul>
                                                            </details>
                                                        ) : (
                                                            <span className="text-gray-400 text-xs">No descriptions</span>
                                                        )}
                                                    </div>
                                                </td>

                                                {/* Mapped Vendor Item Dropdown */}
                                                <td className="px-6 py-4">
                                                    <div className="relative">
                                                        <div className="flex gap-2">
                                                            <button
                                                                onClick={() => {
                                                                    if (!isConfirmed) {
                                                                        setOpenDropdowns(prev => ({
                                                                            ...prev,
                                                                            [item.customer_item]: !prev[item.customer_item]
                                                                        }));
                                                                    }
                                                                }}
                                                                disabled={isConfirmed}
                                                                className={`flex - 1 flex items - center justify - between px - 4 py - 2 border rounded - lg text - left ${isConfirmed
                                                                    ? 'bg-gray-100 cursor-not-allowed'
                                                                    : 'bg-white hover:bg-gray-50 cursor-pointer'
                                                                    } border - gray - 300`}
                                                            >
                                                                <span className={selectedMappings[item.customer_item] ? 'text-gray-900' : 'text-gray-400'}>
                                                                    {selectedMappings[item.customer_item]?.description || 'Select item...'}
                                                                </span>
                                                                {!isConfirmed && <ChevronDown size={16} className="text-gray-400" />}
                                                            </button>

                                                            {/* Clear Selection Button */}
                                                            {selectedMappings[item.customer_item] && !isConfirmed && (
                                                                <button
                                                                    onClick={() => handleClearSelection(item.customer_item)}
                                                                    className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-red-50 hover:border-red-300 transition"
                                                                    title="Clear selection"
                                                                >
                                                                    <X size={16} className="text-red-600" />
                                                                </button>
                                                            )}
                                                        </div>

                                                        {/* Dropdown Menu */}
                                                        {openDropdowns[item.customer_item] && !isConfirmed && (
                                                            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-80 overflow-y-auto">
                                                                {/* Search Input */}
                                                                <div className="sticky top-0 bg-white p-2 border-b">
                                                                    <input
                                                                        type="text"
                                                                        placeholder="Type to search..."
                                                                        value={searchQueries[item.customer_item] || ''}
                                                                        onChange={(e) => handleSearchChange(item.customer_item, e.target.value)}
                                                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                                                                        autoFocus
                                                                    />
                                                                </div>

                                                                {/* Options List */}
                                                                <div className="py-1">
                                                                    {loadingSuggestions[item.customer_item] ? (
                                                                        <div className="flex items-center justify-center py-4">
                                                                            <Loader2 className="animate-spin text-gray-400" size={20} />
                                                                        </div>
                                                                    ) : getDropdownOptions(item.customer_item).length > 0 ? (
                                                                        getDropdownOptions(item.customer_item).map((option) => (
                                                                            <button
                                                                                key={option.id}
                                                                                onClick={() => handleSelectItem(item.customer_item, option)}
                                                                                className="w-full px-4 py-2 text-left hover:bg-blue-50 transition"
                                                                            >
                                                                                <p className="text-sm text-gray-900">{option.description}</p>
                                                                                <p className="text-xs text-gray-500">Part: {option.part_number}</p>
                                                                            </button>
                                                                        ))
                                                                    ) : (
                                                                        <div className="px-4 py-3 text-sm text-gray-500">
                                                                            No results found
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>

                                                {/* Confirm Match Column (was Status) - NO ACTION COLUMN */}
                                                <td className="px-6 py-4">
                                                    <StatusToggle
                                                        status={item.status}
                                                        onChange={(newStatus) => handleStatusChange(item, newStatus)}
                                                        disabled={!selectedMappings[item.customer_item] && item.status === 'Pending'}
                                                    />
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex justify-center gap-2">
                            <button
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page === 1}
                                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Previous
                            </button>
                            <span className="px-4 py-2 text-gray-700">
                                Page {page} of {totalPages}
                            </span>
                            <button
                                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                disabled={page === totalPages}
                                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Next
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default InventoryMappingPage;
