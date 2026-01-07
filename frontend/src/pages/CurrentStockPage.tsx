import React, { useState, useEffect, useCallback } from 'react';
import { Search, TrendingUp, AlertTriangle, XCircle, RefreshCw, Plus, ExternalLink, X, Package } from 'lucide-react';
import {
    getStockLevels,
    getStockSummary,
    updateStockLevel,
    adjustStock,
    calculateStockLevels,
    getStockHistory,
    type StockLevel,
    type StockSummary,
    type StockTransaction,
} from '../services/stockApi';

const CurrentStockPage: React.FC = () => {
    const [stockItems, setStockItems] = useState<StockLevel[]>([]);
    const [summary, setSummary] = useState<StockSummary>({
        total_stock_value: 0,
        low_stock_items: 0,
        out_of_stock: 0,
        total_items: 0,
    });
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [selectedPartHistory, setSelectedPartHistory] = useState<{ partNumber: string; itemName: string } | null>(null);
    const [isCalculating, setIsCalculating] = useState(false);

    // Load data
    const loadData = useCallback(async () => {
        try {
            setLoading(true);
            const [itemsData, summaryData] = await Promise.all([
                getStockLevels({ search: searchQuery, status_filter: statusFilter }),
                getStockSummary(),
            ]);

            // Sort by Customer Item (alphabetically)
            const sortedItems = [...itemsData.items].sort((a, b) => {
                const aName = a.customer_items || a.internal_item_name || '';
                const bName = b.customer_items || b.internal_item_name || '';
                return aName.localeCompare(bName);
            });

            // Set default reorder_point to 2 if not set
            sortedItems.forEach(item => {
                if (item.reorder_point === 0 || item.reorder_point === null) {
                    item.reorder_point = 2;
                }
            });

            setStockItems(sortedItems);
            setSummary(summaryData);
        } catch (error) {
            console.error('Error loading stock data:', error);
        } finally {
            setLoading(false);
        }
    }, [searchQuery, statusFilter]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // Trigger stock calculation
    const handleCalculateStock = async () => {
        if (!confirm('Recalculate all stock levels from existing data? This may take a moment.')) {
            return;
        }

        try {
            setIsCalculating(true);
            await calculateStockLevels();
            await loadData();
            alert('Stock levels recalculated successfully!');
        } catch (error) {
            console.error('Error calculating stock:', error);
            alert('Failed to calculate stock levels');
        } finally {
            setIsCalculating(false);
        }
    };

    // Inline edit handler with debounce
    const handleFieldUpdate = async (id: number, field: 'reorder_point' | 'unit_value', value: number) => {
        if (value < 0) {
            alert(`${field === 'reorder_point' ? 'Reorder point' : 'Unit value'} must be >= 0`);
            return;
        }

        try {
            const updates = { [field]: value };
            await updateStockLevel(id, updates);
            await loadData(); // Refresh to get updated total_value
        } catch (error) {
            console.error('Error updating stock level:', error);
            alert('Failed to update stock level');
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
            {/* Header */}
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold text-gray-900">Current Stock Levels</h1>
                <button
                    onClick={handleCalculateStock}
                    disabled={isCalculating}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                    <RefreshCw size={16} className={isCalculating ? 'animate-spin' : ''} />
                    {isCalculating ? 'Calculating...' : 'Recalculate Stock'}
                </button>
            </div>

            <p className="text-gray-600">
                Real-time view of stock on hand, combining sales outflows and vendor inflows.
            </p>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-600">Total Stock Value</p>
                            <p className="text-3xl font-bold text-gray-900 mt-2">
                                ₹{summary.total_stock_value.toLocaleString('en-IN')}
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
                            <AlertTriangle className="text-orange-600" size={24} />
                        </div>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm text-gray-600">Out of Stock</p>
                            <p className="text-3xl font-bold text-red-600 mt-2">
                                {summary.out_of_stock}
                            </p>
                        </div>
                        <div className="p-3 bg-red-100 rounded-lg">
                            <XCircle className="text-red-600" size={24} />
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

                    {/* Manual Adjustment Button */}
                    <button
                        onClick={() => setShowAdjustmentModal(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 whitespace-nowrap"
                    >
                        <Plus size={16} />
                        Manual Stock Adjustment
                    </button>
                </div>
            </div>

            {/* Stock Table */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                {loading ? (
                    <div className="p-8 text-center text-gray-500">Loading stock levels...</div>
                ) : stockItems.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">
                        No stock items found. Upload vendor invoices to populate stock levels.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50 border-b border-gray-200">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                                        Internal Item Name
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                                        Part Number
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                                        Customer Item
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                                        Status
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                                        Reorder Point
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                                        Stock On Hand
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                                        Unit Value
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                                        Total Value
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase">
                                        Actions
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {stockItems.map((item) => (
                                    <tr key={item.id} className="hover:bg-gray-50">
                                        <td className="px-4 py-3 text-sm text-gray-900">
                                            {item.internal_item_name}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-700 font-mono">
                                            {item.part_number}
                                        </td>
                                        <td className="px-4 py-3 text-sm">
                                            <input
                                                type="text"
                                                value={item.customer_items || ''}
                                                onChange={async (e) => {
                                                    const newValue = e.target.value.trim();
                                                    if (newValue && newValue !== item.customer_items) {
                                                        try {
                                                            // Create vendor mapping entry
                                                            const response = await fetch('/api/vendor-mapping/save', {
                                                                method: 'POST',
                                                                headers: { 'Content-Type': 'application/json' },
                                                                body: JSON.stringify({
                                                                    mappings: [{
                                                                        part_number: item.part_number,
                                                                        vendor_description: item.internal_item_name,
                                                                        customer_item: newValue,
                                                                        status: 'Added'
                                                                    }]
                                                                })
                                                            });

                                                            if (response.ok) {
                                                                // Reload data to reflect changes
                                                                await loadData();
                                                                alert(`Linked "${item.part_number}" to "${newValue}" successfully!`);
                                                            } else {
                                                                throw new Error('Failed to create mapping');
                                                            }
                                                        } catch (error) {
                                                            console.error('Error creating vendor mapping:', error);
                                                            alert('Failed to link customer item');
                                                        }
                                                    }
                                                }}
                                                placeholder="Enter customer item name"
                                                className={`w-full px-2 py-1 border rounded text-xs ${item.customer_items
                                                        ? 'border-green-300 bg-green-50 text-green-700'
                                                        : 'border-gray-300 bg-gray-50 text-gray-600'
                                                    }`}
                                            />
                                        </td>
                                        <td className="px-4 py-3 text-sm">
                                            {getStatusBadge(item.status || 'In Stock')}
                                        </td>
                                        <td className="px-4 py-3 text-sm">
                                            <input
                                                type="number"
                                                value={item.reorder_point}
                                                onChange={(e) =>
                                                    handleFieldUpdate(item.id, 'reorder_point', parseFloat(e.target.value) || 0)
                                                }
                                                className="w-20 px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                                min="0"
                                                step="1"
                                            />
                                        </td>
                                        <td className="px-4 py-3 text-sm">
                                            <div className="flex flex-col">
                                                <span className="font-semibold text-gray-900">
                                                    {item.current_stock.toFixed(2)}
                                                </span>
                                                <span className="text-xs text-gray-500">
                                                    {item.total_in.toFixed(2)} in | {item.total_out.toFixed(2)} out
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-sm">
                                            <input
                                                type="number"
                                                value={item.unit_value}
                                                onChange={(e) =>
                                                    handleFieldUpdate(item.id, 'unit_value', parseFloat(e.target.value) || 0)
                                                }
                                                className="w-24 px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                                min="0"
                                                step="0.01"
                                            />
                                        </td>
                                        <td className="px-4 py-3 text-sm font-semibold text-gray-900">
                                            ₹{item.total_value.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                        </td>
                                        <td className="px-4 py-3 text-sm">
                                            <button
                                                className="text-blue-600 hover:text-blue-800 hover:underline"
                                                onClick={() => {
                                                    setSelectedPartHistory({
                                                        partNumber: item.part_number,
                                                        itemName: item.internal_item_name
                                                    });
                                                    setShowHistoryModal(true);
                                                }}
                                            >
                                                View History
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Manual Adjustment Modal */}
            {showAdjustmentModal && (
                <ManualAdjustmentModal
                    stockItems={stockItems}
                    onClose={() => setShowAdjustmentModal(false)}
                    onSuccess={() => {
                        setShowAdjustmentModal(false);
                        loadData();
                    }}
                />
            )}

            {/* Transaction History Modal */}
            {showHistoryModal && selectedPartHistory && (
                <TransactionHistoryModal
                    partNumber={selectedPartHistory.partNumber}
                    itemName={selectedPartHistory.itemName}
                    onClose={() => {
                        setShowHistoryModal(false);
                        setSelectedPartHistory(null);
                    }}
                />
            )}
        </div>
    );
};

// Manual Adjustment Modal Component
interface ManualAdjustmentModalProps {
    stockItems: StockLevel[];
    onClose: () => void;
    onSuccess: () => void;
}

const ManualAdjustmentModal: React.FC<ManualAdjustmentModalProps> = ({ stockItems, onClose, onSuccess }) => {
    const [selectedPart, setSelectedPart] = useState('');
    const [adjustmentType, setAdjustmentType] = useState<'add' | 'subtract' | 'set_absolute'>('add');
    const [quantity, setQuantity] = useState('');
    const [reason, setReason] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!selectedPart || !quantity) {
            alert('Please fill in all required fields');
            return;
        }

        const qty = parseFloat(quantity);
        if (isNaN(qty) || qty < 0) {
            alert('Quantity must be a positive number');
            return;
        }

        try {
            setLoading(true);
            const result = await adjustStock({
                part_number: selectedPart,
                adjustment_type: adjustmentType,
                quantity: qty,
                reason: reason || undefined,
            });

            alert(
                `Stock adjusted successfully!\n` +
                `Previous: ${result.previous_stock}\n` +
                `New: ${result.new_stock}`
            );
            onSuccess();
        } catch (error: any) {
            console.error('Error adjusting stock:', error);
            alert(error.response?.data?.detail || 'Failed to adjust stock');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-4">Manual Stock Adjustment</h2>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Part Selection */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Select Part <span className="text-red-500">*</span>
                        </label>
                        <select
                            value={selectedPart}
                            onChange={(e) => setSelectedPart(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            required
                        >
                            <option value="">-- Select Part --</option>
                            {stockItems.map((item) => (
                                <option key={item.id} value={item.part_number}>
                                    {item.part_number} - {item.internal_item_name} (Stock: {item.current_stock})
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Adjustment Type */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Adjustment Type <span className="text-red-500">*</span>
                        </label>
                        <select
                            value={adjustmentType}
                            onChange={(e) => setAdjustmentType(e.target.value as any)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="add">Add to Stock</option>
                            <option value="subtract">Subtract from Stock</option>
                            <option value="set_absolute">Set Absolute Value</option>
                        </select>
                    </div>

                    {/* Quantity */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Quantity <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="number"
                            value={quantity}
                            onChange={(e) => setQuantity(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            min="0"
                            step="0.01"
                            required
                        />
                    </div>

                    {/* Reason */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Reason (Optional)
                        </label>
                        <textarea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            rows={3}
                            placeholder="e.g., Physical count correction, Damage, Return"
                        />
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                            disabled={loading}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                            disabled={loading}
                        >
                            {loading ? 'Adjusting...' : 'Confirm Adjustment'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// Transaction History Modal Component
interface TransactionHistoryModalProps {
    partNumber: string;
    itemName: string;
    onClose: () => void;
}

const TransactionHistoryModal: React.FC<TransactionHistoryModalProps> = ({ partNumber, itemName, onClose }) => {
    const [transactions, setTransactions] = useState<StockTransaction[]>([]);
    const [summary, setSummary] = useState({ total_in: 0, total_out: 0, transaction_count: 0 });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadHistory = async () => {
            try {
                setLoading(true);
                const data = await getStockHistory(partNumber);
                setTransactions(data.transactions);
                setSummary(data.summary);
            } catch (error) {
                console.error('Error loading transaction history:', error);
                alert('Failed to load transaction history');
            } finally {
                setLoading(false);
            }
        };

        loadHistory();
    }, [partNumber]);

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
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {transactions.map((txn, index) => (
                                    <tr key={index} className="hover:bg-gray-50">
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
                                        <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900">
                                            {txn.quantity.toFixed(2)}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-right text-gray-700">
                                            {txn.rate ? `₹${txn.rate.toFixed(2)}` : 'N/A'}
                                        </td>
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
                                    </tr>
                                ))}
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
};

export default CurrentStockPage;
