import React, { useState, useEffect, useCallback } from 'react';
import { Trash2, ShoppingCart, FileText, Loader2, AlertCircle, Check } from 'lucide-react';
import { purchaseOrderAPI, type DraftPOItem as APIDraftPOItem, type ProceedToPORequest } from '../../services/purchaseOrderAPI';
import MaterialRequestPDF from './MaterialRequestPDF';
import AutocompleteInput from './AutocompleteInput';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';


interface SmartQtyInputProps {
    value: number;
    partNumber: string;
    onSave: (partNumber: string, qty: number) => Promise<void>;
    min?: number;
    disabled?: boolean;
}

// SmartQtyInput Component - Traffic Light Editing System
const SmartQtyInput: React.FC<SmartQtyInputProps> = ({
    value,
    partNumber,
    onSave,
    min = 1,
    disabled = false
}) => {
    const [localValue, setLocalValue] = useState(value);
    const [cellState, setCellState] = useState<'default' | 'editing' | 'success' | 'error'>('default');
    const [showCheck, setShowCheck] = useState(false);
    const inputRef = React.useRef<HTMLInputElement>(null);

    // Sync with prop value when it changes
    useEffect(() => {
        setLocalValue(value);
    }, [value]);

    const handleFocus = () => {
        setCellState('editing');
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;

        // Validate input
        if (newValue === '') {
            setLocalValue(0); // Temporary, will be validated on blur
            setCellState('editing');
            return;
        }

        const numValue = parseInt(newValue);
        if (isNaN(numValue) || numValue < min) {
            setCellState('error');
            setLocalValue(parseInt(newValue) || 0); // Keep typing but show error
        } else {
            setCellState('editing');
            setLocalValue(numValue);
        }
    };

    const handleBlur = async () => {
        // Don't save if there's an error state
        if (cellState === 'error') {
            setLocalValue(value); // Revert
            setCellState('default');
            return;
        }

        // Only save if value changed
        if (localValue !== value) {
            try {
                // Ensure value is valid before saving
                const finalValue = Math.max(min, localValue);
                if (finalValue !== localValue) {
                    setLocalValue(finalValue);
                }

                await onSave(partNumber, finalValue);

                // Success state
                setCellState('success');
                setShowCheck(true);

                // Flash green for 1.5 seconds
                setTimeout(() => {
                    setCellState('default');
                    setShowCheck(false);
                }, 1500);
            } catch (error) {
                // Error state
                setCellState('error');
                console.error('Save failed:', error);
                // Optionally revert or stay in error
            }
        } else {
            setCellState('default');
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            inputRef.current?.blur();
        } else if (e.key === 'Escape') {
            setLocalValue(value);
            setCellState('default');
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
        <div className="relative w-20 mx-auto">
            <input
                ref={inputRef}
                type="number"
                value={localValue}
                onFocus={handleFocus}
                onChange={handleChange}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                disabled={disabled || cellState === 'success'}
                className={`w-full h-8 px-2 py-1 text-sm text-center font-medium border rounded transition-all duration-200 
                    ${getBgColor()} ${getBorderColor()}
                    focus:outline-none
                    disabled:cursor-wait
                `}
                min={min}
            />
            {showCheck && (
                <div className="absolute -right-4 top-1/2 transform -translate-y-1/2">
                    <Check size={14} className="text-green-600" />
                </div>
            )}
        </div>
    );
};

export interface DraftPOItem {
    part_number: string;
    item_name: string;
    current_stock: number;
    reorder_point: number;
    reorder_qty: number;
    unit_value?: number;
    addedAt: number; // Timestamp for sorting by most recently added
}

interface DraftPOManagerProps {
    draftItems: Map<string, DraftPOItem>;
    onRemoveItem: (partNumber: string) => void;
    onUpdateQty: (partNumber: string, qty: number) => void;
    onDraftUpdated?: () => void; // Callback to refresh parent component
}

const DraftPOManager: React.FC<DraftPOManagerProps> = ({
    draftItems,
    onRemoveItem,
    onUpdateQty,
    onDraftUpdated
}) => {
    const [apiDraftItems, setApiDraftItems] = useState<APIDraftPOItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showProceedModal, setShowProceedModal] = useState(false);
    const [createdPOData, setCreatedPOData] = useState<{
        poNumber: string;
        vendorName: string;
        items: APIDraftPOItem[];
        notes?: string;
    } | null>(null);

    // Load draft items from API on component mount
    const loadDraftItems = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await purchaseOrderAPI.getDraftItems();
            setApiDraftItems(response.items);
        } catch (err) {
            console.error('Error loading draft items:', err);
            setError('Failed to load draft items');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadDraftItems();
    }, [loadDraftItems]);

    // Sync with local state changes (add items from parent)
    useEffect(() => {
        const localItems = Array.from(draftItems.values());
        if (localItems.length > 0) {
            // Sync local items to API
            syncLocalToAPI();
        }
    }, [draftItems]);

    const syncLocalToAPI = async () => {
        try {
            const localItems = Array.from(draftItems.values());

            for (const item of localItems) {
                // Check if item already exists in API
                const existsInAPI = apiDraftItems.some(apiItem => apiItem.part_number === item.part_number);

                if (!existsInAPI) {
                    await purchaseOrderAPI.addDraftItem({
                        part_number: item.part_number,
                        item_name: item.item_name,
                        current_stock: item.current_stock,
                        reorder_point: item.reorder_point,
                        reorder_qty: item.reorder_qty,
                        unit_value: item.unit_value,
                        priority: "P2"
                    });
                }
            }

            // Refresh API items
            await loadDraftItems();
        } catch (err) {
            console.error('Error syncing local to API:', err);
        }
    };

    // Use API items if available, otherwise fall back to local state
    const displayItems = apiDraftItems.length > 0 ? apiDraftItems : Array.from(draftItems.values());
    const draftItemsArray = displayItems.sort((a, b) => {
        const aAny = a as any;
        const bAny = b as any;
        const aTime = aAny.added_at ? new Date(aAny.added_at).getTime() : aAny.addedAt || 0;
        const bTime = bAny.added_at ? new Date(bAny.added_at).getTime() : bAny.addedAt || 0;
        return bTime - aTime;
    });


    // Calculate totals
    const totalItems = draftItemsArray.length;
    const totalEstimatedCost = draftItemsArray.reduce((sum, item) => {
        const cost = (item.unit_value || 0) * item.reorder_qty;
        return sum + cost;
    }, 0);

    // Format currency
    const formatCurrency = (value: number): string => {
        return `₹${Math.round(value).toLocaleString('en-IN')}`;
    };

    // Handle remove item with API sync
    const handleRemoveItem = async (partNumber: string) => {
        try {
            // Remove from API first
            await purchaseOrderAPI.removeDraftItem(partNumber);

            // Then remove from local state
            onRemoveItem(partNumber);

            // Refresh API items
            await loadDraftItems();
            onDraftUpdated?.();
        } catch (err) {
            console.error('Error removing item:', err);
            setError('Failed to remove item');
        }
    };

    // Handle quantity update with API sync
    const handleUpdateQty = async (partNumber: string, qty: number) => {
        if (qty <= 0) return;

        try {
            // Update in API first
            await purchaseOrderAPI.updateDraftQuantity(partNumber, qty);

            // Then update local state
            onUpdateQty(partNumber, qty);

            // Refresh API items
            await loadDraftItems();
            onDraftUpdated?.();
        } catch (err) {
            console.error('Error updating quantity:', err);
            setError('Failed to update quantity');
        }
    };

    // Generate Timestamp PO Number: PO DDMMYYYY_HHMMSS
    const generatePONumber = () => {
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yyyy = now.getFullYear();
        const HH = String(now.getHours()).padStart(2, '0');
        const MM = String(now.getMinutes()).padStart(2, '0');
        const SS = String(now.getSeconds()).padStart(2, '0');
        return `PO ${dd}${mm}${yyyy}_${HH}${MM}${SS}`;
    };

    // Handle proceed to PO
    const handleProceedToPO = async (supplierName?: string, notes?: string) => {
        if (draftItemsArray.length === 0) {
            setError('No items in draft to process');
            return;
        }

        try {
            setProcessing(true);
            setError(null);

            const request: ProceedToPORequest = {
                supplier_name: supplierName,
                notes: notes
            };

            const response = await purchaseOrderAPI.proceedToPO(request);

            if (response.success) {
                // Generate the Custom PO Number on the frontend
                const customPONumber = generatePONumber();

                setCreatedPOData({
                    poNumber: customPONumber,
                    vendorName: supplierName || 'Unknown Vendor',
                    items: [...draftItemsArray],
                    notes: notes
                });

                // NOTE: User requested NOT to clear items after PO creation
                // draftItems.clear();
                // onDraftUpdated?.();
                // await loadDraftItems();

                setShowProceedModal(false);
            }

        } catch (err) {
            console.error('Error proceeding to PO:', err);
            setError('Failed to create purchase order');
        } finally {
            setProcessing(false);
        }
    };

    // --- PDF CHUNKING LOGIC ---
    const getPages = () => {
        if (!createdPOData) return [];
        const items = createdPOData.items.map(item => ({
            partNumber: item.part_number,
            description: item.item_name,
            quantity: item.reorder_qty
        }));
        const pages = [];
        const ITEMS_PER_PAGE_FIRST = 10;
        const ITEMS_PER_PAGE_OTHER = 14;

        const firstPageItems = items.slice(0, ITEMS_PER_PAGE_FIRST);
        pages.push(firstPageItems);

        let remainingItems = items.slice(ITEMS_PER_PAGE_FIRST);
        while (remainingItems.length > 0) {
            const chunk = remainingItems.slice(0, ITEMS_PER_PAGE_OTHER);
            pages.push(chunk);
            remainingItems = remainingItems.slice(ITEMS_PER_PAGE_OTHER);
        }
        return pages;
    };

    const pdfPages = getPages();

    const handleDownloadPDF = async () => {
        if (!createdPOData || pdfPages.length === 0) return;

        try {
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pdfWidth = pdf.internal.pageSize.getWidth();

            for (let i = 0; i < pdfPages.length; i++) {
                const elementId = `material-request-pdf-${i}`;
                const element = document.getElementById(elementId);

                if (!element) {
                    console.error(`Element ${elementId} not found`);
                    continue;
                }

                const canvas = await html2canvas(element, {
                    scale: 2,
                    useCORS: true,
                    logging: false,
                    backgroundColor: '#ffffff'
                });

                const imgData = canvas.toDataURL('image/jpeg', 0.8);
                const imgProps = pdf.getImageProperties(imgData);
                const imgHeight = (imgProps.height * pdfWidth) / imgProps.width;

                if (i > 0) pdf.addPage();

                pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, imgHeight);
            }

            const filename = `${createdPOData.poNumber.replace(/ /g, '_')}.pdf`;
            pdf.save(filename);

        } catch (err) {
            console.error('PDF Download Failed:', err);
            alert('Failed to download PDF. Please try again.');
        }
    };


    const handleClosePOView = () => {
        setCreatedPOData(null);
    };

    // Clear all items
    const handleClearAll = async () => {
        if (window.confirm('Are you sure you want to clear all items from the draft?')) {
            try {
                await purchaseOrderAPI.clearDraft();
                draftItems.clear();
                onDraftUpdated?.();
                await loadDraftItems();
            } catch (err) {
                console.error('Error clearing draft:', err);
                setError('Failed to clear draft');
            }
        }
    };

    if (createdPOData) {
        return (
            <div className="fixed inset-0 z-50 bg-white overflow-auto flex flex-col">
                <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                    <h2 className="font-semibold text-gray-800">Material Request Created</h2>
                    <div className="flex gap-4">
                        <button
                            onClick={handleClosePOView}
                            className="px-4 py-2 text-gray-600 hover:text-gray-800 border bg-white border-gray-300 rounded shadow-sm"
                        >
                            Close
                        </button>
                        <button
                            onClick={handleDownloadPDF}
                            className="px-6 py-2.5 bg-blue-600 text-white hover:bg-blue-700 font-medium rounded-lg shadow-sm flex items-center gap-2 transition-colors"
                        >
                            <FileText size={18} /> Download PDF
                        </button>
                    </div>
                </div>

                {/* Scrollable Preview Area */}
                <div className="flex-1 bg-gray-100 p-8 overflow-auto flex justify-center">
                    <div className="flex flex-col gap-8">
                        {pdfPages.map((chunk, index) => (
                            <MaterialRequestPDF
                                key={`preview-page-${index}`}
                                id={`preview-page-${index}`} // Unique ID for preview to avoid conflicts
                                poNumber={createdPOData.poNumber}
                                date={new Date()}
                                vendorName={createdPOData.vendorName}
                                senderName="Adnak"
                                senderPhone="9822197172"
                                notes={createdPOData.notes}
                                items={chunk}
                                pageIndex={index}
                                totalPages={pdfPages.length}
                                startItemNumber={index === 0 ? 1 : 10 + ((index - 1) * 14) + 1}
                            />
                        ))}
                    </div>
                </div>

                {/* HIDDEN GENERATION CONTAINER - Absolute positioned off-screen */}
                <div style={{ position: 'absolute', top: '-10000px', left: '-10000px' }}>
                    {pdfPages.map((chunk, index) => (
                        <MaterialRequestPDF
                            key={`pdf-page-${index}`}
                            id={`material-request-pdf-${index}`} // Critical: Must match handleDownloadPDF target
                            poNumber={createdPOData.poNumber}
                            date={new Date()}
                            vendorName={createdPOData.vendorName}
                            senderName="Adnak"
                            senderPhone="9822197172"
                            notes={createdPOData.notes}
                            items={chunk}
                            pageIndex={index}
                            totalPages={pdfPages.length}
                            startItemNumber={index === 0 ? 1 : 10 + ((index - 1) * 14) + 1}
                        />
                    ))}
                </div>
            </div >
        );
    }

    return (
        <div className="lg:col-span-6 bg-white rounded-lg shadow-sm border border-gray-200 h-[500px] flex flex-col overflow-hidden">
            {/* Professional Header with Actions */}
            <div className="flex-none p-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">Draft Purchase Order</h3>
                    {draftItemsArray.length > 0 && (
                        <button
                            onClick={handleClearAll}
                            className="text-xs text-gray-500 hover:text-red-600 transition-colors"
                            title="Clear all items"
                        >
                            Clear All
                        </button>
                    )}
                </div>
                {error && (
                    <div className="mt-2 flex items-center gap-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded">
                        <AlertCircle size={14} />
                        {error}
                    </div>
                )}
            </div>

            {loading ? (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-500">
                    <Loader2 size={24} className="animate-spin mb-2" />
                    <p>Loading draft items...</p>
                </div>
            ) :


                draftItemsArray.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-500 px-6">
                        <div className="bg-gray-100 rounded-full p-4 mb-4">
                            <ShoppingCart size={32} className="text-gray-400" />
                        </div>
                        <p className="text-center text-gray-600 font-medium">No items in draft</p>
                        <p className="text-center text-sm text-gray-500 mt-1">Add items from Quick Reorder List above</p>
                    </div>
                ) : (
                    <>
                        {/* Table Container - Flush Design (Edge-to-Edge) with Custom Scrollbar */}
                        <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar">
                            <table className="w-full table-fixed">
                                {/* Fixed Column Widths - No Horizontal Scroll */}
                                <colgroup>
                                    <col style={{ width: '42%' }} />
                                    <col style={{ width: '18%' }} />
                                    <col style={{ width: '14%' }} />
                                    <col style={{ width: '16%' }} />
                                    <col style={{ width: '10%' }} />
                                </colgroup>
                                {/* Sticky Header with Proper Alignment */}
                                <thead className="sticky top-0 z-10 bg-gray-50">
                                    <tr className="border-b border-gray-200">
                                        <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Item</th>
                                        <th className="px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Stock / Reorder</th>
                                        <th className="px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Qty</th>
                                        <th className="px-2 py-2 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">Cost</th>
                                        <th className="px-2 py-2 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white">
                                    {draftItemsArray.map((item) => {
                                        const estimatedCost = (item.unit_value || 0) * item.reorder_qty;

                                        return (
                                            <tr
                                                key={item.part_number}
                                                className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                                            >
                                                {/* Column 1: Item Details - 42% width */}
                                                <td className="px-3 py-2 max-w-0 min-w-0">
                                                    <div className="overflow-hidden">
                                                        <h4
                                                            className="font-semibold text-gray-900 text-sm leading-tight truncate cursor-help"
                                                            title={item.item_name}
                                                        >
                                                            {item.item_name}
                                                        </h4>
                                                        <p
                                                            className="text-xs text-gray-500 mt-1 font-mono truncate cursor-help"
                                                            title={item.part_number}
                                                        >
                                                            {item.part_number}
                                                        </p>
                                                    </div>
                                                </td>

                                                {/* Column 2: Stock - 18% width, centered */}
                                                <td className="px-2 py-2 text-center">
                                                    <div className="text-sm tabular-nums">
                                                        <span className={`font-bold ${item.current_stock < item.reorder_point ? 'text-red-600' : 'text-gray-900'
                                                            }`}>
                                                            {item.current_stock}
                                                        </span>
                                                        <span className="text-gray-400 mx-1">/</span>
                                                        <span className="text-xs text-gray-500">
                                                            {item.reorder_point}
                                                        </span>
                                                    </div>
                                                </td>

                                                {/* Column 3: Qty - 14% width, centered */}
                                                <td className="px-2 py-2 text-center">
                                                    <SmartQtyInput
                                                        value={item.reorder_qty}
                                                        partNumber={item.part_number}
                                                        onSave={handleUpdateQty}
                                                        min={1}
                                                        disabled={loading}
                                                    />
                                                </td>

                                                {/* Column 4: Cost - 16% width, right-aligned */}
                                                <td className="px-2 py-2 text-right">
                                                    <span className="text-sm font-bold text-gray-900 tabular-nums">
                                                        {item.unit_value !== null && item.unit_value !== undefined
                                                            ? formatCurrency(estimatedCost)
                                                            : <span className="text-gray-400">₹--</span>}
                                                    </span>
                                                </td>

                                                {/* Column 5: Action - 10% width, centered */}
                                                <td className="px-2 py-2 text-center">
                                                    <button
                                                        onClick={() => handleRemoveItem(item.part_number)}
                                                        className="p-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-all duration-200 disabled:opacity-50"
                                                        title="Remove from draft"
                                                        disabled={loading}
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

                        {/* Professional Checkout Footer - Anchored to bottom */}
                        <div className="flex-none mt-auto">
                            <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-gray-50 to-white border-t-2 border-gray-200 rounded-b-lg">
                                {/* Left: Total Price */}
                                <div className="flex items-baseline gap-3">
                                    <span className="text-2xl font-bold text-gray-900 tabular-nums">
                                        {formatCurrency(totalEstimatedCost)}
                                    </span>
                                    <span className="text-sm text-gray-500 font-medium">
                                        Total: {totalItems} {totalItems === 1 ? 'item' : 'items'}
                                    </span>
                                </div>
                                {/* Right: Proceed Button */}
                                <button
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-all duration-200 active:scale-95 disabled:bg-gray-400 disabled:cursor-not-allowed"
                                    onClick={() => setShowProceedModal(true)}
                                    disabled={processing || loading || draftItemsArray.length === 0}
                                >
                                    {processing ? (
                                        <>
                                            <Loader2 size={16} className="animate-spin" />
                                            <span>Processing...</span>
                                        </>
                                    ) : (
                                        <>
                                            <FileText size={16} />
                                            <span>Proceed</span>
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                            </svg>
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </>
                )
            }


            {/* Proceed Modal */}
            {showProceedModal && (
                <ProceedModal
                    totalItems={totalItems}
                    totalCost={totalEstimatedCost}
                    onConfirm={handleProceedToPO}
                    onCancel={() => setShowProceedModal(false)}
                    processing={processing}
                />
            )}
        </div>
    );
};

// Proceed Modal Component
interface ProceedModalProps {
    totalItems: number;
    totalCost: number;
    onConfirm: (supplierName?: string, notes?: string) => void;
    onCancel: () => void;
    processing: boolean;
}

const ProceedModal: React.FC<ProceedModalProps> = ({
    totalItems,
    totalCost,
    onConfirm,
    onCancel,
    processing
}) => {
    const [supplierName, setSupplierName] = useState('');
    const [notes, setNotes] = useState('');
    const [suppliers, setSuppliers] = useState<string[]>([]);

    // Fetch suppliers on mount
    useEffect(() => {
        const loadSuppliers = async () => {
            try {
                const response = await purchaseOrderAPI.getSuppliers();
                if (response.success) {
                    setSuppliers(response.suppliers);
                }
            } catch (err) {
                console.error('Error loading suppliers:', err);
            }
        };
        loadSuppliers();
    }, []);

    // Suggestion logic
    const getSupplierSuggestions = async (query: string) => {
        const q = query.toLowerCase();
        return suppliers.filter(s => s.toLowerCase().includes(q));
    };


    const formatCurrency = (value: number): string => {
        return `₹${Math.round(value).toLocaleString('en-IN')}`;
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900">Create Purchase Order</h3>
                </div>

                {/* Body */}
                <div className="px-6 py-4 space-y-4">
                    {/* Summary */}
                    <div className="bg-gray-50 rounded-lg p-4">
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-sm text-gray-600">Total Items:</span>
                            <span className="font-semibold">{totalItems}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-gray-600">Estimated Cost:</span>
                            <span className="font-bold text-lg text-indigo-600">{formatCurrency(totalCost)}</span>
                        </div>
                    </div>

                    {/* Supplier Name */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Supplier Name (Optional)
                        </label>
                        <AutocompleteInput
                            value={supplierName}
                            onChange={(val) => setSupplierName(val)}
                            placeholder="Enter or select supplier name..."
                            label=""
                            getSuggestions={getSupplierSuggestions}
                            minChars={0}
                            debounceMs={0}
                        />
                    </div>

                    {/* Notes */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Notes (Optional)
                        </label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={3}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none"
                            placeholder="Enter any notes for the purchase order..."
                            disabled={processing}
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-gray-600 hover:text-gray-800 border border-gray-300 hover:border-gray-400 rounded-md transition-colors disabled:opacity-50"
                        disabled={processing}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => onConfirm(supplierName || undefined, notes || undefined)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                        disabled={processing}
                    >
                        {processing ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                <span>Creating PO...</span>
                            </>
                        ) : (
                            <>
                                <FileText size={16} />
                                <span>Create & Download PDF</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DraftPOManager;
