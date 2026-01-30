import React from 'react';
import { ScanBarcode, PackageX, AlertTriangle, IndianRupee } from 'lucide-react';

interface ActionCardsProps {
    pendingBillsCount: number;
    unmappedItemsCount: number;
    outOfStockCount: number;
    totalSales: number;
    salesChange: number;
    dateRangeLabel: string;
    onNavigateToReviewSales: () => void;
    onNavigateToUnmappedItems: () => void;
    onNavigateToOutOfStock: () => void;
}

interface ActionCard {
    id: string;
    title: string;
    value: string | number;
    icon: React.ElementType;
    themeColor: 'blue' | 'amber' | 'red' | 'green';
    actionType?: 'button' | 'link' | 'none';
    actionLabel?: string;
    onAction?: () => void;
    showTrend?: boolean;
    trendValue?: number;
}

const ActionCards: React.FC<ActionCardsProps> = ({
    pendingBillsCount,
    unmappedItemsCount,
    outOfStockCount,
    totalSales,
    salesChange,
    dateRangeLabel,
    onNavigateToReviewSales,
    onNavigateToUnmappedItems,
    onNavigateToOutOfStock,
}) => {
    // Format currency for Indian Rupee
    const formatCurrency = (value: number) =>
        `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

    const cards: ActionCard[] = [
        {
            id: 'pending-bills',
            title: 'Review & Sync',
            value: pendingBillsCount,
            icon: ScanBarcode,
            themeColor: 'blue',
            actionType: 'button',
            actionLabel: 'Process Now >',
            onAction: onNavigateToReviewSales,
        },
        {
            id: 'unmapped-items',
            title: 'Unmapped New Items',
            value: unmappedItemsCount,
            icon: PackageX,
            themeColor: 'amber',
            actionType: 'button',
            actionLabel: 'Map Items >',
            onAction: onNavigateToUnmappedItems,
        },
        {
            id: 'out-of-stock',
            title: 'Out of Stock Items',
            value: outOfStockCount,
            icon: AlertTriangle,
            themeColor: 'red',
            actionType: 'link',
            actionLabel: 'View Restock List >',
            onAction: onNavigateToOutOfStock,
        },
        {
            id: 'total-sales',
            title: `Total Sales ${dateRangeLabel}`,
            value: formatCurrency(totalSales),
            icon: IndianRupee,
            themeColor: 'green',
            actionType: 'none',
            showTrend: true,
            trendValue: salesChange,
        },
    ];

    const getThemeClasses = (color: 'blue' | 'amber' | 'red' | 'green') => {
        switch (color) {
            case 'blue':
                return {
                    border: 'border-blue-200',
                    iconBg: 'bg-blue-100',
                    iconText: 'text-blue-600',
                    textAccent: 'text-blue-600',
                    button: 'bg-blue-600 hover:bg-blue-700 text-white',
                };
            case 'amber':
                return {
                    border: 'border-amber-200',
                    iconBg: 'bg-amber-100',
                    iconText: 'text-amber-600',
                    textAccent: 'text-amber-600',
                    button: 'bg-amber-500 hover:bg-amber-600 text-gray-900',
                };
            case 'red':
                return {
                    border: 'border-red-200',
                    iconBg: 'bg-red-100',
                    iconText: 'text-red-600',
                    textAccent: 'text-red-600',
                    link: 'text-red-600 hover:text-red-700 hover:underline',
                };
            case 'green':
                return {
                    border: 'border-green-200',
                    iconBg: 'bg-green-100',
                    iconText: 'text-green-600',
                    textAccent: 'text-green-600',
                };
            default:
                return {
                    border: 'border-gray-200',
                    iconBg: 'bg-gray-100',
                    iconText: 'text-gray-600',
                    textAccent: 'text-gray-600',
                };
        }
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {cards.map((card) => {
                const theme = getThemeClasses(card.themeColor);
                const Icon = card.icon;

                return (
                    <div
                        key={card.id}
                        className={`bg-white rounded-lg shadow-sm ${theme.border} border hover:shadow-md transition-all duration-300 h-[90px] max-h-[90px]`}
                    >
                        {/* Horizontal Layout: Icon | Number | Label+Action */}
                        <div className="flex items-center h-full px-3 py-2.5 gap-2.5">
                            {/* Icon Box - Left */}
                            <div className={`${theme.iconBg} ${theme.iconText} w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0`}>
                                <Icon size={22} />
                            </div>

                            {/* Center Section: Label + Number */}
                            <div className="flex-1 min-w-0 overflow-hidden">
                                {/* Title - Readable size */}
                                <h3 className="text-[11px] font-semibold text-gray-600 uppercase tracking-tight mb-1 leading-tight line-clamp-1">
                                    {card.title}
                                </h3>

                                {/* Value - Large and Bold with tabular-nums */}
                                <p className={`text-2xl font-bold ${theme.textAccent} tabular-nums leading-none mb-0.5`}>
                                    {card.value}
                                </p>

                                {/* Trend for sales card */}
                                {card.showTrend && card.trendValue !== undefined && (
                                    <p className={`text-[10px] font-medium ${card.trendValue >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        {card.trendValue >= 0 ? '▲' : '▼'} {Math.abs(card.trendValue).toFixed(1)}%
                                    </p>
                                )}
                            </div>

                            {/* Right Section: Action Button/Link */}
                            {card.actionType === 'button' && (
                                <div className="flex-shrink-0">
                                    <button
                                        onClick={card.onAction}
                                        className={`${theme.button} px-2.5 py-1.5 rounded-md font-medium text-[11px] transition-all duration-200 hover:scale-105 active:scale-95 shadow-sm whitespace-nowrap`}
                                    >
                                        {card.actionLabel}
                                    </button>
                                </div>
                            )}

                            {card.actionType === 'link' && (
                                <div className="flex-shrink-0">
                                    <button
                                        onClick={card.onAction}
                                        className={`${theme.link} font-semibold text-[11px] transition-all duration-200 whitespace-nowrap`}
                                    >
                                        {card.actionLabel}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export default ActionCards;
