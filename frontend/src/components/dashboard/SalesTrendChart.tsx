import React, { useMemo } from 'react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from 'recharts';
import {
    format,
    eachDayOfInterval,
    eachWeekOfInterval,
    eachMonthOfInterval,
    parseISO,
    isSameDay,
    endOfWeek,
    endOfMonth,
    isWithinInterval
} from 'date-fns';
import { formatChartCurrency, formatYAxisValue, chartColors } from '../../utils/dashboardHelpers';
import type { DailySalesVolume } from '../../services/dashboardAPI';

interface SalesTrendChartProps {
    data: DailySalesVolume[];
    isLoading?: boolean;
    dateRangeLabel?: string;
    startDate?: string;
    endDate?: string;
    filterControls?: React.ReactNode;
    filterPanel?: React.ReactNode;
}

type AggregationType = 'daily' | 'weekly' | 'monthly';

interface AggregatedData {
    date: string;
    revenue: number;
    volume: number;
    parts_revenue: number;
    labor_revenue: number;
    period_label?: string; // For tooltips (e.g., "Week of Jan 1" or "January 2026")
    period_start?: string;
    period_end?: string;
}

const SalesTrendChart: React.FC<SalesTrendChartProps> = ({
    data,
    isLoading = false,
    dateRangeLabel = 'This Period',
    startDate,
    endDate,
    filterControls,
    filterPanel,
}) => {
    // Intelligent data processing with automatic aggregation
    const { processedData, aggregationType } = useMemo(() => {
        if (!data || !startDate || !endDate) {
            return { processedData: data || [], aggregationType: 'daily' as AggregationType };
        }

        try {
            // If no data exists, return empty array
            if (data.length === 0) {
                return { processedData: [], aggregationType: 'daily' as AggregationType };
            }

            // Sort data by date
            const dataSorted = [...data].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

            const firstDataDate = dataSorted[0].date;
            const lastDataDate = dataSorted[dataSorted.length - 1].date;

            const filterStart = parseISO(startDate);
            const filterEnd = parseISO(endDate);

            // For "All Time" (2000-01-01), use the actual data range
            let effectiveStart = startDate === '2000-01-01' ? parseISO(firstDataDate) : filterStart;
            let effectiveEnd = parseISO(lastDataDate) < filterEnd ? parseISO(lastDataDate) : filterEnd;

            // Safety check
            if (effectiveStart > effectiveEnd) {
                effectiveStart = parseISO(firstDataDate);
                effectiveEnd = parseISO(lastDataDate);
            }

            // Calculate the number of days in the range
            const daysDiff = Math.floor((effectiveEnd.getTime() - effectiveStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;

            // Determine aggregation strategy based on date range
            // Top 1% SaaS UX: Show optimal number of bars (30-50 is ideal for readability)
            let aggType: AggregationType;

            if (daysDiff <= 30) {
                // Short range: Daily granularity (up to 30 bars)
                aggType = 'daily';
            } else if (daysDiff <= 180) {
                // Medium range: Weekly aggregation (~4-26 bars)
                aggType = 'weekly';
            } else {
                // Long range: Monthly aggregation (~6-24 bars for up to 2 years)
                aggType = 'monthly';
            }

            console.log(`📊 Revenue Chart: ${daysDiff} days → ${aggType} aggregation`);

            // Aggregate data based on strategy
            let aggregatedData: AggregatedData[];

            if (aggType === 'daily') {
                // Daily: Fill gaps for continuity
                const allDays = eachDayOfInterval({ start: effectiveStart, end: effectiveEnd });

                aggregatedData = allDays.map(day => {
                    const existingData = dataSorted.find(d => isSameDay(parseISO(d.date), day));
                    if (existingData) return existingData;

                    return {
                        date: format(day, 'yyyy-MM-dd'),
                        revenue: 0,
                        volume: 0,
                        parts_revenue: 0,
                        labor_revenue: 0,
                    };
                });
            } else if (aggType === 'weekly') {
                // Weekly aggregation
                const weeks = eachWeekOfInterval(
                    { start: effectiveStart, end: effectiveEnd },
                    { weekStartsOn: 1 } // Monday start (Indian business week)
                );

                aggregatedData = weeks.map(weekStart => {
                    const weekEnd = endOfWeek(weekStart, { weekStartsOn: 1 });

                    // Find all data points in this week
                    const weekData = dataSorted.filter(d => {
                        const date = parseISO(d.date);
                        return isWithinInterval(date, { start: weekStart, end: weekEnd });
                    });

                    const totalRevenue = weekData.reduce((sum, d) => sum + d.revenue, 0);
                    const totalPartsRevenue = weekData.reduce((sum, d) => sum + d.parts_revenue, 0);
                    const totalLaborRevenue = weekData.reduce((sum, d) => sum + d.labor_revenue, 0);
                    const totalVolume = weekData.reduce((sum, d) => sum + d.volume, 0);

                    return {
                        date: format(weekStart, 'yyyy-MM-dd'),
                        revenue: totalRevenue,
                        parts_revenue: totalPartsRevenue,
                        labor_revenue: totalLaborRevenue,
                        volume: totalVolume,
                        period_label: `Week of ${format(weekStart, 'MMM dd')}`,
                        period_start: format(weekStart, 'MMM dd'),
                        period_end: format(weekEnd, 'MMM dd'),
                    };
                });
            } else {
                // Monthly aggregation
                const months = eachMonthOfInterval({ start: effectiveStart, end: effectiveEnd });

                aggregatedData = months.map(monthStart => {
                    const monthEnd = endOfMonth(monthStart);

                    // Find all data points in this month
                    const monthData = dataSorted.filter(d => {
                        const date = parseISO(d.date);
                        return isWithinInterval(date, { start: monthStart, end: monthEnd });
                    });

                    const totalRevenue = monthData.reduce((sum, d) => sum + d.revenue, 0);
                    const totalPartsRevenue = monthData.reduce((sum, d) => sum + d.parts_revenue, 0);
                    const totalLaborRevenue = monthData.reduce((sum, d) => sum + d.labor_revenue, 0);
                    const totalVolume = monthData.reduce((sum, d) => sum + d.volume, 0);

                    return {
                        date: format(monthStart, 'yyyy-MM-dd'),
                        revenue: totalRevenue,
                        parts_revenue: totalPartsRevenue,
                        labor_revenue: totalLaborRevenue,
                        volume: totalVolume,
                        period_label: format(monthStart, 'MMMM yyyy'),
                        period_start: format(monthStart, 'MMM dd'),
                        period_end: format(monthEnd, 'MMM dd'),
                    };
                });
            }

            return { processedData: aggregatedData, aggregationType: aggType };

        } catch (e) {
            console.error("Error processing chart data:", e);
            return { processedData: data || [], aggregationType: 'daily' as AggregationType };
        }
    }, [data, startDate, endDate]);

    // Dynamic Bar Gap Logic based on data points
    const getBarCategoryGap = () => {
        if (!processedData || processedData.length === 0) return '20%';
        if (processedData.length <= 7) return '25%';   // Fat bars
        if (processedData.length <= 15) return '20%';  // Medium-fat bars
        if (processedData.length <= 30) return '15%';  // Medium bars
        if (processedData.length <= 50) return '8%';   // Thin bars
        return '3%';                                    // Very thin bars (dense data)
    };

    // Smart X-Axis Interval Logic
    const getXAxisInterval = () => {
        if (!processedData) return 0;
        const count = processedData.length;

        if (count <= 15) return 0;        // Show all labels
        if (count <= 30) return 1;        // Show every 2nd label
        if (count <= 60) return 2;        // Show every 3rd label
        return Math.floor(count / 20);    // Show ~20 labels max
    };

    // Custom Tooltip with aggregation awareness
    const CustomSalesTrendTooltip = ({ active, payload, label }: any) => {
        if (!active || !payload || payload.length === 0) return null;

        const dataPoint = payload[0]?.payload;
        const sparesRevenue = payload.find((p: any) => p.dataKey === 'parts_revenue')?.value || 0;
        const serviceRevenue = payload.find((p: any) => p.dataKey === 'labor_revenue')?.value || 0;
        const totalRevenue = sparesRevenue + serviceRevenue;
        const invoiceCount = dataPoint?.volume || 0;

        // Format title based on aggregation type
        let title: string;
        if (aggregationType === 'weekly' && dataPoint?.period_label) {
            title = dataPoint.period_label;
        } else if (aggregationType === 'monthly' && dataPoint?.period_label) {
            title = dataPoint.period_label;
        } else {
            title = format(new Date(label), 'EEE, MMM dd, yyyy');
        }

        return (
            <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200">
                <p className="font-semibold text-gray-900 mb-2">{title}</p>
                {dataPoint?.period_start && dataPoint?.period_end && aggregationType !== 'daily' && (
                    <p className="text-xs text-gray-500 mb-2">
                        {dataPoint.period_start} - {dataPoint.period_end}
                    </p>
                )}
                <p className="font-bold text-lg text-indigo-600">
                    {formatChartCurrency(totalRevenue)}
                </p>
                <p className="text-sm text-gray-600 mt-1">
                    Spares: {formatChartCurrency(sparesRevenue)}
                </p>
                <p className="text-sm text-gray-600">
                    Service: {formatChartCurrency(serviceRevenue)}
                </p>
                <p className="text-sm text-gray-700 mt-2 font-medium">
                    📝 {invoiceCount} Invoice{invoiceCount !== 1 ? 's' : ''}
                </p>
            </div>
        );
    };

    // Format X-axis labels based on aggregation
    const formatXAxisLabel = (value: string) => {
        const date = new Date(value);
        if (aggregationType === 'monthly') {
            return format(date, 'MMM yy');
        } else if (aggregationType === 'weekly') {
            return format(date, 'dd MMM');
        } else {
            return format(date, 'dd MMM');
        }
    };

    // Get aggregation type label for subtitle
    const getAggregationLabel = () => {
        if (aggregationType === 'weekly') return ' • Weekly View';
        if (aggregationType === 'monthly') return ' • Monthly View';
        return '';
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 min-h-[500px] flex flex-col justify-center">
            {/* Dynamic Header */}
            <div className="mb-4 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-gray-900">
                        Revenue Overview
                        <span className="text-sm text-gray-500 font-normal ml-2">
                            ({dateRangeLabel}{getAggregationLabel()})
                        </span>
                    </h3>
                    {filterControls && (
                        <div className="flex items-center">
                            {filterControls}
                        </div>
                    )}
                </div>

                {/* Expandable Filter Panel */}
                {filterPanel && (
                    <div className="w-full border-t border-gray-100 pt-4 animate-in slide-in-from-top-2 duration-200">
                        {filterPanel}
                    </div>
                )}
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center flex-1 h-full">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
                </div>
            ) : !processedData || processedData.length === 0 ? (
                <div className="flex items-center justify-center flex-1 h-full">
                    <div className="text-center">
                        <p className="text-gray-500 text-lg">No sales data available</p>
                        <p className="text-gray-400 text-sm mt-1">Upload sales invoices to see revenue trends</p>
                    </div>
                </div>
            ) : (
                <div className="flex-1 w-full min-h-0">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                            data={processedData}
                            barCategoryGap={getBarCategoryGap()}
                            maxBarSize={60}
                        >
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                            <XAxis
                                dataKey="date"
                                tick={{ fontSize: 12, fill: '#6B7280' }}
                                tickFormatter={formatXAxisLabel}
                                padding={{ left: 20, right: 20 }}
                                axisLine={false}
                                tickLine={false}
                                interval={getXAxisInterval()}
                            />
                            <YAxis
                                tick={{ fontSize: 12, fill: '#6B7280' }}
                                tickFormatter={(value) => formatYAxisValue(value)}
                                axisLine={false}
                                tickLine={false}
                            />
                            <Tooltip content={<CustomSalesTrendTooltip />} cursor={{ fill: '#F3F4F6' }} />
                            <Legend
                                wrapperStyle={{ paddingTop: '10px' }}
                                iconType="rect"
                            />
                            <Bar
                                dataKey="parts_revenue"
                                stackId="a"
                                fill={chartColors.part}
                                name="Spares"
                            />
                            <Bar
                                dataKey="labor_revenue"
                                stackId="a"
                                fill={chartColors.labour}
                                name="Service"
                                radius={[4, 4, 0, 0]}
                            />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
};

export default SalesTrendChart;

