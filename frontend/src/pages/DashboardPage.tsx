import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useGlobalStatus } from '../contexts/GlobalStatusContext';
import {
    ChevronDown,
    X,
    ShoppingCart,
    Package,
    Calendar,
} from 'lucide-react';

import { format, subDays, startOfMonth } from 'date-fns';
import { dashboardAPI } from '../services/dashboardAPI';
import AutocompleteInput from '../components/dashboard/AutocompleteInput';
import InventoryCommandCenter from '../components/dashboard/InventoryCommandCenter';
import ActionCards from '../components/dashboard/ActionCards';
import DraftPOManager, { type DraftPOItem } from '../components/dashboard/DraftPOManager';
import SalesTrendChart from '../components/dashboard/SalesTrendChart';

const DashboardPage: React.FC = () => {
    const navigate = useNavigate();
    const { setHeaderActions } = useOutletContext<{ setHeaderActions: (actions: React.ReactNode) => void }>();

    // State for filters
    const [dateRange, setDateRange] = useState<{ start: string; end: string }>(() => {
        const now = new Date();
        const start = subDays(now, 7); // Last 7 days by default
        return {
            start: format(start, 'yyyy-MM-dd'),
            end: format(now, 'yyyy-MM-dd'),
        };
    });
    const [selectedPreset, setSelectedPreset] = useState<string>('week');
    const [showCustomDatePicker, setShowCustomDatePicker] = useState(false);
    const [customStartDate, setCustomStartDate] = useState('');
    const [customEndDate, setCustomEndDate] = useState('');

    // Advanced filter state
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
    const [customerFilter, setCustomerFilter] = useState('');
    const [vehicleFilter, setVehicleFilter] = useState('');

    // Draft PO state
    const [draftPOItems, setDraftPOItems] = useState<Map<string, DraftPOItem>>(new Map());
    const [partNumberFilter, setPartNumberFilter] = useState('');

    // Fetch KPIs
    const { data: kpis, refetch: refetchKPIs } = useQuery({
        queryKey: ['dashboardKPIs', dateRange, customerFilter, vehicleFilter, partNumberFilter],
        queryFn: () =>
            dashboardAPI.getKPIs(
                dateRange.start,
                dateRange.end,
                customerFilter || undefined,
                vehicleFilter || undefined,
                partNumberFilter || undefined
            ),
        staleTime: 30000,
    });

    // Auto-refresh every 30 seconds
    useEffect(() => {
        const interval = setInterval(() => {
            refetchKPIs();
        }, 30000); // 30 seconds

        return () => clearInterval(interval);
    }, [refetchKPIs]);

    // Fetch daily sales volume
    const { data: dailySales, isLoading: salesLoading } = useQuery({
        queryKey: ['dailySalesVolume', dateRange, customerFilter, vehicleFilter, partNumberFilter],
        queryFn: () =>
            dashboardAPI.getDailySalesVolume(
                dateRange.start,
                dateRange.end,
                customerFilter || undefined,
                vehicleFilter || undefined,
                partNumberFilter || undefined
            ),
        staleTime: 30000,
    });



    // Fetch stock summary for out of stock count
    const { data: stockSummary } = useQuery({
        queryKey: ['stockSummary'],
        queryFn: () => dashboardAPI.getStockSummary(),
        staleTime: 30000,
    });

    const { sales } = useGlobalStatus();

    // Fetch unmapped items count - use stock levels API to match Stock Register page
    const { data: stockLevels } = useQuery({
        queryKey: ['stockLevels'],
        queryFn: async () => {
            return await dashboardAPI.getStockLevels();
        },
        staleTime: 30000,
    });

    // Handle date range presets
    const setDatePreset = (preset: 'week' | 'month' | 'quarter' | 'all' | 'custom') => {
        const now = new Date();
        let start: Date;

        if (preset === 'custom') {
            setShowCustomDatePicker(true);
            return;
        }

        switch (preset) {
            case 'week':
                start = subDays(now, 7);
                break;
            case 'month':
                start = startOfMonth(now);
                break;
            case 'quarter':
                start = subDays(now, 90);
                break;
            case 'all':
                // Set a very old start date to get all data
                start = new Date('2000-01-01');
                break;
        }

        setDateRange({
            start: format(start, 'yyyy-MM-dd'),
            end: format(now, 'yyyy-MM-dd'),
        });
        setSelectedPreset(preset);
    };

    // Apply custom date range
    const applyCustomDateRange = () => {
        if (customStartDate && customEndDate) {
            setDateRange({
                start: customStartDate,
                end: customEndDate,
            });
            setSelectedPreset('custom');
            setShowCustomDatePicker(false);
        }
    };

    // Check if any filters are active
    const hasActiveFilters = customerFilter || vehicleFilter || partNumberFilter;

    // Clear all advanced filters
    const clearAllFilters = () => {
        setCustomerFilter('');
        setVehicleFilter('');
        setPartNumberFilter('');
    };

    // Get date range label for sales card
    const getDateRangeLabel = () => {
        switch (selectedPreset) {
            case 'week':
                return 'This Week';
            case 'month':
                return 'This Month';
            case 'quarter':
                return 'Last 90 Days';
            case 'all':
                return 'All Time';
            case 'custom':
                return `${format(new Date(dateRange.start), 'dd MMM')} - ${format(new Date(dateRange.end), 'dd MMM')}`;
            default:
                return 'This Period';
        }
    };

    // Set header actions when filters change
    useEffect(() => {
        setHeaderActions(
            <div className="flex items-center justify-end w-full gap-2">
                {/* Upload Buttons */}
                <button
                    onClick={() => navigate('/sales/upload')}
                    className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition shadow-sm"
                >
                    <ShoppingCart size={16} />
                    <span className="font-medium">Upload Sales</span>
                </button>

                <button
                    onClick={() => navigate('/inventory/upload')}
                    className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition shadow-sm"
                >
                    <Package size={16} />
                    <span className="font-medium">Upload Inventory</span>
                </button>

                {/* Divider */}
                <div className="h-8 w-px bg-gray-300 mx-2"></div>


                {/* Advanced Filters Toggle */}
                <button
                    onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                    className="flex items-center gap-2 bg-white border border-gray-200 text-gray-700 px-3 py-1 rounded-lg hover:bg-gray-50 transition"
                >
                    <span className="text-xs font-medium">Advanced Filters</span>
                    <ChevronDown
                        size={14}
                        className={`transition-transform ${showAdvancedFilters ? 'rotate-180' : ''}`}
                    />
                    {hasActiveFilters && (
                        <span className="ml-1 bg-indigo-600 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
                            {[customerFilter, vehicleFilter, partNumberFilter].filter(Boolean).length}
                        </span>
                    )}
                </button>
            </div >
        );

        return () => setHeaderActions(null);
    }, [selectedPreset, showAdvancedFilters, hasActiveFilters, customerFilter, vehicleFilter, partNumberFilter, setHeaderActions]);

    // Draft PO handlers
    const handleAddToDraft = (item: any) => {
        const draftItem: DraftPOItem = {
            part_number: item.part_number,
            item_name: item.item_name,
            current_stock: item.current_stock,
            reorder_point: item.reorder_point,
            reorder_qty: Math.max(1, item.reorder_point - item.current_stock),
            unit_value: item.unit_value,
            addedAt: Date.now(), // Track when item was added for sorting
        };
        setDraftPOItems(prev => new Map(prev).set(item.part_number, draftItem));
    };

    const handleRemoveFromDraft = (partNumber: string) => {
        setDraftPOItems(prev => {
            const newMap = new Map(prev);
            newMap.delete(partNumber);
            return newMap;
        });
    };

    const handleUpdateDraftQty = (partNumber: string, qty: number) => {
        setDraftPOItems(prev => {
            const newMap = new Map(prev);
            const item = newMap.get(partNumber);
            if (item) {
                newMap.set(partNumber, { ...item, reorder_qty: qty });
            }
            return newMap;
        });
    };

    // Navigation handlers for Action Cards
    const handleNavigateToReviewSales = () => {
        navigate('/sales/review');
    };

    const handleNavigateToUnmappedItems = () => {
        // Navigate to stock page with "To Do" filter pre-selected
        navigate('/inventory/stock?filter=todo');
    };

    const handleNavigateToOutOfStock = () => {
        // Navigate to stock page with Out of Stock filter
        // Use lowercase with underscore as per the status dropdown options
        navigate('/inventory/stock?status=out_of_stock');
    };









    return (
        <div className="space-y-4 pb-8">
            {/* Advanced Filters Panel (Only shown when toggled) */}
            {showAdvancedFilters && (
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <AutocompleteInput
                            value={customerFilter}
                            onChange={setCustomerFilter}
                            placeholder="Search customer..."
                            label="Customer Name"
                            getSuggestions={dashboardAPI.getCustomerSuggestions}
                        />
                        <AutocompleteInput
                            value={vehicleFilter}
                            onChange={setVehicleFilter}
                            placeholder="Search vehicle..."
                            label="Vehicle Number"
                            getSuggestions={dashboardAPI.getVehicleSuggestions}
                        />
                        <AutocompleteInput
                            value={partNumberFilter}
                            onChange={setPartNumberFilter}
                            placeholder="Search customer item..."
                            label="Customer Item"
                            getSuggestions={dashboardAPI.getPartSuggestions}
                        />
                    </div>

                    {/* Clear Filters Button */}
                    {hasActiveFilters && (
                        <div className="mt-4 flex justify-end">
                            <button
                                onClick={clearAllFilters}
                                className="text-sm text-gray-600 hover:text-gray-800 font-medium"
                            >
                                Clear All Filters
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Active Filter Badges */}
            {hasActiveFilters && (
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-gray-600">Active Filters:</span>
                    {customerFilter && (
                        <span className="inline-flex items-center gap-1 bg-indigo-100 text-indigo-800 text-sm px-3 py-1 rounded-full">
                            Customer: {customerFilter}
                            <button
                                onClick={() => setCustomerFilter('')}
                                className="hover:bg-indigo-200 rounded-full p-0.5"
                            >
                                <X size={14} />
                            </button>
                        </span>
                    )}
                    {vehicleFilter && (
                        <span className="inline-flex items-center gap-1 bg-indigo-100 text-indigo-800 text-sm px-3 py-1 rounded-full">
                            Vehicle: {vehicleFilter}
                            <button
                                onClick={() => setVehicleFilter('')}
                                className="hover:bg-indigo-200 rounded-full p-0.5"
                            >
                                <X size={14} />
                            </button>
                        </span>
                    )}
                    {partNumberFilter && (
                        <span className="inline-flex items-center gap-1 bg-indigo-100 text-indigo-800 text-sm px-3 py-1 rounded-full">
                            Customer Item: {partNumberFilter}
                            <button
                                onClick={() => setPartNumberFilter('')}
                                className="hover:bg-indigo-200 rounded-full p-0.5"
                            >
                                <X size={14} />
                            </button>
                        </span>
                    )}
                </div>
            )}

            {/* Custom Date Range Modal */}
            {showCustomDatePicker && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-gray-900">Select Custom Date Range</h3>
                            <button
                                onClick={() => setShowCustomDatePicker(false)}
                                className="text-gray-400 hover:text-gray-600"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Start Date
                                </label>
                                <input
                                    type="date"
                                    value={customStartDate}
                                    onChange={(e) => setCustomStartDate(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    End Date
                                </label>
                                <input
                                    type="date"
                                    value={customEndDate}
                                    onChange={(e) => setCustomEndDate(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>

                            <div className="flex gap-3 pt-2">
                                <button
                                    onClick={() => setShowCustomDatePicker(false)}
                                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={applyCustomDateRange}
                                    disabled={!customStartDate || !customEndDate}
                                    className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:bg-gray-300 disabled:cursor-not-allowed"
                                >
                                    Apply
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* TOP ROW: Action Cards - Phase 1 Workflow Cards */}
            <ActionCards
                pendingBillsCount={(sales.reviewCount + sales.syncCount) || 0}
                unmappedItemsCount={stockLevels?.items?.filter((item: any) => !item.customer_items).length || 0}
                outOfStockCount={stockSummary?.out_of_stock_count || 0}
                totalSales={kpis ? (kpis as any).total_revenue?.current_value || 0 : 0}
                salesChange={(kpis as any)?.total_revenue?.change_percent || 0}
                dateRangeLabel={getDateRangeLabel()}
                onNavigateToReviewSales={handleNavigateToReviewSales}
                onNavigateToUnmappedItems={handleNavigateToUnmappedItems}
                onNavigateToOutOfStock={handleNavigateToOutOfStock}
            />

            {/* MIDDLE ROW: Inventory Command Center */}
            <InventoryCommandCenter
                draftPOItems={draftPOItems}
                onAddToDraft={handleAddToDraft}
            />

            {/* BOTTOM ROW: Charts - Twin Towers with Equal Height */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Draft PO Manager - Now on Left (50%) */}
                <DraftPOManager
                    draftItems={draftPOItems}
                    onRemoveItem={handleRemoveFromDraft}
                    onUpdateQty={handleUpdateDraftQty}
                    onDraftUpdated={() => {
                        // Refresh dashboard data when draft is updated
                        refetchKPIs();
                    }}
                />

                {/* Sales Trend Chart - Now on Right (50%) - Fixed Height */}
                <div className="lg:col-span-6 bg-white rounded-lg h-[500px]">
                    <SalesTrendChart
                        data={dailySales || []}
                        isLoading={salesLoading}
                        dateRangeLabel={getDateRangeLabel()}
                        startDate={dateRange.start}
                        endDate={dateRange.end}
                        filterControls={
                            <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-lg p-1">
                                <button
                                    onClick={() => setDatePreset('week')}
                                    className={`px-3 py-1 rounded-md text-xs font-medium transition ${selectedPreset === 'week'
                                        ? 'bg-white text-indigo-600 shadow-sm border border-gray-200'
                                        : 'text-gray-600 hover:bg-gray-200'
                                        }`}
                                >
                                    This Week
                                </button>
                                <button
                                    onClick={() => setDatePreset('all')}
                                    className={`px-3 py-1 rounded-md text-xs font-medium transition ${selectedPreset === 'all'
                                        ? 'bg-white text-indigo-600 shadow-sm border border-gray-200'
                                        : 'text-gray-600 hover:bg-gray-200'
                                        }`}
                                >
                                    ALL
                                </button>
                                <button
                                    onClick={() => setDatePreset('custom')}
                                    className={`px-3 py-1 rounded-md text-xs font-medium transition flex items-center gap-1 ${selectedPreset === 'custom'
                                        ? 'bg-white text-indigo-600 shadow-sm border border-gray-200'
                                        : 'text-gray-600 hover:bg-gray-200'
                                        }`}
                                >
                                    <Calendar size={12} />
                                    Custom
                                </button>
                            </div>
                        }
                    />
                </div>
            </div>
        </div>
    );
};

export default DashboardPage;
