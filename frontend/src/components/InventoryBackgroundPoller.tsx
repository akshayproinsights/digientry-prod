
import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useGlobalStatus } from '../contexts/GlobalStatusContext';
import { inventoryAPI } from '../services/inventoryApi';

const InventoryBackgroundPoller: React.FC = () => {
    const location = useLocation();
    const { setInventoryStatus } = useGlobalStatus();
    const pollIntervalRef = useRef<any>(null);

    // Poll for active upload processing tasks
    useEffect(() => {
        // Don't poll task status if we are ON the upload page (the page handles its own polling)
        if (location.pathname === '/inventory/upload') {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
            }
            return;
        }

        const checkStatus = async () => {
            const activeTaskId = localStorage.getItem('activeInventoryTaskId');

            if (!activeTaskId) {
                if (pollIntervalRef.current) {
                    clearInterval(pollIntervalRef.current);
                    pollIntervalRef.current = null;
                }
                return;
            }

            try {
                const statusData = await inventoryAPI.getProcessStatus(activeTaskId);

                // Update global status
                const total = statusData.progress?.total || 0;
                const processed = statusData.progress?.processed || 0;
                const remaining = Math.max(0, total - processed);

                // Check for completion
                if (statusData.status === 'completed') {
                    // Task completed!
                    setInventoryStatus({
                        isUploading: false,
                        processingCount: 0,
                        totalProcessing: 0,
                        syncCount: processed,
                        isComplete: true // Show green tick
                    });

                    // Clear task ID so we stop polling
                    localStorage.removeItem('activeInventoryTaskId');

                    if (pollIntervalRef.current) {
                        clearInterval(pollIntervalRef.current);
                        pollIntervalRef.current = null;
                    }
                } else if (statusData.status === 'failed') {
                    // Failed
                    setInventoryStatus({
                        isUploading: false,
                        processingCount: 0,
                        totalProcessing: 0,
                        reviewCount: 0,
                        syncCount: 0,
                        isComplete: false
                    });

                    localStorage.removeItem('activeInventoryTaskId');

                    if (pollIntervalRef.current) {
                        clearInterval(pollIntervalRef.current);
                        pollIntervalRef.current = null;
                    }
                } else if (statusData.status === 'duplicate_detected') {
                    // Duplicates detected - update status but keep task ID
                    // The user needs to go to the upload page to resolve this
                    setInventoryStatus({
                        isUploading: false,
                        processingCount: 0,
                        // reviewCount for duplicates is tricky without fetching items
                        // For now we just direct user to invalid/duplicate state
                        isComplete: false
                    });
                } else {
                    // Still processing
                    setInventoryStatus({
                        isUploading: false,
                        processingCount: remaining,
                        totalProcessing: total,
                        syncCount: processed,
                        isComplete: false
                    });
                }
            } catch (error: any) {
                console.error('Error polling background inventory status:', error);
                if (error?.response?.status === 404 || error?.response?.status === 403) {
                    // Task gone
                    localStorage.removeItem('activeInventoryTaskId');
                    if (pollIntervalRef.current) {
                        clearInterval(pollIntervalRef.current);
                        pollIntervalRef.current = null;
                    }
                }
            }
        };

        // Start polling if task ID exists
        const activeTaskId = localStorage.getItem('activeInventoryTaskId');
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
    }, [location.pathname, setInventoryStatus]);

    return null; // This component doesn't render anything
};

export default InventoryBackgroundPoller;
