import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vendorMappingAPI } from '../services/vendorMappingApi';
import type { VendorMappingExportItem, VendorMappingEntry } from '../services/vendorMappingApi';
import { Loader2, Download, Upload, FileImage, Check, RefreshCw, Save, Eye, Plus, Search } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable, { type CellHookData } from 'jspdf-autotable';

type TabType = 'export' | 'upload' | 'review';

// EditableRow interface for tracking state

const VendorMappingPage: React.FC = () => {
    const [activeTab, setActiveTab] = useState<TabType>('export');
    const [uploadedFile, setUploadedFile] = useState<File | null>(null);
    const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
    const [isExtracting, setIsExtracting] = useState(false);
    const [extractionError, setExtractionError] = useState<string | null>(null);
    const [filterText, setFilterText] = useState('');
    const [queuedItemIds, setQueuedItemIds] = useState<Set<string>>(new Set());

    // Editable rows state (for inline editing on Export tab)
    const [editedRows, setEditedRows] = useState<Map<number, Partial<VendorMappingExportItem>>>(new Map());

    // Review queue (items ready to be saved)
    const [reviewQueue, setReviewQueue] = useState<VendorMappingEntry[]>([]);

    // Customer item search preloaded in query below

    const queryClient = useQueryClient();

    // Helper to generate unique item ID
    const getItemId = (vendorDesc: string, partNumber: string) => `${vendorDesc}|${partNumber}`;

    // Fetch export data (unique vendor items, excluding already mapped)
    const { data: exportData, isLoading: loadingExport } = useQuery({
        queryKey: ['vendor-mapping-export-data'],
        queryFn: vendorMappingAPI.getExportData,
    });

    // Customer items search (preload all for autocomplete)
    const { data: customerItems } = useQuery({
        queryKey: ['customer-items-search'],
        queryFn: () => vendorMappingAPI.searchCustomerItems(''), // Fetch ALL items
        staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    });

    // Upload mutation
    const uploadMutation = useMutation({
        mutationFn: (file: File) => vendorMappingAPI.uploadScan(file),
        onSuccess: (data) => {
            setUploadedImageUrl(data.url);
        },
        onError: (error: any) => {
            alert(`Upload failed: ${error.message}`);
        },
    });

    // Bulk save mutation
    const bulkSaveMutation = useMutation({
        mutationFn: async () => {
            return vendorMappingAPI.bulkSaveEntries(reviewQueue, uploadedImageUrl || undefined);
        },
        onSuccess: (data) => {
            alert(`Successfully saved ${data.saved_count} entries!`);
            queryClient.invalidateQueries({ queryKey: ['vendor-mapping-export-data'] });
            queryClient.invalidateQueries({ queryKey: ['vendor-mapping-entries'] });
            // Clear state
            setReviewQueue([]);
            setEditedRows(new Map());
            setQueuedItemIds(new Set());
            setActiveTab('export');
        },
        onError: (error: any) => {
            alert(`Save failed: ${error.message}`);
        },
    });

    // Handle inline edit
    const handleEditCell = (rowNumber: number, field: string, value: any) => {
        setEditedRows(prev => {
            const newMap = new Map(prev);
            const existing = newMap.get(rowNumber) || {};
            newMap.set(rowNumber, { ...existing, [field]: value });
            return newMap;
        });
    };

    // Get display value (edited or original)
    const getDisplayValue = (item: VendorMappingExportItem, field: keyof VendorMappingExportItem) => {
        const edited = editedRows.get(item.row_number);
        if (edited && field in edited) {
            return (edited as any)[field];
        }
        return item[field];
    };

    // Add single row to review queue
    const addToReview = (item: VendorMappingExportItem, status: 'Pending' | 'Skip' = 'Pending') => {
        const edited = editedRows.get(item.row_number) || {};
        const entry: VendorMappingEntry = {
            row_number: item.row_number,
            vendor_description: item.vendor_description,
            part_number: item.part_number,
            customer_item_name: edited.customer_item_name ?? item.customer_item_name,
            stock: edited.stock ?? item.stock,
            reorder: edited.reorder ?? item.reorder,
            notes: edited.notes ?? item.notes,
            status,
        };

        const itemId = getItemId(item.vendor_description, item.part_number);

        // Check if already in review queue
        if (!reviewQueue.find(r => r.vendor_description === entry.vendor_description && r.part_number === entry.part_number)) {
            setReviewQueue(prev => [...prev, entry]);
            // Track as queued
            setQueuedItemIds(prev => new Set(prev).add(itemId));
        }

        // DO NOT clear from edited rows - keep item visible
    };

    // Add all edited rows to review
    const addAllToReview = () => {
        if (!exportData?.items) return;

        const newEntries: VendorMappingEntry[] = [];
        const newQueuedIds = new Set(queuedItemIds);

        editedRows.forEach((edited, rowNumber) => {
            const item = exportData.items.find(i => i.row_number === rowNumber);
            if (item) {
                const entry: VendorMappingEntry = {
                    row_number: item.row_number,
                    vendor_description: item.vendor_description,
                    part_number: item.part_number,
                    customer_item_name: edited.customer_item_name ?? item.customer_item_name,
                    stock: edited.stock ?? item.stock,
                    reorder: edited.reorder ?? item.reorder,
                    notes: edited.notes ?? item.notes,
                    status: 'Pending',
                };

                if (!reviewQueue.find(r => r.vendor_description === entry.vendor_description && r.part_number === entry.part_number)) {
                    newEntries.push(entry);
                    newQueuedIds.add(getItemId(item.vendor_description, item.part_number));
                }
            }
        });

        setReviewQueue(prev => [...prev, ...newEntries]);
        setQueuedItemIds(newQueuedIds);
        // DO NOT clear edited rows - keep items visible

        if (newEntries.length > 0) {
            setActiveTab('review');
        }
    };

    // Remove from review queue
    const removeFromReview = (index: number) => {
        const entry = reviewQueue[index];
        if (entry) {
            const itemId = getItemId(entry.vendor_description, entry.part_number);
            setQueuedItemIds(prev => {
                const newSet = new Set(prev);
                newSet.delete(itemId);
                return newSet;
            });
        }
        setReviewQueue(prev => prev.filter((_, i) => i !== index));
    };

    // Edit review item
    const editReviewItem = (index: number, field: string, value: any) => {
        setReviewQueue(prev => {
            const newQueue = [...prev];
            newQueue[index] = { ...newQueue[index], [field]: value };
            return newQueue;
        });
    };

    // Generate PDF for printing
    const handleExportPDF = useCallback(() => {
        if (!exportData?.items?.length) {
            alert('No data to export');
            return;
        }

        const doc = new jsPDF('landscape', 'mm', 'a4');

        doc.setFontSize(16);
        doc.text('Vendor Mapping Sheet', 14, 15);
        doc.setFontSize(10);
        doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 22);
        doc.text('Fill in Customer Item, Stock, and Reorder columns by hand', 14, 27);

        const tableData = exportData.items.map((item: VendorMappingExportItem) => [
            item.row_number.toString(),
            item.vendor_description || '',
            item.part_number || '',
            '', // Customer Item - blank
            '', // Stock - blank
            '', // Reorder - blank
        ]);

        // A4 landscape: 297mm width, use margins of 10mm each side = 277mm usable
        autoTable(doc, {
            head: [['#', 'Vendor Description', 'Part Number', 'Customer Item', 'Stock', 'Reorder']],
            body: tableData,
            startY: 32,
            margin: { left: 10, right: 10 },
            tableWidth: 'auto',
            styles: { fontSize: 9, cellPadding: 3, lineWidth: 0.5, lineColor: [0, 0, 0] },
            headStyles: { fillColor: [66, 139, 202], textColor: [255, 255, 255], fontStyle: 'bold' },
            columnStyles: {
                0: { cellWidth: 12, halign: 'center' },   // #
                1: { cellWidth: 75 },                      // Vendor Description
                2: { cellWidth: 45 },                      // Part Number
                3: { cellWidth: 100, minCellHeight: 14 },  // Customer Item (widest)
                4: { cellWidth: 22, minCellHeight: 14 },   // Stock
                5: { cellWidth: 22, minCellHeight: 14 },   // Reorder
            },
            didDrawCell: (data: CellHookData) => {
                if (data.section === 'body' && data.column.index >= 3) {
                    const { x, y, width, height } = data.cell;
                    doc.setDrawColor(200, 200, 200);
                    doc.rect(x + 2, y + 2, width - 4, height - 4);
                }
            },
        });

        doc.save(`vendor_mapping_sheet_${new Date().toISOString().split('T')[0]}.pdf`);
    }, [exportData]);

    // Handle file drop/select
    const handleFileSelect = (files: FileList | null) => {
        if (files && files.length > 0) {
            const file = files[0];
            if (!file.type.startsWith('image/')) {
                alert('Please upload an image file');
                return;
            }
            setUploadedFile(file);
            uploadMutation.mutate(file);
        }
    };

    // Extract data from uploaded image
    const handleExtract = async () => {
        if (!uploadedImageUrl) return;

        setIsExtracting(true);
        setExtractionError(null);

        try {
            const result = await vendorMappingAPI.extractFromImage(uploadedImageUrl);
            if (result.success && result.data?.rows) {
                // Convert extracted rows to review queue entries
                const entries: VendorMappingEntry[] = result.data.rows.map(row => ({
                    row_number: row.row_number,
                    vendor_description: row.vendor_description,
                    part_number: row.part_number,
                    customer_item_name: null,
                    stock: row.stock,
                    reorder: row.reorder,
                    notes: row.notes,
                    status: 'Pending' as const,
                }));
                setReviewQueue(entries);
                setActiveTab('review');
            } else {
                setExtractionError('No data extracted from image');
            }
        } catch (error: any) {
            setExtractionError(error.message || 'Extraction failed');
        } finally {
            setIsExtracting(false);
        }
    };

    // Tab button component
    const TabButton: React.FC<{ tab: TabType; label: string; icon: React.ReactNode; badge?: number }> = ({ tab, label, icon, badge }) => (
        <button
            onClick={() => setActiveTab(tab)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition relative ${activeTab === tab ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                }`}
        >
            {icon}
            {label}
            {badge !== undefined && badge > 0 && (
                <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full px-2 py-0.5">{badge}</span>
            )}
        </button>
    );

    const editedCount = editedRows.size;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Link Items</h1>
                    <p className="text-gray-600 mt-1">
                        Map vendor items to customer items - Edit inline or export PDF for handwritten entry
                    </p>
                </div>

                <div className="flex gap-3">
                    {editedCount > 0 && (
                        <button
                            onClick={addAllToReview}
                            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition"
                        >
                            <Plus size={18} />
                            Add All to Review ({editedCount})
                        </button>
                    )}
                    <button
                        onClick={handleExportPDF}
                        disabled={loadingExport || !exportData?.items?.length}
                        className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition disabled:opacity-50 shadow-lg"
                    >
                        <Download size={20} />
                        Export PDF ({exportData?.total || 0})
                    </button>
                </div>
            </div>

            {/* Tab Navigation */}
            <div className="flex gap-3">
                <TabButton tab="export" label="1. Edit Items" icon={<Search size={18} />} badge={editedCount} />
                <TabButton tab="upload" label="2. Upload Scan" icon={<Upload size={18} />} />
                <TabButton tab="review" label="3. Review & Save" icon={<Eye size={18} />} badge={reviewQueue.length} />
            </div>

            {/* Tab Content */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">

                {/* Export/Edit Tab */}
                {activeTab === 'export' && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <input
                                type="text"
                                value={filterText}
                                onChange={(e) => setFilterText(e.target.value)}
                                placeholder="Filter by Vendor Description, Part Number, or Customer Item..."
                                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                            {filterText && (
                                <button
                                    onClick={() => setFilterText('')}
                                    className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium"
                                >
                                    Clear
                                </button>
                            )}
                        </div>

                        {loadingExport ? (
                            <div className="flex justify-center py-12">
                                <Loader2 className="animate-spin text-blue-600" size={32} />
                            </div>
                        ) : exportData?.items?.length === 0 ? (
                            <div className="text-center py-12 text-gray-500">
                                <Check size={48} className="mx-auto mb-3 opacity-50" />
                                <p>All items have been linked! Check Linked Items.</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto max-h-[500px]">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50 sticky top-0 z-10">
                                        <tr>
                                            <th className="px-3 py-2 text-left font-medium text-gray-700 w-10">#</th>
                                            <th className="px-3 py-2 text-left font-medium text-gray-700 w-44">Vendor Description</th>
                                            <th className="px-3 py-2 text-left font-medium text-gray-700 w-32">Part Number</th>
                                            <th className="px-3 py-2 text-left font-medium text-gray-700 w-52">Customer Item</th>
                                            <th className="px-3 py-2 text-left font-medium text-gray-700 w-16">Stock</th>
                                            <th className="px-3 py-2 text-left font-medium text-gray-700 w-16">Reorder</th>
                                            <th className="px-3 py-2 text-left font-medium text-gray-700 w-28">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {exportData?.items?.filter((item: VendorMappingExportItem) => {
                                            if (!filterText) return true;
                                            const searchLower = filterText.toLowerCase();
                                            return (
                                                item.vendor_description?.toLowerCase().includes(searchLower) ||
                                                item.part_number?.toLowerCase().includes(searchLower) ||
                                                item.customer_item_name?.toLowerCase().includes(searchLower) ||
                                                getDisplayValue(item, 'customer_item_name')?.toString().toLowerCase().includes(searchLower)
                                            );
                                        }).map((item: VendorMappingExportItem) => {
                                            const itemId = getItemId(item.vendor_description, item.part_number);
                                            const isQueued = queuedItemIds.has(itemId);
                                            const queuedEntry = reviewQueue.find(r => r.vendor_description === item.vendor_description && r.part_number === item.part_number);
                                            const isSkipped = queuedEntry?.status === 'Skip';
                                            return (
                                                <tr key={item.row_number} className={`hover:bg-gray-50 ${isQueued ? (isSkipped ? 'bg-gray-100' : 'bg-green-50') :
                                                    editedRows.has(item.row_number) ? 'bg-yellow-50' : ''
                                                    }`}>
                                                    <td className="px-3 py-2 text-gray-500">{item.row_number}</td>
                                                    <td className="px-3 py-2 font-medium max-w-[180px] truncate" title={item.vendor_description}>
                                                        {item.vendor_description}
                                                    </td>
                                                    <td className="px-3 py-2 text-gray-600 font-mono text-xs">{item.part_number || '-'}</td>
                                                    <td className="px-3 py-2">
                                                        <input
                                                            type="text"
                                                            value={getDisplayValue(item, 'customer_item_name') ?? ''}
                                                            onChange={(e) => handleEditCell(item.row_number, 'customer_item_name', e.target.value || null)}
                                                            className="w-48 px-2 py-1 border rounded focus:ring-2 focus:ring-blue-500 text-sm"
                                                            placeholder="Customer item..."
                                                            list={`customer-items-${item.row_number}`}
                                                        />
                                                        <datalist id={`customer-items-${item.row_number}`}>
                                                            {customerItems?.items?.map((ci, idx) => (
                                                                <option key={idx} value={ci.customer_item} />
                                                            ))}
                                                        </datalist>
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <input
                                                            type="number"
                                                            value={getDisplayValue(item, 'stock') ?? ''}
                                                            onChange={(e) => handleEditCell(item.row_number, 'stock', e.target.value ? parseFloat(e.target.value) : null)}
                                                            className="w-16 px-2 py-1 border rounded focus:ring-2 focus:ring-blue-500 text-sm"
                                                        />
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        <input
                                                            type="number"
                                                            value={getDisplayValue(item, 'reorder') ?? ''}
                                                            onChange={(e) => handleEditCell(item.row_number, 'reorder', e.target.value ? parseFloat(e.target.value) : null)}
                                                            className="w-16 px-2 py-1 border rounded focus:ring-2 focus:ring-blue-500 text-sm"
                                                        />
                                                    </td>
                                                    <td className="px-3 py-2">
                                                        {isQueued ? (
                                                            <div className="flex items-center gap-2">
                                                                {isSkipped ? (
                                                                    <span className="px-2 py-1 bg-gray-200 text-gray-700 text-xs rounded font-medium">Skipped</span>
                                                                ) : (
                                                                    <span className="px-2 py-1 bg-green-200 text-green-800 text-xs rounded font-medium flex items-center gap-1">
                                                                        <Check size={12} /> Added
                                                                    </span>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <div className="flex gap-1">
                                                                <button
                                                                    onClick={() => addToReview(item)}
                                                                    className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition"
                                                                >
                                                                    Add
                                                                </button>
                                                                <button
                                                                    onClick={() => addToReview(item, 'Skip')}
                                                                    className="px-2 py-1 bg-gray-500 text-white text-xs rounded hover:bg-gray-600 transition"
                                                                >
                                                                    Skip
                                                                </button>
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* Upload Tab */}
                {activeTab === 'upload' && (
                    <div className="space-y-6">
                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                            <h3 className="font-semibold text-yellow-900 mb-2">Upload Scanned Sheet</h3>
                            <p className="text-yellow-700 text-sm">
                                Print the PDF, fill by hand, scan/photo, and upload here. The handwritten values will be extracted automatically.
                            </p>
                        </div>

                        <div
                            className={`border-2 border-dashed rounded-xl p-12 text-center transition cursor-pointer
                                ${uploadMutation.isPending ? 'border-blue-300 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'}`}
                            onClick={() => document.getElementById('fileInput')?.click()}
                            onDrop={(e) => { e.preventDefault(); handleFileSelect(e.dataTransfer.files); }}
                            onDragOver={(e) => e.preventDefault()}
                        >
                            <input id="fileInput" type="file" accept="image/*" className="hidden" onChange={(e) => handleFileSelect(e.target.files)} />

                            {uploadMutation.isPending ? (
                                <div className="flex flex-col items-center gap-3">
                                    <Loader2 className="animate-spin text-blue-600" size={48} />
                                    <p className="text-blue-600 font-medium">Uploading...</p>
                                </div>
                            ) : uploadedFile ? (
                                <div className="flex flex-col items-center gap-3">
                                    <FileImage className="text-green-600" size={48} />
                                    <p className="font-medium text-gray-900">{uploadedFile.name}</p>
                                    <p className="text-sm text-gray-500">Click to change file</p>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center gap-3">
                                    <Upload className="text-gray-400" size={48} />
                                    <p className="font-medium text-gray-700">Drop your scanned image here</p>
                                    <p className="text-sm text-gray-500">or click to browse</p>
                                </div>
                            )}
                        </div>

                        {uploadedImageUrl && (
                            <div className="space-y-4">
                                <div className="border rounded-lg p-4 bg-gray-50">
                                    <p className="text-sm font-medium text-gray-700 mb-2">Preview:</p>
                                    <img src={uploadedImageUrl} alt="Uploaded scan" className="max-h-64 mx-auto rounded shadow" />
                                </div>

                                <button
                                    onClick={handleExtract}
                                    disabled={isExtracting}
                                    className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition disabled:opacity-50"
                                >
                                    {isExtracting ? (
                                        <><Loader2 className="animate-spin" size={20} /> Extracting with AI...</>
                                    ) : (
                                        <><RefreshCw size={20} /> Extract Handwritten Data</>
                                    )}
                                </button>

                                {extractionError && (
                                    <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">{extractionError}</div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Review Tab */}
                {activeTab === 'review' && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex-1">
                                <h3 className="font-semibold text-green-900 mb-1">Review & Confirm</h3>
                                <p className="text-green-700 text-sm">Review items before saving. Edit values if needed. Click Save All to confirm.</p>
                            </div>

                            <button
                                onClick={() => bulkSaveMutation.mutate()}
                                disabled={bulkSaveMutation.isPending || reviewQueue.length === 0}
                                className="ml-4 flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
                            >
                                {bulkSaveMutation.isPending ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                                Save All ({reviewQueue.length})
                            </button>
                        </div>

                        {reviewQueue.length === 0 ? (
                            <div className="text-center py-12 text-gray-500">
                                <FileImage size={48} className="mx-auto mb-3 opacity-50" />
                                <p>No items in review queue. Edit items in the Edit tab or extract from a scanned image.</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-3 py-2 text-left font-medium text-gray-700 w-10">#</th>
                                            <th className="px-3 py-2 text-left font-medium text-gray-700">Vendor Description</th>
                                            <th className="px-3 py-2 text-left font-medium text-gray-700 w-36">Part Number</th>
                                            <th className="px-3 py-2 text-left font-medium text-gray-700 w-48">Customer Item</th>
                                            <th className="px-3 py-2 text-left font-medium text-gray-700 w-20">Stock</th>
                                            <th className="px-3 py-2 text-left font-medium text-gray-700 w-20">Reorder</th>
                                            <th className="px-3 py-2 text-left font-medium text-gray-700 w-20">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {reviewQueue.map((entry, idx) => (
                                            <tr key={idx} className="hover:bg-gray-50">
                                                <td className="px-3 py-2 text-gray-500">{idx + 1}</td>
                                                <td className="px-3 py-2 font-medium max-w-[200px] truncate">{entry.vendor_description}</td>
                                                <td className="px-3 py-2 text-gray-600">{entry.part_number || '-'}</td>
                                                <td className="px-3 py-2">
                                                    <input
                                                        type="text"
                                                        value={entry.customer_item_name ?? ''}
                                                        onChange={(e) => editReviewItem(idx, 'customer_item_name', e.target.value || null)}
                                                        className="w-44 px-2 py-1 border rounded focus:ring-2 focus:ring-blue-500 text-sm"
                                                    />
                                                </td>
                                                <td className="px-3 py-2">
                                                    <input
                                                        type="number"
                                                        value={entry.stock ?? ''}
                                                        onChange={(e) => editReviewItem(idx, 'stock', e.target.value ? parseFloat(e.target.value) : null)}
                                                        className="w-16 px-2 py-1 border rounded focus:ring-2 focus:ring-blue-500 text-sm"
                                                    />
                                                </td>
                                                <td className="px-3 py-2">
                                                    <input
                                                        type="number"
                                                        value={entry.reorder ?? ''}
                                                        onChange={(e) => editReviewItem(idx, 'reorder', e.target.value ? parseFloat(e.target.value) : null)}
                                                        className="w-16 px-2 py-1 border rounded focus:ring-2 focus:ring-blue-500 text-sm"
                                                    />
                                                </td>
                                                <td className="px-3 py-2">
                                                    <button
                                                        onClick={() => removeFromReview(idx)}
                                                        className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded hover:bg-red-200 transition"
                                                    >
                                                        Remove
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Sticky Floating Review & Save Button */}
            {reviewQueue.length > 0 && (
                <div className="fixed bottom-6 right-6 z-50">
                    <button
                        onClick={() => setActiveTab('review')}
                        className="flex items-center gap-3 px-6 py-4 bg-blue-600 text-white rounded-full shadow-2xl hover:bg-blue-700 transition-all hover:scale-105 animate-pulse hover:animate-none"
                    >
                        <Eye size={24} />
                        <span className="font-semibold text-lg">Review & Save ({reviewQueue.length})</span>
                    </button>
                </div>
            )}
        </div>
    );
};

export default VendorMappingPage;
