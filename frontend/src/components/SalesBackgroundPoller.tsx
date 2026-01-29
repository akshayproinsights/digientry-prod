import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useGlobalStatus } from '../contexts/GlobalStatusContext';
import { uploadAPI as salesAPI, reviewAPI } from '../services/api';

const SalesBackgroundPoller: React.FC = () => {
    const location = useLocation();
    const { setSalesStatus } = useGlobalStatus();
    const pollIntervalRef = useRef<any>(null);
    const statsIntervalRef = useRef<any>(null);

    // Defined at component level to be reusable
    const fetchGlobalStats = async () => {
        // PREVENT FLUCTUATION:
        // If an upload is in progress, we paused stats updates to keep the number stable.
        // The number should only update once the COMPLETION event is processed.
        if (localStorage.getItem('activeSalesTaskId')) {
            return;
        }

        try {
            // Fetch both dates and amounts data to ensure accurate counts matching Review Page
            const [datesData, amountsData] = await Promise.all([
                reviewAPI.getDates(),
                reviewAPI.getAmounts()
            ]);

            const allRecords = [...(datesData.records || []), ...(amountsData.records || [])];

            // Count unique receipt numbers by status
            const allReceiptNumbers = new Set<string>();
            allRecords.forEach(r => {
                if (r['Receipt Number']) allReceiptNumbers.add(r['Receipt Number']);
            });

            let pending = 0;
            let completed = 0;
            let duplicates = 0;

            allReceiptNumbers.forEach(receiptNum => {
                const receiptRecords = allRecords.filter(r => r['Receipt Number'] === receiptNum);

                // Normalize status
                const getStatus = (r: any) => (r['Verification Status'] || 'Pending').toLowerCase();

                const allDone = receiptRecords.every(r => getStatus(r) === 'done');
                const hasPending = receiptRecords.some(r => getStatus(r) === 'pending');
                const hasDuplicate = receiptRecords.some(r => getStatus(r) === 'duplicate receipt number');

                if (hasDuplicate) {
                    duplicates++;
                } else if (allDone) {
                    completed++;
                } else if (hasPending) {
                    pending++;
                }
            });

            setSalesStatus({
                reviewCount: pending + duplicates,
                syncCount: completed
            });
        } catch (error) {
            console.error('Error fetching global sales stats:', error);
        }
    };

    // 1. Poll for global stats (Review Count) independent of upload tasks
    useEffect(() => {
        // Fetch immediately on mount
        fetchGlobalStats();

        // Poll every 10 seconds to keep sidebar accurate
        statsIntervalRef.current = setInterval(fetchGlobalStats, 10000);

        return () => {
            if (statsIntervalRef.current) {
                clearInterval(statsIntervalRef.current);
                statsIntervalRef.current = null;
            }
        };
    }, [setSalesStatus]);

    // 2. Poll for active upload processing tasks
    useEffect(() => {
        // Don't poll task status if we are ON the upload page (the page handles its own polling)
        if (location.pathname === '/sales/upload') {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
            }
            return;
        }

        const checkStatus = async () => {
            const activeTaskId = localStorage.getItem('activeSalesTaskId');

            if (!activeTaskId) {
                if (pollIntervalRef.current) {
                    clearInterval(pollIntervalRef.current);
                    pollIntervalRef.current = null;
                }
                return;
            }

            try {
                const statusData = await salesAPI.getProcessStatus(activeTaskId);

                // Update global status
                const total = statusData.progress?.total || 0;
                const processed = statusData.progress?.processed || 0;
                const remaining = Math.max(0, total - processed);

                // Check for completion
                if (statusData.status === 'completed') {
                    // Task completed!

                    // Clear task ID FIRST so that fetchGlobalStats is allowed to run
                    localStorage.removeItem('activeSalesTaskId');

                    setSalesStatus({
                        isUploading: false,
                        processingCount: 0,
                        totalProcessing: 0,
                        isComplete: true // Show green tick
                    });

                    if (pollIntervalRef.current) {
                        clearInterval(pollIntervalRef.current);
                        pollIntervalRef.current = null;
                    }

                    // Immediately refresh stats to show new numbers now that processing is done
                    await fetchGlobalStats();

                } else if (statusData.status === 'failed') {
                    // Failed
                    setSalesStatus({
                        isUploading: false,
                        processingCount: 0,
                        totalProcessing: 0,
                        reviewCount: 0,
                        syncCount: 0,
                        isComplete: false
                    });

                    localStorage.removeItem('activeSalesTaskId');

                    if (pollIntervalRef.current) {
                        clearInterval(pollIntervalRef.current);
                        pollIntervalRef.current = null;
                    }
                } else if (statusData.status === 'duplicate_detected') {
                    // Duplicates detected - update status but keep task ID
                    // The user needs to go to the upload page to resolve this
                    setSalesStatus({
                        isUploading: false,
                        processingCount: 0,
                        isComplete: false
                    });
                } else {
                    // Still processing
                    setSalesStatus({
                        isUploading: false,
                        processingCount: remaining,
                        totalProcessing: total,
                        syncCount: processed,
                        isComplete: false
                    });
                }
            } catch (error: any) {
                console.error('Error polling background sales status:', error);
                if (error?.response?.status === 404 || error?.response?.status === 403) {
                    // Task gone
                    localStorage.removeItem('activeSalesTaskId');
                    if (pollIntervalRef.current) {
                        clearInterval(pollIntervalRef.current);
                        pollIntervalRef.current = null;
                    }
                }
            }
        };

        // Start polling if task ID exists
        const activeTaskId = localStorage.getItem('activeSalesTaskId');
        if (activeTaskId && !pollIntervalRef.current) {
            checkStatus(); // Check immediately
            pollIntervalRef.current = setInterval(checkStatus, 2000); // Poll every 2s
        }

        return () => {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
            }
        };
    }, [location.pathname, setSalesStatus]);

    return null; // This component doesn't render anything
};

export default SalesBackgroundPoller;
