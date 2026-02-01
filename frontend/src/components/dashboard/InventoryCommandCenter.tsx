import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Search, ShoppingCart, CheckCircle2, ClipboardList } from 'lucide-react';
import { dashboardAPI } from '../../services/dashboardAPI';
import StockStepper from './StockStepper';

interface InventoryItem {
    part_number: string;
    item_name: string;
    current_stock: number;
    reorder_point: number;
    stock_value: number;
    priority?: string;
    unit_value?: number; // Last buy price
}

interface InventoryCommandCenterProps {
    draftPOItems: Map<string, any>;
    onAddToDraft: (item: InventoryItem) => void;
}

type PriorityTab = 'All Items' | 'P0 - High' | 'P1 - Medium' | 'P2 - Low' | 'P3 - Least';
type PriorityValue = '' | 'P0' | 'P1' | 'P2' | 'P3';

const QuickReorderList: React.FC<InventoryCommandCenterProps> = ({ draftPOItems, onAddToDraft }) => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [activeTab, setActiveTab] = useState<PriorityTab>('All Items');
    const [searchQuery, setSearchQuery] = useState('');

    // Map display tab names to API priority values
    const tabToPriority = (tab: PriorityTab): PriorityValue => {
        switch (tab) {
            case 'All Items': return '';
            case 'P0 - High': return 'P0';
            case 'P1 - Medium': return 'P1';
            case 'P2 - Low': return 'P2';
            case 'P3 - Least': return 'P3';
        }
    };

    // Fetch inventory data with React Query - AUTO-REFRESH enabled
    const { data: inventoryData, isLoading } = useQuery({
        queryKey: ['inventoryByPriority', tabToPriority(activeTab)],
        queryFn: () => dashboardAPI.getInventoryByPriority(tabToPriority(activeTab) || undefined),
        // AUTO-REFRESH CONFIGURATION:
        refetchOnWindowFocus: true,        // Refetch when user returns to the tab
        staleTime: 1000 * 60 * 5,          // Data is fresh for 5 minutes
        refetchInterval: 1000 * 60,        // Poll every 1 minute automatically
    });

    // Fetch search results when query is present
    const { data: searchData, isLoading: searchLoading } = useQuery({
        queryKey: ['inventorySearch', searchQuery],
        queryFn: () => dashboardAPI.searchInventory(searchQuery, 100),
        enabled: searchQuery.trim().length > 0, // Only run when there's a search query
        staleTime: 1000 * 30, // 30 seconds
    });

    const handleTabChange = (tab: PriorityTab) => {
        setActiveTab(tab);
        setSearchQuery(''); // Clear search when changing tabs
    };

    // Handle stock updates with optimistic cache updates
    const handleStockUpdate = async (partNumber: string, newStock: number) => {
        // Optimistically update caches
        const updateItemInList = (items: InventoryItem[]) => {
            return items.map(item => {
                if (item.part_number === partNumber) {
                    return { ...item, current_stock: newStock };
                }
                return item;
            });
        };

        // Update main inventory cache
        queryClient.setQueryData(['inventoryByPriority', tabToPriority(activeTab)], (oldData: any) => {
            if (!oldData) return oldData;

            // Deep update if possible, but simplified here for the list we use
            // The structure is { summary: ..., critical_items: [...] }
            if (oldData.critical_items) {
                return {
                    ...oldData,
                    critical_items: updateItemInList(oldData.critical_items)
                };
            }
            return oldData;
        });

        // Update search cache if active
        if (searchQuery) {
            queryClient.setQueryData(['inventorySearch', searchQuery], (oldData: any) => {
                if (!oldData) return oldData;
                if (oldData.items) {
                    return {
                        ...oldData,
                        items: updateItemInList(oldData.items)
                    };
                }
                return oldData;
            });
        }

        // Perform actual API call
        return dashboardAPI.updateStock(partNumber, newStock);
    };

    // Use search results if searching, otherwise use priority-filtered items
    const rawItems: InventoryItem[] = useMemo(() => {
        if (searchQuery.trim() && searchData?.items) {
            return searchData.items.map((item: any) => ({
                part_number: item.part_number,
                item_name: item.item_name,
                current_stock: item.current_stock,
                reorder_point: item.reorder_point,
                stock_value: item.current_stock * 100, // Approximate if value missing
                priority: item.priority,
                unit_value: item.unit_value, // Price data if available
            }));
        }

        return inventoryData?.critical_items?.map((item: any) => ({
            part_number: item.part_number,
            item_name: item.item_name,
            current_stock: item.current_stock,
            reorder_point: item.reorder_point,
            stock_value: item.current_stock * 100,
            priority: item.priority,
            unit_value: item.unit_value, // Price data if available
        })) || [];
    }, [searchQuery, searchData, inventoryData]);

    // 4-Level Status Logic - COMPACT BADGES for data density
    const getStockStatus = (item: InventoryItem): { label: string; color: string } => {
        const stock = item.current_stock;

        // Condition 1: Critical Error (Negative Stock) - Missing Purchase Bill
        if (stock < 0) {
            return { label: 'Missing Purchase Bill', color: 'bg-purple-100 text-purple-700' };
        }

        // Condition 2: Out of Stock - SHORTENED
        if (stock === 0) {
            return { label: 'Out of Stock', color: 'bg-red-100 text-red-700' };
        }

        // Condition 3: Low Stock (stock <= reorder_level)
        if (stock <= item.reorder_point) {
            return { label: 'Low Stock', color: 'bg-orange-100 text-orange-800' };
        }

        // Condition 4: Healthy
        return { label: 'In Stock', color: 'bg-green-100 text-green-800' };
    };

    // Dynamic progress bar calculation
    const getStockPercentage = (item: InventoryItem): number => {
        if (item.current_stock < 0) return 0;
        if (item.reorder_point === 0) return 100;

        // Calculate percentage relative to reorder point, capped at 100%
        // Visual tweak: if stock > reorder point, show full bar
        const percentage = (item.current_stock / item.reorder_point) * 100;
        return Math.min(percentage, 100);
    };

    const getProgressBarColor = (item: InventoryItem): string => {
        const stock = item.current_stock;

        // Purple for negative stock
        if (stock < 0) return 'bg-purple-600';

        // Red for zero stock
        if (stock === 0) return 'bg-red-600';

        // Orange for low stock
        if (stock <= item.reorder_point) return 'bg-orange-500';

        // Green for healthy stock
        return 'bg-green-500';
    };

    // Smart Sorting: Negative stock → Zero stock → Low stock → Others
    const criticalItems = useMemo(() => {
        return [...rawItems].sort((a, b) => {
            // Priority 1: Negative stock items first
            if (a.current_stock < 0 && b.current_stock >= 0) return -1;
            if (b.current_stock < 0 && a.current_stock >= 0) return 1;

            // Priority 2: Zero stock items second
            if (a.current_stock === 0 && b.current_stock > 0) return -1;
            if (b.current_stock === 0 && a.current_stock > 0) return 1;

            // Priority 3: Low stock items third
            const aIsLow = a.current_stock > 0 && a.current_stock <= a.reorder_point;
            const bIsLow = b.current_stock > 0 && b.current_stock <= b.reorder_point;

            if (aIsLow && !bIsLow) return -1;
            if (bIsLow && !aIsLow) return 1;

            // Default: maintain original order
            return 0;
        });
    }, [rawItems]);

    // Smart Sorting: Pending items first, then Draft items (pushed to bottom)
    const sortedItems = useMemo(() => {
        return [...criticalItems].sort((a, b) => {
            // Primary Sort: Non-draft items first, draft items to bottom
            const aInDraft = draftPOItems.has(a.part_number);
            const bInDraft = draftPOItems.has(b.part_number);

            if (!aInDraft && bInDraft) return -1; // a is pending, b is done → a first
            if (aInDraft && !bInDraft) return 1;  // a is done, b is pending → b first

            // Secondary Sort: Within same status group, maintain urgency sorting
            // (Already sorted by criticalItems: negative → zero → low → others)
            return 0; // Maintain original order
        });
    }, [criticalItems, draftPOItems]);

    // Format price with ₹ symbol
    const formatPrice = (price?: number): string => {
        if (price === null || price === undefined) return '₹--';
        return `₹${Math.round(price)}`;
    };

    const tabs: PriorityTab[] = ['All Items', 'P0 - High', 'P1 - Medium', 'P2 - Low', 'P3 - Least'];

    return (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            {/* Header with Tabs */}
            <div className="border-b border-gray-200">
                <div className="px-6 pt-4">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-lg font-semibold text-gray-900">Quick Reorder List (Top Critical Items)</h2>
                        <button
                            onClick={() => navigate('/inventory/stock')}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors duration-200"
                        >
                            <ClipboardList size={16} />
                            My Stock Register
                        </button>
                    </div>
                    <div className="flex gap-1">
                        {tabs.map((tab) => (
                            <button
                                key={tab}
                                onClick={() => handleTabChange(tab)}
                                className={`px-4 py-2 text-sm font-medium rounded-t-lg transition ${activeTab === tab
                                    ? 'bg-indigo-600 text-white'
                                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                                    }`}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Search Bar */}
            <div className="px-6 pt-4">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search by item name or part number..."
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                    />
                </div>
            </div>

            {/* Content - Full Width Table with Sticky Header */}
            <div className="p-6">
                {(isLoading || searchLoading) ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
                    </div>
                ) : sortedItems.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                        <AlertTriangle className="mx-auto mb-2" size={32} />
                        <p>{searchQuery.trim() ? 'No items found matching your search.' : 'All items are in stock!'}</p>
                    </div>
                ) : (
                    <div className="w-full overflow-x-auto">
                        {/* Scrollable Container with Fixed Height */}
                        <div className="h-[400px] overflow-y-auto border border-gray-200 rounded-lg">
                            <table className="w-full">
                                {/* Sticky Header */}
                                <thead className="sticky top-0 z-10 bg-gray-50 shadow-sm">
                                    <tr className="border-b border-gray-200 text-left">
                                        <th className="px-4 py-2 text-sm font-semibold text-gray-700">Item Details</th>
                                        <th className="px-4 py-2 text-sm font-semibold text-gray-700 bg-orange-50/50">On Hand</th>
                                        <th className="px-4 py-2 text-sm font-semibold text-gray-700">Stock Status</th>
                                        <th className="px-4 py-2 text-sm font-semibold text-gray-700">Status</th>
                                        <th className="px-4 py-2 text-sm font-semibold text-gray-700 text-right">Last Price</th>
                                        <th className="px-4 py-2 text-sm font-semibold text-gray-700">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white">
                                    {sortedItems.map((item, index) => {
                                        const status = getStockStatus(item);
                                        const stockPercent = getStockPercentage(item);
                                        const progressColor = getProgressBarColor(item);
                                        const isInDraft = draftPOItems.has(item.part_number);
                                        const draftQty = isInDraft ? draftPOItems.get(item.part_number)?.reorder_qty : null;

                                        return (
                                            <tr
                                                key={item.part_number || index}
                                                className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${isInDraft ? 'bg-gray-50 opacity-75' : ''
                                                    }`}
                                            >
                                                {/* Column 1: Item Details */}
                                                <td className="px-4 py-2.5">
                                                    <div>
                                                        <h4 className="font-bold text-gray-900 text-sm">
                                                            {item.item_name}
                                                        </h4>
                                                        <p className="text-xs text-gray-500 mt-0.5">
                                                            {item.part_number}
                                                        </p>
                                                    </div>
                                                </td>

                                                {/* Column 2: On Hand - Editable Stepper */}
                                                <td className="px-4 py-2.5 bg-orange-50/30">
                                                    <StockStepper
                                                        currentStock={item.current_stock}
                                                        partNumber={item.part_number}
                                                        onUpdate={handleStockUpdate}
                                                    />
                                                </td>

                                                {/* Column 3: Visual Stock Status (Progress + Reorder Limit) */}
                                                <td className="px-4 py-2.5">
                                                    <div className="min-w-[140px] max-w-[180px]">
                                                        <div className="w-full bg-gray-200 rounded-full h-2.5 mb-1.5">
                                                            <div
                                                                className={`${progressColor} h-2.5 rounded-full transition-all duration-500 ease-out`}
                                                                style={{ width: `${stockPercent}%` }}
                                                            ></div>
                                                        </div>
                                                        <p className="text-xs text-gray-500 tabular-nums font-medium">
                                                            Reorder Limit: <span className="text-gray-900">{item.reorder_point}</span>
                                                        </p>
                                                    </div>
                                                </td>

                                                {/* Column 4: Status Badge */}
                                                <td className="px-4 py-2.5">
                                                    <span
                                                        className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${status.color}`}
                                                    >
                                                        {status.label}
                                                    </span>
                                                </td>

                                                {/* Column 5: Last Price (Right-Aligned) */}
                                                <td className="px-4 py-2.5 text-right">
                                                    <span className="text-sm text-gray-600 font-medium tabular-nums">
                                                        {formatPrice(item.unit_value)}
                                                    </span>
                                                </td>

                                                {/* Column 6: Action */}
                                                <td className="px-4 py-2.5">
                                                    {isInDraft ? (
                                                        <div className="flex items-center gap-1.5 px-2.5 h-8 rounded-md font-medium text-xs bg-green-100 text-green-700 border border-green-300">
                                                            <CheckCircle2 size={14} className="flex-shrink-0" />
                                                            <span className="whitespace-nowrap">Added ({draftQty})</span>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => onAddToDraft(item)}
                                                            className="flex items-center gap-1.5 px-2.5 h-8 rounded-md font-medium text-xs transition-all duration-200 active:scale-95 bg-indigo-600 text-white hover:bg-indigo-700"
                                                        >
                                                            <ShoppingCart size={14} />
                                                            <span>Add</span>
                                                        </button>
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
            </div>
        </div>
    );
};

export default QuickReorderList;

