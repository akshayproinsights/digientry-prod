import React from 'react';
import { Info } from 'lucide-react';

interface InventoryResumeBannerProps {
    lastDate: string | null;
    lastInvoiceNumber: string | null;
    count?: number; // Added count prop
    status: string;
    onViewHistory?: () => void;
}

/**
 * Format date string to a friendly format
 * e.g., "2024-01-21" -> "Yesterday (Wed, 21 Jan)"
 */
const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return '';

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

const InventoryResumeBanner: React.FC<InventoryResumeBannerProps> = ({
    lastDate,
    lastInvoiceNumber,
    count = 1, // Default to 1 if not provided
    status,
    onViewHistory
}) => {
    // Don't render if no data
    if (status === 'no_uploads' || !lastDate || !lastInvoiceNumber) {
        return null;
    }

    const formattedDate = formatDate(lastDate);

    return (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                    <p className="text-blue-900 text-sm">
                        {count > 1 ? (
                            <>
                                Last upload for <span className="font-semibold">{formattedDate}</span> included{' '}
                                <span className="font-semibold">{count} invoices</span> (Latest: #{lastInvoiceNumber}).
                            </>
                        ) : (
                            <>
                                Last upload was for <span className="font-semibold">Invoice #{lastInvoiceNumber}</span>{' '}
                                on <span className="font-semibold">{formattedDate}</span>.
                            </>
                        )}
                        {onViewHistory && (
                            <>
                                {' | '}
                                <button
                                    onClick={onViewHistory}
                                    className="text-blue-700 hover:text-blue-800 font-medium underline"
                                >
                                    View History
                                </button>
                            </>
                        )}
                    </p>
                </div>
            </div>
        </div>
    );
};

export default InventoryResumeBanner;
