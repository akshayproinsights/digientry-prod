import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { Search, TrendingUp, TrendingDown, AlertTriangle, RefreshCw, ExternalLink, X, Package, ChevronDown, FileDown, Upload, Check, Trash2, CheckSquare, Square, XCircle } from 'lucide-react';
import { purchaseOrderAPI } from '../services/purchaseOrderAPI';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import {
    getStockLevels,
    getStockSummary,
    updateStockLevel,
    updateStockAdjustment,
    calculateStockLevels,
    getStockHistory,
    updateStockTransaction,
    deleteStockTransaction,
    deleteStockItem,
    deleteBulkStockItems,
    type StockLevel,
    type StockSummary,
    type StockTransaction,
} from '../services/stockApi';
import { mappingSheetAPI } from '../services/api';
import apiClient from '../lib/api';

interface VendorItem {
    id: number;
    description: string;
    part_number: string;
    qty?: number;
    rate?: number;
    match_score?: number;
}


// SmartEditableCell State Types
type CellState = 'default' | 'editing' | 'success' | 'error';

interface SmartEditableCellProps {
    value: number;
    itemId: number;
    field: 'old_stock' | 'reorder_point' | 'physical_count';
    onSave: (id: number, field: string, value: number) => Promise<void>;
    onEditStart?: () => void;
    onEditEnd?: () => void;
    min?: number;
    step?: number;
}

// SmartEditableCell Component - Traffic Light Editing System
const SmartEditableCell: React.FC<SmartEditableCellProps> = ({
    value,
    itemId,
    field,
    onSave,
    onEditStart = () => { },
    onEditEnd = () => { },
    min = 0,
    step = 1
}) => {
    const [localValue, setLocalValue] = useState(value);
    const [cellState, setCellState] = useState<CellState>('default');
    const [showCheck, setShowCheck] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // Sync with prop value when it changes
    useEffect(() => {
        setLocalValue(value);
    }, [value]);

    const handleFocus = () => {
        onEditStart();
        setCellState('editing');
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;

        // Validate input
        if (newValue === '') {
            setLocalValue(0);
            setCellState('editing');
            return;
        }

        const numValue = parseFloat(newValue);
        if (isNaN(numValue) || numValue < (min || 0)) {
            setCellState('error');
        } else {
            setCellState('editing');
            setLocalValue(numValue);
        }
    };

    const handleBlur = async () => {
        // Don't save if there's an error state
        if (cellState === 'error') {
            return;
        }

        // Only save if value changed
        if (localValue !== value) {
            try {
                await onSave(itemId, field, localValue);

                // Success state
                setCellState('success');
                setShowCheck(true);

                // Flash green for 1.5 seconds
                setTimeout(() => {
                    setCellState('default');
                    setShowCheck(false);
                    onEditEnd();
                }, 1500);
            } catch (error) {
                // Error state
                setCellState('error');
                console.error('Save failed:', error);
            }
        } else {
            setCellState('default');
            onEditEnd();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            inputRef.current?.blur();
        } else if (e.key === 'Escape') {
            setLocalValue(value);
            setCellState('default');
            onEditEnd();
            inputRef.current?.blur();
        }
    };

    // Background color based on state
    const getBgColor = () => {
        switch (cellState) {
            case 'editing': return 'bg-yellow-50';
            case 'success': return 'bg-green-100';
            case 'error': return 'bg-red-50';
            default: return 'bg-white hover:bg-gray-50';
        }
    };

    // Border color based on state
    const getBorderColor = () => {
        switch (cellState) {
            case 'editing': return 'border-yellow-400 ring-2 ring-yellow-200';
            case 'success': return 'border-green-500';
            case 'error': return 'border-red-500 ring-2 ring-red-200';
            default: return 'border-gray-300';
        }
    };

    return (
        <div className="relative">
            <input
                ref={inputRef}
                type="number"
                value={localValue}
                onFocus={handleFocus}
                onChange={handleChange}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                disabled={cellState === 'success'}
                className={`w-full px-2 py-1 border rounded text-right text-sm transition-all duration-200 
                    ${getBgColor()} ${getBorderColor()}
                    focus:outline-none
                    disabled:cursor-wait
                `}
                min={min}
                step={step}
            />
            {showCheck && (
                <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
                    <Check size={14} className="text-green-600" />
                </div>
            )}
        </div>
    );
};

