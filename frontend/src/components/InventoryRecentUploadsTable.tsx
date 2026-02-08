import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface InventoryUploadHistoryItem {
    date: string;
    count: number;
    invoice_ids: string[];
}

interface InventoryRecentUploadsTableProps {
    history: InventoryUploadHistoryItem[];
    onViewAll?: () => void;
}

/**
 * Format date string to a friendly format
 * e.g., "2024-01-21" -> "Wed, 21 Jan"
 */
const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const targetDate = new Date(date);
    targetDate.setHours(0, 0, 0, 0);

    // Check if it's today or yesterday
    if (targetDate.getTime() === today.getTime()) {
        return 'Today';
    } else if (targetDate.getTime() === yesterday.getTime()) {
        return 'Yesterday';
    }

    // Format as "Wed, 21 Jan"
    return date.toLocaleDateString('en-US', {
        weekday: 'short',
        day: 'numeric',
        month: 'short'
    });
};

const InventoryRecentUploadsTable: React.FC<InventoryRecentUploadsTableProps> = ({ history, onViewAll }) => {
    const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

    const toggleExpand = (date: string) => {
        const newExpanded = new Set(expandedDates);
        if (newExpanded.has(date)) {
            newExpanded.delete(date);
        } else {
            newExpanded.add(date);
        }
        setExpandedDates(newExpanded);
    };

    if (!history || history.length === 0) {
        return (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Uploads</h2>
                <p className="text-gray-500 text-sm text-center py-8">
                    No upload history yet. Upload your first vendor invoice to get started!
                </p>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Recent Uploads</h2>
                {onViewAll && (
                    <button
                        onClick={onViewAll}
                        className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                    >
                        View All
                    </button>
                )}
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Date
                            </th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                Invoices
                            </th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {history.map((item) => {
                            const isExpanded = expandedDates.has(item.date);
                            const showMoreCount = Math.max(0, item.invoice_ids.length - 10);

                            return (
                                <React.Fragment key={item.date}>
                                    <tr className="hover:bg-gray-50 transition-colors">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <button
                                                onClick={() => toggleExpand(item.date)}
                                                className="flex items-center gap-2 text-sm font-medium text-gray-900 hover:text-blue-600"
                                            >
                                                {isExpanded ? (
                                                    <ChevronDown className="w-4 h-4" />
                                                ) : (
                                                    <ChevronRight className="w-4 h-4" />
                                                )}
                                                {formatDate(item.date)}
                                            </button>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-900 font-medium">
                                            {item.count}
                                        </td>
                                    </tr>
                                    {isExpanded && (
                                        <tr>
                                            <td colSpan={2} className="px-6 py-3 bg-gray-50">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-medium text-gray-500 flex-shrink-0">
                                                        Invoice #:
                                                    </span>
                                                    <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
                                                        {item.invoice_ids.slice(0, 10).map((id, idx) => (
                                                            <span
                                                                key={idx}
                                                                className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-blue-100 text-blue-800 whitespace-nowrap flex-shrink-0"
                                                            >
                                                                {id}
                                                            </span>
                                                        ))}
                                                        {showMoreCount > 0 && (
                                                            <span className="inline-flex items-center px-2.5 py-0.5 text-xs font-medium text-gray-600 whitespace-nowrap flex-shrink-0">
                                                                +{showMoreCount} more
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default InventoryRecentUploadsTable;