const CurrentStockPage: React.FC = () => {
    // Get context from Layout to set header actions
    const { setHeaderActions } = useOutletContext<{ setHeaderActions: (actions: React.ReactNode) => void }>();
    const [searchParams] = useSearchParams();

    const [stockItems, setStockItems] = useState<StockLevel[]>([]);
    const [summary, setSummary] = useState<StockSummary>({
        total_stock_value: 0,
        low_stock_items: 0,
        out_of_stock: 0,
        total_items: 0,
    });
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState(() => {
        // Read from URL parameter if available
        return searchParams.get('status') || 'all';
    });
    const [priorityFilter, setPriorityFilter] = useState(() => {
        // Read from URL parameter if available
        return searchParams.get('priority') || 'all';
    });
    const [setupModeFilter, setSetupModeFilter] = useState(() => {
        // Read from URL parameter - if filter=todo, enable setup mode (To Do)
        return searchParams.get('filter') === 'todo';
    });
    const [showMappedItems, setShowMappedItems] = useState(() => {
        // Show "Mapped" view only if URL has filter=mapped
        return searchParams.get('filter') === 'mapped';
    });

    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [selectedPartHistory, setSelectedPartHistory] = useState<{ partNumber: string; itemName: string } | null>(null);
    const [isCalculating, setIsCalculating] = useState(false);

    // Edit mode state
    const [pendingSetupCount, setPendingSetupCount] = useState(0);

    // Mapping sheet upload state
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    // Mapping-related state
    const [openDropdowns, setOpenDropdowns] = useState<{ [key: number]: boolean }>({});
    const [searchQueries, setSearchQueries] = useState<{ [key: number]: string }>({});
    const [suggestions, setSuggestions] = useState<{ [key: number]: VendorItem[] }>({});
    const [searchResults, setSearchResults] = useState<{ [key: number]: VendorItem[] }>({});
    const [loadingSuggestions, setLoadingSuggestions] = useState<{ [key: number]: boolean }>({});
    const [flashGreen, setFlashGreen] = useState<{ [key: number]: boolean }>({});
    const [localCustomerItems, setLocalCustomerItems] = useState<{ [key: number]: string }>({});
    const [isMappingInProgress, setIsMappingInProgress] = useState(false); // Lock to prevent re-sort during mapping;

    // Track if this is the first load after mounting (gets reset when user navigates away/back)
    const isFirstLoad = useRef(true);

    // Selection and delete state
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [isSelectAllChecked, setIsSelectAllChecked] = useState(false);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [itemToDelete, setItemToDelete] = useState<StockLevel | null>(null);
    const [addingToPO, setAddingToPO] = useState<Set<string>>(new Set());


    const searchTimeoutRef = useRef<{ [key: number]: number }>({});
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

    // Reset isFirstLoad when component mounts (user navigates to this page)
    useEffect(() => {
        isFirstLoad.current = true;
    }, []); // Empty deps = runs on mount only

    // Set header actions (Upload, Export, and Bulk Delete buttons)
    useEffect(() => {
        setHeaderActions(
            <div className="flex gap-2">
                {/* Bulk Delete Button - shown when items selected */}
                {selectedIds.size > 0 && (
                    <button
                        onClick={handleBulkDelete}
                        className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                    >
                        <Trash2 size={16} />
                        Delete Selected ({selectedIds.size})
                    </button>
                )}

                {/* Upload Mapping Sheet Button */}
                <label
                    htmlFor="mapping-sheet-upload"
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer transition ${isUploading
                        ? 'bg-blue-400 cursor-not-allowed'
                        : 'bg-blue-600 hover:bg-blue-700'
                        } text-white`}
                >
                    <Upload size={16} className={isUploading ? 'animate-spin' : ''} />
                    {isUploading ? `Uploading... ${uploadProgress}%` : 'Upload Mapping Sheet'}
                </label>
                <input
                    id="mapping-sheet-upload"
                    type="file"
                    accept=".pdf,image/*"
                    onChange={handleUploadMappingSheet}
                    disabled={isUploading}
                    className="hidden"
                />

                <button
                    onClick={handleExportPDF}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                >
                    <FileDown size={16} />
                    Download Mapping Sheet
                </button>
            </div>
        );

        return () => setHeaderActions(null);
    }, [isUploading, uploadProgress, selectedIds, setHeaderActions]);

    // Load data
    const loadData = useCallback(async () => {
        try {
            setLoading(true);
            const [itemsData, summaryData] = await Promise.all([
                getStockLevels({ search: searchQuery, status_filter: statusFilter, priority_filter: priorityFilter }),
                getStockSummary(),
            ]);

            // Set default reorder_point to 2 if not set (for all incoming data)
            itemsData.items.forEach(item => {
                if (item.reorder_point === 0 || item.reorder_point === null) {
                    item.reorder_point = 2;
                }
            });

            setStockItems(prevItems => {
                // DECISION LOGIC:
                // 1. If user is actively mapping an item (isMappingInProgress): PRESERVE ORDER (so they don't lose track)
                // 2. If "All" filter is active (!setupModeFilter && !showMappedItems): APPLY "Mapped First" sorting
                // 3. If filtered view (Mapped/To Do): PRESERVE ORDER (filter handles display)
                // 4. First load: APPLY "Mapped First" sorting

                const isAllFilterActive = !setupModeFilter && !showMappedItems;
                const isFirstLoadOrEmpty = isFirstLoad.current || prevItems.length === 0;

                // Helper function to sort mapped items first, then alphabetically within each group
                const sortMappedFirst = (items: StockLevel[]) => {
                    return [...items].sort((a, b) => {
                        const aHasCustomer = !!a.customer_items;
                        const bHasCustomer = !!b.customer_items;

                        // Mapped items come first
                        if (aHasCustomer && !bHasCustomer) return -1;
                        if (!aHasCustomer && bHasCustomer) return 1;

                        // Within each group, sort alphabetically by customer_items or internal_item_name
                        const aName = a.customer_items || a.internal_item_name || '';
                        const bName = b.customer_items || b.internal_item_name || '';
                        return aName.localeCompare(bName);
                    });
                };

                // If user is mapping an item, preserve order to avoid losing track
                if (isMappingInProgress) {

                    // Update existing items with new data, keep order
                    const newItemMap = new Map(itemsData.items.map(item => [item.id, item]));
                    const preservedList = prevItems
                        .map(prev => newItemMap.get(prev.id))
                        .filter((item): item is StockLevel => item !== undefined);

                    const prevIds = new Set(prevItems.map(i => i.id));
                    const newItems = itemsData.items.filter(item => !prevIds.has(item.id));

                    return [...preservedList, ...newItems];
                }

                // If "All" filter is active, always apply "Mapped First" sorting
                if (isAllFilterActive || isFirstLoadOrEmpty) {
                    isFirstLoad.current = false;
                    return sortMappedFirst(itemsData.items);
                }

                // For filtered views (Mapped/To Do), preserve order
                const newItemMap = new Map(itemsData.items.map(item => [item.id, item]));
                const preservedList = prevItems
                    .map(prev => newItemMap.get(prev.id))
                    .filter((item): item is StockLevel => item !== undefined);

                const prevIds = new Set(prevItems.map(i => i.id));
                const newItems = itemsData.items.filter(item => !prevIds.has(item.id));

                return [...preservedList, ...newItems];
            });
            setSummary(summaryData);

            // Calculate counts for progress widget
            const pendingCount = itemsData.items.filter(item => !item.customer_items).length;
            setPendingSetupCount(pendingCount);

            // Initialize local customer items state
            const localItems: { [key: number]: string } = {};
            itemsData.items.forEach(item => {
                if (item.customer_items) {
                    localItems[item.id] = item.customer_items;
                }
            });
            setLocalCustomerItems(localItems);
        } catch (error) {
            console.error('Error loading stock data:', error);
        } finally {
            setLoading(false);
        }
    }, [searchQuery, statusFilter, priorityFilter, setupModeFilter, showMappedItems, isMappingInProgress]); // Include filters for sorting logic

    useEffect(() => {
        loadData();
    }, [loadData]);

    // Auto-recalculate stock when page loads
    // Note: We don't call loadData() here because the regular useEffect will handle it
    // This prevents the sorted data from being overwritten with unsorted data
    useEffect(() => {
        const autoRecalculate = async () => {
            try {
                await calculateStockLevels();
                // Don't call loadData() - let the regular effect handle it
                // This ensures the sorting happens on the final data load
            } catch (error) {
                console.error('Auto-recalculation failed:', error);
            }
        };

        autoRecalculate();
    }, []); // Run only once on mount

    // Trigger stock calculation
    const handleCalculateStock = async () => {
        try {
            setIsCalculating(true);
            await calculateStockLevels();
            await loadData();
        } catch (error) {
            console.error('Error calculating stock:', error);
            alert('Failed to calculate stock levels');
        } finally {
            setIsCalculating(false);
        }
    };

    // === Traffic Light Edit Pattern with SmartEditableCell ===
    const [savingFields, setSavingFields] = useState<{ [key: string]: boolean }>({});

    // Smart Cell Save Handler
    const handleSmartCellSave = async (id: number, field: string, value: number) => {
        // Update local state immediately
        setStockItems(prev => prev.map(item =>
            item.id === id ? { ...item, [field]: value } : item
        ));

        try {
            const updates = { [field]: value };
            // @ts-ignore
            await updateStockLevel(id, updates);
        } catch (error) {
            console.error('Error updating stock level:', error);
            throw error; // Let SmartEditableCell handle error state
        }
    };

    // Update Physical Stock Handler (for SmartEditableCell)
    const handleUpdatePhysicalStock = async (id: number, _field: string, value: number) => {
        const item = stockItems.find(i => i.id === id);
        if (!item) return;

        // Calculate expected adjustment relative to system stock (excluding manual adjustment)
        // Current Formula: On Hand = current_stock + manual_adjustment
        // New Manual Adjustment = UserPhysicalCount - current_stock
        const systemStock = (item.current_stock || 0);
        const newAdjustment = value - systemStock;

        // Optimistic Update: Update manual_adjustment locally so the total matches what user typed
        setStockItems(prev => prev.map(i =>
            i.id === id ? { ...i, manual_adjustment: newAdjustment } : i
        ));

        try {
            await updateStockAdjustment(item.part_number, value);
        } catch (error) {
            console.error('Error updating physical stock:', error);
            // Revert validation is up to the cell (it turns red)
            // But we should probably revert the state?
            // SmartEditableCell expects us to throw if failed.
            throw error;
        }
    };

    // Handle Priority Field Update (non-numeric field)
    const handleFieldUpdate = async (id: number, field: 'priority', value: string) => {
        const fieldKey = `${id}-${field}`;

        // Update local state immediately
        setStockItems(prev => prev.map(item =>
            item.id === id ? { ...item, [field]: value } : item
        ));

        // Lock the cell
        setSavingFields(prev => ({ ...prev, [fieldKey]: true }));

        try {
            const updates = { [field]: value };
            // @ts-ignore
            await updateStockLevel(id, updates);
        } catch (error) {
            console.error('Error updating stock level:', error);
            alert('Failed to save priority');
            // Revert on error
            await loadData();
        } finally {
            // Unlock the cell
            setSavingFields(prev => ({ ...prev, [fieldKey]: false }));
        }
    };

    // Load unique customer items for dropdown
    const loadSuggestions = async (itemId: number) => {
        if (suggestions[itemId] || loadingSuggestions[itemId]) return;

        setLoadingSuggestions(prev => ({ ...prev, [itemId]: true }));
        try {
            // Fetch unique customer items from verified invoices
            const response = await apiClient.get('/api/verified/unique-customer-items');
            const data = response.data;

            // Convert to VendorItem format for compatibility
            const customerItems = (data.customer_items || []).map((item: string, index: number) => ({
                id: index,
                description: item,
                part_number: '',
                match_score: 100
            }));

            setSuggestions(prev => ({
                ...prev,
                [itemId]: customerItems
            }));
        } catch (err) {
            console.error('Error loading customer items:', err);
        } finally {
            setLoadingSuggestions(prev => ({ ...prev, [itemId]: false }));
        }
    };

    // Handle search change with debounce - search customer items
    const handleSearchChange = (itemId: number, query: string) => {
        setSearchQueries(prev => ({ ...prev, [itemId]: query }));

        // Clear existing timeout
        if (searchTimeoutRef.current[itemId]) {
            clearTimeout(searchTimeoutRef.current[itemId]);
        }

        // Debounce search (150ms for faster response)
        searchTimeoutRef.current[itemId] = setTimeout(async () => {
            if (query.trim().length > 0) {
                try {
                    const response = await apiClient.get(`/api/verified/unique-customer-items?search=${encodeURIComponent(query)}`);
                    const data = response.data;

                    // Convert to VendorItem format
                    const customerItems = (data.customer_items || []).map((item: string, index: number) => ({
                        id: index,
                        description: item,
                        part_number: '',
                        match_score: 100
                    }));

                    setSearchResults(prev => ({ ...prev, [itemId]: customerItems }));
                } catch (err) {
                    console.error('Error searching customer items:', err);
                }
            } else {
                setSearchResults(prev => ({ ...prev, [itemId]: [] }));
            }
        }, 150);
    };

    // Handle selecting a vendor item
    const handleSelectVendorItem = async (item: StockLevel, vendorItem: VendorItem) => {
        try {
            // Lock sorting to prevent row jump
            setIsMappingInProgress(true);

            // Create vendor mapping entry using bulk-save endpoint
            const response = await apiClient.post('/api/vendor-mapping/entries/bulk-save', {
                entries: [{
                    row_number: 1,
                    vendor_description: item.internal_item_name,
                    part_number: item.part_number,
                    customer_item_name: vendorItem.description,
                    status: 'Added'
                }]
            });

            if (response.status === 200) {
                // Close dropdown and clear search FIRST
                setOpenDropdowns(prev => ({ ...prev, [item.id]: false }));
                setSearchQueries(prev => ({ ...prev, [item.id]: '' }));
                setSearchResults(prev => ({ ...prev, [item.id]: [] }));

                // Then update local state
                setLocalCustomerItems(prev => ({
                    ...prev,
                    [item.id]: vendorItem.description
                }));

                // Flash green for 3 seconds
                setFlashGreen(prev => ({ ...prev, [item.id]: true }));
                setTimeout(() => {
                    setFlashGreen(prev => ({ ...prev, [item.id]: false }));
                }, 3000);

                // Reload data after a short delay to reflect changes
                setTimeout(() => {
                    loadData();
                    // Release the lock AFTER data loads
                    setIsMappingInProgress(false);
                }, 500);
            } else {
                setIsMappingInProgress(false);
                throw new Error('Failed to create mapping');
            }
        } catch (error) {
            setIsMappingInProgress(false);
            console.error('Error creating vendor mapping:', error);
            alert('Failed to link customer item');
        }
    };

    // Handle clearing a customer item mapping
    const handleClearCustomerItem = async (item: StockLevel) => {
        if (!confirm('Clear this customer item mapping?')) {
            return;
        }

        try {
            // Delete from backend database FIRST
            await apiClient.delete(`/api/vendor-mapping/entries/by-part/${encodeURIComponent(item.part_number)}`);

            // Clear from local state immediately
            setLocalCustomerItems(prev => {
                const updated = { ...prev };
                delete updated[item.id];
                return updated;
            });

            // DON'T reload - keep item in place so user can immediately add new mapping
            // setTimeout(() => loadData(), 300);
        } catch (error) {
            console.error('Error clearing customer item:', error);
            alert('Failed to clear customer item');
        }
    };

    // Handle blur event on customer item input - auto-save typed text
    const handleCustomerItemBlur = async (item: StockLevel) => {
        const typedValue = localCustomerItems[item.id] || '';
        const originalValue = item.customer_items || '';

        // Close dropdown when blurring
        setTimeout(() => {
            setOpenDropdowns(prev => ({ ...prev, [item.id]: false }));
        }, 200); // Small delay to allow dropdown click to register

        // Only save if value has changed and not empty
        if (typedValue && typedValue !== originalValue) {
            try {
                // Save to vendor_mapping_entries
                await apiClient.post('/api/vendor-mapping/entries/bulk-save', {
                    entries: [{
                        row_number: 1,
                        vendor_description: item.internal_item_name,
                        part_number: item.part_number,
                        customer_item_name: typedValue,
                        status: 'Added'
                    }]
                });

                // Flash green to indicate save
                setFlashGreen(prev => ({ ...prev, [item.id]: true }));
                setTimeout(() => {
                    setFlashGreen(prev => ({ ...prev, [item.id]: false }));
                }, 2000);

            } catch (error) {
                console.error('Error auto-saving customer item:', error);
                // Silently fail - don't bother user with error messages
            }
        }
    };


    // Get dropdown options (suggestions or search results)
    const getDropdownOptions = (itemId: number): VendorItem[] => {
        const query = searchQueries[itemId] || '';
        if (query.trim().length > 0) {
            return searchResults[itemId] || [];
        }
        return suggestions[itemId]?.slice(0, 50) || [];
    };

    // Upload mapping sheet handler
    const handleUploadMappingSheet = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        // Validate file type
        if (!file.type.includes('pdf') && !file.type.includes('image')) {
            alert('Please upload a PDF or image file');
            return;
        }

        setIsUploading(true);
        setUploadProgress(0);
        setErrorMessage(null); // Clear previous errors

        try {
            // Simulate progress
            const progressInterval = setInterval(() => {
                setUploadProgress((prev) => Math.min(prev + 10, 90));
            }, 200);

            const response = await mappingSheetAPI.upload(file);

            clearInterval(progressInterval);
            setUploadProgress(100);

            // Show success message
            alert(
                `✅ ${response.message}\n\n` +
                `Extracted ${response.extracted_rows} rows\n` +
                `Status: ${response.status}\n\n` +
                `Refreshing stock data...`
            );

            // Wait for backend recalculation to complete before refreshing
            // The backend triggers stock recalculation which may take a moment
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Force a complete refresh of stock data
            await loadData();

            // Also refresh the summary to show updated counts
            const summaryData = await getStockSummary();
            setSummary(summaryData);

        } catch (error: any) {
            console.error('Upload error:', error);
            const msg = `Failed to upload mapping sheet: ${error.response?.data?.detail || error.message}`;
            setErrorMessage(msg);
        } finally {
            setIsUploading(false);
            setUploadProgress(0);
            // Reset file input
            event.target.value = '';
        }
    };

    // Handle Export PDF (Inventory Count Sheet)
    const handleExportPDF = async () => {
        try {
            const response = await apiClient.get('/api/stock/export-inventory-count-sheet', {
                params: {
                    search: searchQuery || undefined,
                    status_filter: statusFilter !== 'all' ? statusFilter : undefined,
                },
                responseType: 'blob'
            });

            const blob = new Blob([response.data], { type: 'application/pdf' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `inventory_count_sheet_${new Date().toISOString().split('T')[0]}.pdf`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error exporting PDF:', error);
            alert('Failed to export PDF');
        }
    };

    // Handle delete mapping
    const handleDeleteMapping = async (item: StockLevel) => {
        if (!confirm(`Delete mapping for "${item.part_number}"?\n\nThis will:\n- Remove the customer item mapping\n- Return this item to unmapped state\n- Trigger stock recalculation`)) {
            return;
        }

        try {
            await apiClient.delete(`/api/stock/mapping/${item.part_number}`);
            await loadData(); // Refresh entire table
        } catch (error) {
            console.error('Error deleting mapping:', error);
            alert('Failed to delete mapping. Please try again.');
        }
    };

    // Handle checkbox selection
    const handleSelectRow = (rowId: number) => {
        const newSelected = new Set(selectedIds);
        if (newSelected.has(rowId)) {
            newSelected.delete(rowId);
        } else {
            newSelected.add(rowId);
        }
        setSelectedIds(newSelected);
        setIsSelectAllChecked(newSelected.size === stockItems.length && stockItems.length > 0);
    };

    // Handle select all checkbox
    const handleSelectAll = () => {
        if (isSelectAllChecked) {
            setSelectedIds(new Set());
            setIsSelectAllChecked(false);
        } else {
            const allIds = new Set(stockItems.map((item: StockLevel) => item.id));
            setSelectedIds(allIds);
            setIsSelectAllChecked(true);
        }
    };

    // Handle delete button click
    const handleDeleteStock = (item: StockLevel) => {
        setItemToDelete(item);
        setDeleteConfirmOpen(true);
    };

    // Bulk delete handler
    const handleBulkDelete = () => {
        setItemToDelete(null); // null means bulk delete
        setDeleteConfirmOpen(true);
    };

    // Confirm delete
    const confirmDelete = async () => {
        try {
            if (itemToDelete) {
                // Single delete
                await deleteStockItem(itemToDelete.part_number);

                // Clear selection if item was selected
                if (selectedIds.has(itemToDelete.id)) {
                    const newSelected = new Set(selectedIds);
                    newSelected.delete(itemToDelete.id);
                    setSelectedIds(newSelected);
                }
            } else {
                // Bulk delete
                const selectedItems = stockItems.filter(item => selectedIds.has(item.id));
                const partNumbers = selectedItems.map(item => item.part_number);
                await deleteBulkStockItems(partNumbers);
                setSelectedIds(new Set());
                setIsSelectAllChecked(false);
            }

            // Close modal and reload data
            setDeleteConfirmOpen(false);
            setItemToDelete(null);
            await loadData();
        } catch (error) {
            console.error('Error deleting stock item:', error);
            alert('Failed to delete item. Please try again.');
        }
    };

    // Handle add to draft PO
    const handleAddToDraftPO = async (item: StockLevel) => {
        const partNumber = item.part_number;
        setAddingToPO(prev => new Set(prev).add(partNumber));

        try {
            await purchaseOrderAPI.quickAddToDraft(partNumber);

            // Show success feedback
            const message = `Added "${item.internal_item_name}" to Draft PO`;
            // You can replace this with a toast notification if available
            const notification = document.createElement('div');
            notification.className = 'fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg z-50';
            notification.textContent = message;
            document.body.appendChild(notification);

            setTimeout(() => {
                document.body.removeChild(notification);
            }, 3000);

        } catch (error: any) {
            console.error('Error adding to draft PO:', error);
            alert(error.response?.data?.detail || 'Failed to add item to draft PO');
        } finally {
            setAddingToPO(prev => {
                const newSet = new Set(prev);
                newSet.delete(partNumber);
                return newSet;
            });
        }
    };

    // Status badge
    const getStatusBadge = (status: string) => {
        const colors = {
            'In Stock': 'bg-green-100 text-green-800',
            'Low Stock': 'bg-orange-100 text-orange-800',
            'Out of Stock': 'bg-red-100 text-red-800',
        };

        return (
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-800'}`}>
                {status}
            </span>
        );
    };

    return (
        <div className="space-y-6">
            {/* Error Message Banner */}
            {errorMessage && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-md shadow-sm">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center">
                            <XCircle className="text-red-500 mr-3" size={20} />
                            <div>
                                <p className="text-red-700 font-medium">Upload Failed</p>
                                <p className="text-red-600 text-sm">{errorMessage}</p>
                            </div>
                        </div>
                        <button
                            onClick={() => setErrorMessage(null)}
                            className="text-red-400 hover:text-red-600 transition"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>
            )}

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-600">Total Stock Value</p>
                            <p className="text-3xl font-bold text-gray-900 mt-2">
                                ₹{Math.round(summary.total_stock_value).toLocaleString('en-IN')}
                            </p>
                        </div>
                        <div className="p-3 bg-blue-100 rounded-lg">
                            <TrendingUp className="text-blue-600" size={24} />
                        </div>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-600">Total Stock Items</p>
                            <p className="text-3xl font-bold text-blue-900 mt-2">
                                {stockItems.length}
                            </p>
                        </div>
                        <div className="p-3 bg-green-100 rounded-lg">
                            <Package className="text-green-600" size={24} />
                        </div>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-600">Low Stock Items</p>
                            <p className="text-3xl font-bold text-orange-600 mt-2">
                                {summary.low_stock_items}
                            </p>
                        </div>
                        <div className="p-3 bg-orange-100 rounded-lg">
                            <TrendingDown className="text-orange-600" size={24} />
                        </div>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                    <div className="flex items-center justify-between">
                        <div className="flex-1">
                            <p className="text-sm text-gray-600">Items to Map</p>
                            <p className="text-3xl font-bold text-orange-600 mt-2">
                                {pendingSetupCount}
                            </p>
                            <button
                                onClick={() => {
                                    setShowMappedItems(false);
                                    setSetupModeFilter(true);
                                }}
                                className="mt-3 px-4 py-1.5 bg-orange-500 text-white text-sm font-semibold rounded-md hover:bg-orange-600 transition-colors"
                            >
                                Action Needed
                            </button>
                        </div>
                        <div className="p-3 bg-orange-100 rounded-lg">
                            <AlertTriangle className="text-orange-600" size={24} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
                <div className="flex flex-col md:flex-row gap-4">
                    {/* Search */}
                    <div className="flex-1 relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                        <input
                            type="text"
                            placeholder="Search Item Name/Part #"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                    </div>

                    {/* Mapping Progress Widget - Three Segment Control */}
                    <div className="flex items-center gap-0 rounded-full overflow-hidden border-2 border-gray-200 shadow-sm">
                        {/* All Items */}
                        <button
                            onClick={() => {
                                setShowMappedItems(false);
                                setSetupModeFilter(false);
                            }}
                            className={`px-4 py-2 text-sm font-semibold transition-all flex items-center gap-2 whitespace-nowrap ${!showMappedItems && !setupModeFilter
                                ? 'bg-blue-600 text-white shadow-md'
                                : 'bg-white text-gray-700 hover:bg-gray-50'
                                }`}
                        >
                            <span>🔵</span>
                            <span>All</span>
                        </button>

                        {/* Mapped Items (Green) */}
                        <button
                            onClick={() => {
                                setShowMappedItems(true);
                                setSetupModeFilter(false);
                            }}
                            className={`px-4 py-2 text-sm font-semibold transition-all flex items-center gap-2 whitespace-nowrap ${showMappedItems && !setupModeFilter
                                ? 'bg-green-500 text-white shadow-md'
                                : 'bg-white text-green-700 hover:bg-green-50'
                                }`}
                        >
                            <span>✅</span>
                            <span>{stockItems.filter(item => item.customer_items).length} Mapped</span>
                        </button>

                        {/* To Do Items (Orange) */}
                        <button
                            onClick={() => {
                                setShowMappedItems(false);
                                setSetupModeFilter(true);
                            }}
                            className={`px-4 py-2 text-sm font-semibold transition-all flex items-center gap-2 whitespace-nowrap ${setupModeFilter
                                ? 'bg-amber-500 text-white shadow-md'
                                : 'bg-white text-amber-700 hover:bg-amber-50'
                                }`}
                        >
                            <span>⚠️</span>
                            <span>{pendingSetupCount} To Do</span>
                        </button>
                    </div>

                    {/* Priority Filter Buttons */}
                    <div className="flex gap-2">
                        {['all', 'P0', 'P1', 'P2', 'P3'].map((priority) => (
                            <button
                                key={priority}
                                onClick={() => setPriorityFilter(priority)}
                                className={`px-3 py-2 rounded-lg text-sm font-medium transition ${priorityFilter === priority
                                    ? 'bg-blue-600 text-white shadow-md'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                            >
                                {priority === 'all' ? 'All' : priority}
                            </button>
                        ))}
                    </div>

                    {/* Status Filter */}
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                        <option value="all">Filter by Status (All)</option>
                        <option value="in_stock">In Stock</option>
                        <option value="low_stock">Low Stock</option>
                        <option value="out_of_stock">Out of Stock</option>
                    </select>



                </div>
            </div>

            {/* Stock Table */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden" ref={dropdownRef}>
                {loading ? (
                    <div className="p-8 text-center text-gray-500">Loading stock levels...</div>
                ) : stockItems.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">
                        No stock items found. Upload vendor invoices to populate stock levels.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full table-auto">
                            <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                    {/* Checkbox Column - 1% */}
                                    <th className="px-2 py-2 text-left w-[1%] whitespace-nowrap">
                                        <button
                                            onClick={handleSelectAll}
                                            className="text-gray-600 hover:text-gray-900 transition cursor-pointer p-1"
                                            title={isSelectAllChecked ? "Deselect all" : "Select all"}
                                        >
                                            {isSelectAllChecked ? <CheckSquare size={16} /> : <Square size={16} />}
                                        </button>
                                    </th>
                                    {/* Col 1: Item Details - Fluid (w-auto) */}
                                    <th className="px-2 py-2 text-left text-[11px] font-bold text-gray-500 uppercase w-auto">
                                        Item Details
                                    </th>
                                    {/* Col 2: Customer Item - 1% */}
                                    <th className="px-2 py-2 text-left text-[11px] font-bold text-gray-500 uppercase w-[1%]">
                                        Customer Item
                                    </th>
                                    {/* Col 3: Priority - 1% */}
                                    <th className="px-2 py-2 text-center text-[11px] font-bold text-gray-500 uppercase w-[1%] whitespace-nowrap">
                                        PRI
                                    </th>
                                    {/* Col 4: Min Stock - 1% */}
                                    <th className="px-2 py-2 text-center text-[11px] font-bold text-gray-500 uppercase w-[1%] whitespace-nowrap bg-gray-50">
                                        Min Stock
                                    </th>
                                    {/* Col 5: Status - 1% */}
                                    <th className="px-2 py-2 text-center text-[11px] font-bold text-gray-500 uppercase w-[1%] whitespace-nowrap">
                                        Status
                                    </th>

                                    {/* Col 7: In - 1% */}
                                    <th className="px-2 py-2 text-right text-[11px] font-bold text-gray-500 uppercase w-[1%] whitespace-nowrap">
                                        In
                                    </th>
                                    {/* Col 8: Out - 1% */}
                                    <th className="px-2 py-2 text-right text-[11px] font-bold text-gray-500 uppercase w-[1%] whitespace-nowrap">
                                        Out
                                    </th>
                                    {/* Col 9: On Hand - 1% */}
                                    <th className="px-2 py-2 text-right text-[11px] font-bold text-gray-500 uppercase w-[1%] whitespace-nowrap">
                                        On Hand
                                    </th>
                                    {/* Col 10: Value - Fixed Width Increased (w-28) */}
                                    <th className="px-2 py-2 text-right text-[11px] font-bold text-gray-500 uppercase w-28 whitespace-nowrap">
                                        Value
                                    </th>
                                    {/* History - 1% */}
                                    <th className="px-2 py-2 text-center text-[11px] font-bold text-gray-500 uppercase w-[1%] whitespace-nowrap">
                                        History
                                    </th>
                                    {/* Delete - 1% */}
                                    <th className="px-2 py-2 text-center text-[11px] font-bold text-gray-500 uppercase w-[1%] whitespace-nowrap">
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {stockItems
                                    .filter(item => {
                                        // Apply Mapped/To Do filter
                                        if (setupModeFilter) {
                                            // "To Do" mode: Show only unmapped items
                                            return !item.customer_items;
                                        } else if (showMappedItems && !setupModeFilter) {
                                            // "Mapped" mode: Show only mapped items
                                            return !!item.customer_items;
                                        }
                                        return true; // Show all items (shouldn't reach here with current UI)
                                    })
                                    .map((item) => {
                                        const hasCustomerItem = !!localCustomerItems[item.id];
                                        const isFlashing = flashGreen[item.id];

                                        return (
                                            <tr
                                                key={item.id}
                                                className="bg-white border-b border-gray-100 hover:bg-gray-50 transition-colors"
                                            >
                                                {/* Checkbox Column - 1% */}
                                                <td className="px-2 py-2 w-[1%] whitespace-nowrap text-center">
                                                    <button
                                                        onClick={() => handleSelectRow(item.id)}
                                                        className="text-gray-600 hover:text-gray-900 transition cursor-pointer p-1"
                                                    >
                                                        {selectedIds.has(item.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                                                    </button>
                                                </td>

                                                {/* Col 1: Item Details - Fluid (w-auto) + Truncate */}
                                                <td className="px-2 py-2 w-auto max-w-[200px] sm:max-w-xs md:max-w-md lg:max-w-xl">
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-sm text-gray-900 font-medium leading-tight" title={item.internal_item_name}>
                                                            {item.internal_item_name}
                                                        </span>
                                                        <span className="inline-flex items-center">
                                                            <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] font-mono">
                                                                {item.part_number}
                                                            </span>
                                                        </span>
                                                    </div>
                                                </td>

                                                {/* Col 2: Customer Item - 1% + Input EXPANDED Width (w-60) */}
                                                <td className="px-2 py-2 w-[1%] text-sm">
                                                    <div className="flex items-center gap-2">
                                                        <div className="relative w-60">
                                                            <textarea
                                                                value={localCustomerItems[item.id] || ''}
                                                                onFocus={() => {
                                                                    // Don't open dropdown or load suggestions on focus
                                                                    // Only show dropdown when user starts typing
                                                                }}
                                                                onChange={(e) => {
                                                                    const value = e.target.value;
                                                                    setLocalCustomerItems(prev => ({
                                                                        ...prev,
                                                                        [item.id]: value
                                                                    }));
                                                                    // Open dropdown when user types
                                                                    if (value.trim().length > 0) {
                                                                        setOpenDropdowns(prev => ({ ...prev, [item.id]: true }));
                                                                    } else {
                                                                        setOpenDropdowns(prev => ({ ...prev, [item.id]: false }));
                                                                    }
                                                                    handleSearchChange(item.id, value);
                                                                }}
                                                                onBlur={() => handleCustomerItemBlur(item)}
                                                                placeholder={hasCustomerItem ? "" : "Select..."}
                                                                rows={hasCustomerItem ? 2 : 1}
                                                                className={`w-full px-2 py-1.5 border rounded text-sm font-medium transition-colors block resize-none overflow-hidden focus:overflow-auto ${isFlashing
                                                                    ? 'bg-green-200 ring-2 ring-green-400 border-green-500'
                                                                    : hasCustomerItem
                                                                        ? 'border-green-500 bg-green-50 text-green-700 pr-5'
                                                                        : 'border-amber-400 border-dashed bg-white text-gray-600 pr-2'
                                                                    }`}
                                                                style={{ minHeight: '38px' }}
                                                            />

                                                            {/* Clear button (X) for mapped items */}
                                                            {hasCustomerItem && (
                                                                <button
                                                                    onClick={() => handleClearCustomerItem(item)}
                                                                    className="absolute right-1 top-1/2 transform -translate-y-1/2 text-red-500 hover:text-red-700 transition-colors z-10"
                                                                    type="button"
                                                                    title="Clear customer item mapping"
                                                                >
                                                                    <X size={10} className="stroke-[2.5]" />
                                                                </button>
                                                            )}
                                                            {/* Dropdown toggle - only show for unmapped items */}
                                                            {!hasCustomerItem && (
                                                                <button
                                                                    onClick={() => {
                                                                        // Toggle dropdown - not needed anymore since we type to search
                                                                        // This button is now hidden for mapped items
                                                                    }}
                                                                    className="hidden"
                                                                    type="button"
                                                                >
                                                                    <ChevronDown size={12} className={`transition-transform ${openDropdowns[item.id] ? 'rotate-180' : ''}`} />
                                                                </button>
                                                            )}

                                                            {/* Dropdown */}
                                                            {openDropdowns[item.id] && (
                                                                <div className="absolute z-50 mt-1 w-96 bg-white border border-gray-200 rounded-lg shadow-xl max-h-60 overflow-y-auto left-0">
                                                                    {loadingSuggestions[item.id] ? (
                                                                        <div className="p-4 text-center text-gray-500 text-sm">
                                                                            Loading suggestions...
                                                                        </div>
                                                                    ) : getDropdownOptions(item.id).length === 0 ? (
                                                                        <div className="p-4 text-center text-gray-500 text-sm">
                                                                            No matches found. Type to search...
                                                                        </div>
                                                                    ) : (
                                                                        getDropdownOptions(item.id).map((vendorItem) => (
                                                                            <button
                                                                                key={vendorItem.id}
                                                                                onMouseDown={(e) => {
                                                                                    e.preventDefault(); // Prevent blur event from firing
                                                                                    handleSelectVendorItem(item, vendorItem);
                                                                                }}
                                                                                className="w-full px-4 py-3 text-left hover:bg-blue-50 border-b last:border-b-0 transition"
                                                                            >
                                                                                <div className="flex justify-between items-start">
                                                                                    <div className="flex-1">
                                                                                        <p className="font-medium text-gray-900 text-sm">{vendorItem.description}</p>
                                                                                        {vendorItem.part_number && (
                                                                                            <p className="text-xs text-gray-500 mt-1">Part: {vendorItem.part_number}</p>
                                                                                        )}
                                                                                    </div>
                                                                                </div>
                                                                            </button>
                                                                        ))
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* Col 3: Priority - 1% Center - Reduced Width */}
                                                <td className="px-2 py-2 w-[1%] whitespace-nowrap text-sm text-center">
                                                    <select
                                                        value={item.priority || ''}
                                                        onChange={(e) => handleFieldUpdate(item.id, 'priority', e.target.value)}
                                                        disabled={savingFields[`${item.id}-priority`]}
                                                        className="w-16 px-1 py-1 border border-gray-300 rounded text-[11px] text-center focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-wait"
                                                    >
                                                        <option value="">-</option>
                                                        <option value="P0">P0</option>
                                                        <option value="P1">P1</option>
                                                        <option value="P2">P2</option>
                                                        <option value="P3">P3</option>
                                                    </select>
                                                </td>

                                                {/* Col 4: Min Stock - 1% Center Gray */}
                                                <td className="px-2 py-2 w-[1%] whitespace-nowrap text-sm text-center bg-gray-50">
                                                    <div className="w-12 mx-auto">
                                                        <SmartEditableCell
                                                            value={item.reorder_point || 0}
                                                            itemId={item.id}
                                                            field="reorder_point"
                                                            onSave={handleSmartCellSave}
                                                            min={0}
                                                            step={1}
                                                        />
                                                    </div>
                                                </td>

                                                {/* Col 5: Status - 1% Center */}
                                                <td className="px-2 py-2 w-[1%] whitespace-nowrap text-sm text-center">
                                                    <div className="flex justify-center">
                                                        {(() => {
                                                            const status = item.status || 'In Stock';
                                                            const colors = {
                                                                'In Stock': 'bg-green-100 text-green-800',
                                                                'Low Stock': 'bg-orange-100 text-orange-800',
                                                                'Out of Stock': 'bg-red-100 text-red-800',
                                                            };
                                                            return (
                                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-800'}`}>
                                                                    {status}
                                                                </span>
                                                            );
                                                        })()}
                                                    </div>
                                                </td>



                                                {/* Col 7: In - 1% Right */}
                                                <td className="px-2 py-2 w-[1%] whitespace-nowrap text-sm text-right">
                                                    <span className="text-green-700 font-medium text-[11px]">
                                                        {Math.round(item.total_in)} ↑
                                                    </span>
                                                </td>

                                                {/* Col 8: Out - 1% Right */}
                                                <td className="px-2 py-2 w-[1%] whitespace-nowrap text-sm text-right">
                                                    <span className="text-amber-700 font-semibold text-[11px]">
                                                        {Math.round(item.total_out)} ↓
                                                    </span>
                                                </td>

                                                {/* Col 9: On Hand - 1% Right - Result - Editable */}
                                                <td className="px-2 py-2 w-[1%] whitespace-nowrap text-right">
                                                    <div className="w-20 ml-auto font-black text-lg">
                                                        <SmartEditableCell
                                                            value={Math.round((item.current_stock || 0) + (item.manual_adjustment || 0))}
                                                            itemId={item.id}
                                                            field="physical_count"
                                                            onSave={handleUpdatePhysicalStock}
                                                            min={0}
                                                            step={1}
                                                        />
                                                    </div>
                                                    {item.manual_adjustment !== 0 && (
                                                        <span className="absolute top-1 right-1 text-[8px] bg-amber-100 text-amber-800 px-1 rounded-full pointer-events-none">
                                                            Adj
                                                        </span>
                                                    )}
                                                </td>

                                                {/* Col 10: Value - Fixed Width Increased (w-28) */}
                                                <td className="px-2 py-2 w-28 whitespace-nowrap text-sm text-right">
                                                    <div className="flex flex-col items-end">
                                                        <span className="text-[11px] text-gray-700 font-medium tabular-nums">
                                                            ₹{item.total_value.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                                        </span>
                                                        {item.latest_vendor_rate && Math.round((item.current_stock || 0) + (item.old_stock || 0)) > 0 ? (
                                                            <span className="text-[10px] text-gray-400 block tabular-nums">
                                                                (@ ₹{Math.round(item.latest_vendor_rate).toLocaleString('en-IN')})
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                </td>

                                                {/* Col 12: History - 1% Center */}
                                                <td className="px-2 py-1 w-[1%] whitespace-nowrap text-sm text-center">
                                                    <button
                                                        className="text-blue-600 hover:text-blue-800 hover:underline text-[10px] font-bold uppercase"
                                                        onClick={() => {
                                                            setSelectedPartHistory({
                                                                partNumber: item.part_number,
                                                                itemName: item.internal_item_name
                                                            });
                                                            setShowHistoryModal(true);
                                                        }}
                                                        title="View transaction history"
                                                    >
                                                        History
                                                    </button>
                                                </td>

                                                {/* Col 13: Delete - 1% Center */}
                                                <td className="px-2 py-1 w-[1%] whitespace-nowrap text-sm text-center">
                                                    <button
                                                        onClick={() => handleDeleteStock(item)}
                                                        className="text-red-600 hover:text-red-800 disabled:opacity-50"
                                                        title="Delete this stock item"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>



            {/* Transaction History Modal */}
            {showHistoryModal && selectedPartHistory && (
                <TransactionHistoryModal
                    partNumber={selectedPartHistory.partNumber}
                    itemName={selectedPartHistory.itemName}
                    onClose={() => {
                        setShowHistoryModal(false);
                        setSelectedPartHistory(null);
                    }}
                    onStockUpdated={async () => {
                        // Refresh stock data after transaction edit/delete
                        await loadData();
                    }}
                />
            )}

            {/* Delete Confirmation Modal */}
            <DeleteConfirmModal
                isOpen={deleteConfirmOpen}
                onClose={() => setDeleteConfirmOpen(false)}
                onConfirm={confirmDelete}
                title="Delete Stock Item"
                message="This item will be permanently removed from your stock register."
                isDeleting={false}
            />

            {/* Floating Recalculate Button - Bottom Right */}
            <button
                onClick={handleCalculateStock}
                disabled={isCalculating}
                className="fixed bottom-6 right-6 flex items-center gap-3 px-6 py-4 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-2xl shadow-2xl hover:shadow-blue-500/50 hover:scale-105 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed group z-40"
                title="Recalculate all stock levels from verified invoices"
            >
                <RefreshCw
                    size={24}
                    className={`${isCalculating ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`}
                />
                <div className="flex flex-col items-start">
                    <span className="font-semibold text-sm">
                        {isCalculating ? 'Recalculating...' : 'Recalculate Stock'}
                    </span>
                    <span className="text-xs text-blue-100">
                        {isCalculating ? 'Please wait' : 'Click to refresh'}
                    </span>
                </div>
            </button>
        </div>
    );
};



// Transaction History Modal Component
interface TransactionHistoryModalProps {
    partNumber: string;
    itemName: string;
    onClose: () => void;
    onStockUpdated: () => void;  // Callback to refresh stock levels after edit/delete
}

const TransactionHistoryModal: React.FC<TransactionHistoryModalProps> = ({ partNumber, itemName, onClose, onStockUpdated }) => {
    const [transactions, setTransactions] = useState<StockTransaction[]>([]);
    const [summary, setSummary] = useState({ total_in: 0, total_out: 0, transaction_count: 0, old_stock: null as number | null });
    const [loading, setLoading] = useState(true);
    const [savingCells, setSavingCells] = useState<Set<string>>(new Set());
    const [deletingId, setDeletingId] = useState<string | null>(null);

    useEffect(() => {
        const loadHistory = async () => {
            try {
                setLoading(true);
                const data = await getStockHistory(partNumber);
                setTransactions(data.transactions);
                setSummary({
                    total_in: data.summary.total_in,
                    total_out: data.summary.total_out,
                    transaction_count: data.summary.transaction_count,
                    old_stock: data.summary.old_stock ?? null
                });
            } catch (error) {
                console.error('Error loading transaction history:', error);
                alert('Failed to load transaction history');
            } finally {
                setLoading(false);
            }
        };

        loadHistory();
    }, [partNumber]);

    // Reload data and notify parent
    const reloadHistory = async () => {
        try {
            const data = await getStockHistory(partNumber);
            setTransactions(data.transactions);
            setSummary({
                total_in: data.summary.total_in,
                total_out: data.summary.total_out,
                transaction_count: data.summary.transaction_count,
                old_stock: data.summary.old_stock ?? null
            });
            onStockUpdated();  // Notify parent to refresh stock levels
        } catch (error) {
            console.error('Error reloading history:', error);
        }
    };

    // Handle cell edit (QTY, RATE, AMOUNT)
    const handleCellEdit = async (txn: StockTransaction, field: 'quantity' | 'rate' | 'amount', newValue: number) => {
        if (!txn.id) return;

        const cellId = `${txn.id}-${field}`;
        setSavingCells(prev => new Set(prev).add(cellId));

        try {
            // Validate
            if (newValue < 0) {
                alert('Value must be >= 0');
                return;
            }

            // Update via API
            await updateStockTransaction({
                transactionId: txn.id,
                type: txn.type,
                quantity: field === 'quantity' ? newValue : txn.quantity,
                rate: field === 'rate' ? newValue : (txn.rate ?? undefined)
            });

            // Reload data
            await reloadHistory();
        } catch (error: any) {
            console.error('Error updating transaction:', error);
            alert(error.response?.data?.detail || 'Failed to update transaction');
        } finally {
            setSavingCells(prev => {
                const newSet = new Set(prev);
                newSet.delete(cellId);
                return newSet;
            });
        }
    };

    // Handle delete transaction
    const handleDelete = async (txn: StockTransaction) => {
        if (!txn.id) return;

        const confirmed = window.confirm(
            'Delete this transaction? This cannot be undone.\n\nStock levels will be recalculated automatically.'
        );

        if (!confirmed) return;

        setDeletingId(txn.id);

        try {
            await deleteStockTransaction({
                transactionId: txn.id,
                type: txn.type
            });

            // Reload data
            await reloadHistory();
        } catch (error: any) {
            console.error('Error deleting transaction:', error);
            alert(error.response?.data?.detail || 'Failed to delete transaction');
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-gray-200">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-900">Transaction History</h2>
                        <p className="text-gray-600 mt-1">
                            {itemName} <span className="text-gray-400">({partNumber})</span>
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <X size={24} className="text-gray-500" />
                    </button>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-3 gap-4 p-6 border-b border-gray-200 bg-gray-50">
                    <div className="text-center">
                        <p className="text-sm text-gray-600">Total IN</p>
                        <p className="text-2xl font-bold text-green-600">{summary.total_in.toFixed(2)}</p>
                    </div>
                    <div className="text-center">
                        <p className="text-sm text-gray-600">Total OUT</p>
                        <p className="text-2xl font-bold text-red-600">{summary.total_out.toFixed(2)}</p>
                    </div>
                    <div className="text-center">
                        <p className="text-sm text-gray-600">Transactions</p>
                        <p className="text-2xl font-bold text-gray-900">{summary.transaction_count}</p>
                    </div>
                </div>

                {/* Transactions Table */}
                <div className="flex-1 overflow-auto p-6">
                    {loading ? (
                        <div className="text-center py-12 text-gray-500">Loading transaction history...</div>
                    ) : transactions.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">No transactions found</div>
                    ) : (
                        <table className="w-full">
                            <thead className="bg-gray-50 border-y border-gray-200 sticky top-0">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">Type</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">Date</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">Invoice #</th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">Description</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-600 uppercase">Qty</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-600 uppercase">Rate</th>
                                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-600 uppercase">Amount</th>
                                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-600 uppercase">Receipt</th>
                                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-600 uppercase">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {transactions.map((txn, index) => {
                                    const isSaving = savingCells.has(`${txn.id}-quantity`) || savingCells.has(`${txn.id}-rate`);
                                    const isDeleting = deletingId === txn.id;

                                    return (
                                        <tr key={txn.id || index} className={`hover:bg-gray-50 ${isDeleting ? 'opacity-50' : ''}`}>
                                            <td className="px-4 py-3 text-sm">
                                                <span className={`px-2 py-1 rounded text-xs font-semibold ${txn.type === 'IN'
                                                    ? 'bg-green-100 text-green-800'
                                                    : 'bg-red-100 text-red-800'
                                                    }`}>
                                                    {txn.type}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-700">
                                                {txn.date || 'N/A'}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-700 font-mono">
                                                {txn.invoice_number || 'N/A'}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-900">
                                                {txn.description}
                                            </td>
                                            {/* Editable QTY Cell */}
                                            <td className="px-4 py-3 text-sm text-right">
                                                <input
                                                    type="number"
                                                    defaultValue={txn.quantity}
                                                    onBlur={(e) => {
                                                        const newVal = parseFloat(e.target.value);
                                                        if (newVal !== txn.quantity && !isNaN(newVal)) {
                                                            handleCellEdit(txn, 'quantity', newVal);
                                                        }
                                                    }}
                                                    disabled={isSaving || isDeleting}
                                                    className={`w-20 px-2 py-1 border rounded text-right font-semibold transition-colors ${savingCells.has(`${txn.id}-quantity`) ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
                                                        } focus:bg-yellow-50 focus:border-yellow-500 hover:border-gray-400`}
                                                    step="0.01"
                                                    min="0"
                                                />
                                            </td>
                                            {/* Editable RATE Cell */}
                                            <td className="px-4 py-3 text-sm text-right">
                                                <input
                                                    type="number"
                                                    defaultValue={txn.rate ?? ''}
                                                    placeholder="N/A"
                                                    onBlur={(e) => {
                                                        const newVal = parseFloat(e.target.value);
                                                        if (newVal !== txn.rate && !isNaN(newVal)) {
                                                            handleCellEdit(txn, 'rate', newVal);
                                                        }
                                                    }}
                                                    disabled={isSaving || isDeleting}
                                                    className={`w-24 px-2 py-1 border rounded text-right transition-colors ${savingCells.has(`${txn.id}-rate`) ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
                                                        } focus:bg-yellow-50 focus:border-yellow-500 hover:border-gray-400`}
                                                    step="0.01"
                                                    min="0"
                                                />
                                            </td>
                                            {/* Calculated AMOUNT Cell (read-only) */}
                                            <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900">
                                                ₹{txn.amount.toFixed(2)}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-center">
                                                {txn.receipt_link ? (
                                                    <a
                                                        href={txn.receipt_link}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline"
                                                    >
                                                        View
                                                        <ExternalLink size={14} />
                                                    </a>
                                                ) : (
                                                    <span className="text-gray-400">N/A</span>
                                                )}
                                            </td>
                                            {/* Delete Button */}
                                            <td className="px-4 py-3 text-sm text-center">
                                                <button
                                                    onClick={() => handleDelete(txn)}
                                                    disabled={isSaving || isDeleting}
                                                    className="text-red-600 hover:text-red-800 disabled:opacity-50 disabled:cursor-not-allowed"
                                                    title="Delete transaction"
                                                >
                                                    {isDeleting ? (
                                                        <RefreshCw size={16} className="animate-spin" />
                                                    ) : (
                                                        <Trash2 size={16} />
                                                    )}
                                                </button>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-200 bg-gray-50">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
    ;

export default CurrentStockPage;
