import React, { useState, useCallback, useEffect } from 'react';
import { Upload as UploadIcon, X, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { uploadAPI as salesAPI } from '../services/api';
import { useQueryClient } from '@tanstack/react-query';
import DuplicateWarningModal from '../components/DuplicateWarningModal';
import ImagePreviewModal from '../components/ImagePreviewModal';
import { useGlobalStatus } from '../contexts/GlobalStatusContext';

const UploadPage: React.FC = () => {
    const navigate = useNavigate();
    const [files, setFiles] = useState<File[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingStatus, setProcessingStatus] = useState<any>(null);
    const [, setPollingInterval] = useState<number | null>(null);
    const intervalRef = React.useRef<number | null>(null); // Ref to track interval for cleanup
    const duplicateStatsRef = React.useRef<{ totalUploaded: number; replaced: number; skipped: number; newFiles: number } | null>(null);

    // Upload tracking for bulk uploads
    const [uploadedCount, setUploadedCount] = useState(0);
    const [totalToUpload, setTotalToUpload] = useState(0);
    const [uploadStartTime, setUploadStartTime] = useState<number | null>(null);
    const [estimatedTimeRemaining, setEstimatedTimeRemaining] = useState<number | null>(null);

    // Duplicate handling - sequential workflow
    const [duplicateQueue, setDuplicateQueue] = useState<any[]>([]);
    const [currentDuplicateIndex, setCurrentDuplicateIndex] = useState(0);
    const [showDuplicateModal, setShowDuplicateModal] = useState(false);
    const [duplicateInfo, setDuplicateInfo] = useState<any>(null);
    const [, setDuplicateStats] = useState<{ totalUploaded: number; replaced: number; skipped: number; newFiles: number }>({ totalUploaded: 0, replaced: 0, skipped: 0, newFiles: 0 });
    const [filesToSkip, setFilesToSkip] = useState<string[]>([]);
    const [filesToForceUpload, setFilesToForceUpload] = useState<string[]>([]);
    const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
    const queryClient = useQueryClient();
    const { setSalesStatus } = useGlobalStatus(); // NEW

    // Image preview modal state
    const [previewModalOpen, setPreviewModalOpen] = useState(false);
    const [previewIndex, setPreviewIndex] = useState(0);

    // Resume monitoring on page load if there's an active task
    useEffect(() => {
        console.log('🔍 [UPLOAD-PAGE] useEffect triggered - checking for active tasks...');

        // Clear completion badge if visiting this page
        setSalesStatus({ isComplete: false });

        let interval: any = null;

        const checkStatus = () => {
            console.log('🔍 [UPLOAD-PAGE] checkStatus called');

            // First check if there's a saved completion status
            const savedCompletion = localStorage.getItem('salesCompletionStatus');
            console.log('🔍 [UPLOAD-PAGE] savedCompletion:', savedCompletion ? 'EXISTS' : 'NULL');

            if (savedCompletion) { // REMOVED CLOSURE BUG: !isProcessing && !isUploading
                try {
                    const completionData = JSON.parse(savedCompletion);
                    if (JSON.stringify(processingStatus) !== JSON.stringify(completionData)) {
                        console.log('🔄 [DEBUG] Found completion status in background, loading...');
                        setProcessingStatus(completionData);
                        // Restore ref from saved stats
                        if (completionData.duplicateStats) {
                            duplicateStatsRef.current = completionData.duplicateStats;
                        }
                    }
                    setIsProcessing(false);
                    setIsUploading(false);
                    setFiles([]);

                    const processed = completionData.progress?.processed || 0;
                    setSalesStatus({
                        isUploading: false,
                        processingCount: 0,
                        reviewCount: 0,
                        syncCount: processed,
                        isComplete: true
                    });

                    // Stop polling if we found completion
                    if (interval) clearInterval(interval);
                    return true; // Signal handled
                } catch (e) {
                    console.error('❌ [UPLOAD-PAGE] Error parsing sales completion:', e);
                    localStorage.removeItem('salesCompletionStatus');
                }
            }

            const activeTaskId = localStorage.getItem('activeSalesTaskId');
            console.log('🔍 [UPLOAD-PAGE] activeTaskId:', activeTaskId || 'NULL');
            console.log('🔍 [UPLOAD-PAGE] intervalRef.current:', intervalRef.current ? 'ACTIVE' : 'NULL');

            if (activeTaskId && !intervalRef.current) { // REMOVED CLOSURE BUG: !isProcessing
                console.log('🚀 [UPLOAD-PAGE] Found active task, resuming polling:', activeTaskId);

                // CRITICAL: Set processing state IMMEDIATELY/RESUME
                setIsProcessing(true);
                setIsUploading(false);
                setSalesStatus({ isUploading: false, processingCount: 1, totalProcessing: 1, reviewCount: 0, syncCount: 0, isComplete: false });

                startPolling(activeTaskId);
                return true;
            }

            console.log('⏸️ [UPLOAD-PAGE] No active task or completion found');
            return false;
        };

        const startPolling = (taskId: string) => {
            // Start continuous polling
            interval = setInterval(async () => {
                try {
                    const statusData = await salesAPI.getProcessStatus(taskId);

                    // UPDATE GLOBAL STATUS
                    const total = statusData.progress?.total || 0;
                    const processed = statusData.progress?.processed || 0;
                    const remaining = Math.max(0, total - processed);

                    setSalesStatus({
                        isUploading: false,
                        processingCount: remaining,
                        totalProcessing: total,
                        reviewCount: 0,
                        syncCount: 0
                    });

                    // Preserve duplicateStats across updates
                    setProcessingStatus((prev: any) => ({
                        ...statusData,
                        duplicateStats: prev?.duplicateStats
                    }));

                    // Handle duplicate detection on resume
                    if (statusData.status === 'duplicate_detected' && (statusData as any).duplicates?.length > 0) {
                        clearInterval(interval);
                        intervalRef.current = null;
                        setPollingInterval(null);
                        setIsProcessing(false);

                        const duplicates = (statusData as any).duplicates;
                        setDuplicateQueue(duplicates);
                        setCurrentDuplicateIndex(0);
                        setDuplicateInfo(duplicates[0]);
                        setShowDuplicateModal(true);
                        setFilesToSkip([]);
                        setFilesToForceUpload([]);

                        setSalesStatus({
                            isUploading: false,
                            processingCount: 0,
                            reviewCount: duplicates.length,
                            syncCount: processed
                        });

                        const allFileKeys = (statusData as any).uploaded_r2_keys || duplicates.map((dup: any) => dup.file_key);
                        setUploadedFiles(allFileKeys);
                        (window as any).__temp_r2_keys = allFileKeys;

                        localStorage.removeItem('activeSalesTaskId');
                        return;
                    }

                    // Handle completion
                    if (statusData.status === 'completed' || statusData.status === 'failed') {
                        clearInterval(interval);
                        intervalRef.current = null;
                        setPollingInterval(null);
                        localStorage.removeItem('activeSalesTaskId');
                        localStorage.setItem('salesCompletionStatus', JSON.stringify(statusData));

                        setSalesStatus({
                            isUploading: false,
                            processingCount: 0,
                            reviewCount: 0,
                            syncCount: processed
                        });

                    }
                } catch (error: any) {
                    console.error('Error polling status:', error);
                    if (error?.response?.status === 403 || error?.response?.status === 404) {
                        clearInterval(interval);
                        intervalRef.current = null;
                        setPollingInterval(null);
                        localStorage.removeItem('activeSalesTaskId');
                        setIsProcessing(false);
                        setProcessingStatus(null);
                        setSalesStatus({ processingCount: 0, reviewCount: 0, syncCount: 0 });
                    }
                }
            }, 1000);

            intervalRef.current = interval;
            setPollingInterval(interval);
        };

        // Initial check
        console.log('🎬 [UPLOAD-PAGE] Running initial checkStatus...');
        if (!checkStatus()) {
            // If initially idle, set up an idle poller to watch for background updates
            console.log('⏰ [UPLOAD-PAGE] Setting up idle watcher (2s interval)');
            const idleWatcher = setInterval(() => {
                console.log('⏰ [UPLOAD-PAGE] Idle watcher tick...');
                checkStatus();
            }, 2000); // Check every 2 seconds

            return () => {
                console.log('🧹 [UPLOAD-PAGE] Cleanup - stopping idle watcher');
                clearInterval(idleWatcher);
                if (intervalRef.current) {
                    clearInterval(intervalRef.current);
                    intervalRef.current = null;
                }
                setSalesStatus({ isComplete: false });
            };
        }

        // Cleanup on unmount - IMPORTANT: Don't clear session, just stop polling
        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
            // Clear completion badge when leaving the page
            setSalesStatus({ isComplete: false });
        };
    }, []);

    // Browser warning when trying to close/refresh during upload
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (isUploading) {
                e.preventDefault();
                e.returnValue = 'Files are uploading. navigating away will cancel the upload.';
                return 'Files are uploading. navigating away will cancel the upload.';
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [isUploading]);

    // Helper function to format time remaining
    const formatTimeRemaining = (seconds: number): string => {
        if (seconds < 60) {
            return `${Math.round(seconds)}s`;
        }
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.round(seconds % 60);
        return `${minutes}m ${remainingSeconds}s`;
    };

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        const droppedFiles = Array.from(e.dataTransfer.files).filter((file) =>
            file.type.startsWith('image/')
        );

        // Filter out duplicates (same name + size)
        const uniqueFiles = droppedFiles.filter(newFile => {
            return !files.some(existing =>
                existing.name === newFile.name &&
                existing.size === newFile.size
            );
        });

        const duplicateCount = droppedFiles.length - uniqueFiles.length;
        if (duplicateCount > 0) {
            alert(`${duplicateCount} duplicate file(s) removed. Only unique files were added.`);
        }

        setFiles((prev) => [...prev, ...uniqueFiles]);
    }, [files]);

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const selectedFiles = Array.from(e.target.files);

            // Filter out duplicates (same name + size)
            const uniqueFiles = selectedFiles.filter(newFile => {
                return !files.some(existing =>
                    existing.name === newFile.name &&
                    existing.size === newFile.size
                );
            });

            const duplicateCount = selectedFiles.length - uniqueFiles.length;
            if (duplicateCount > 0) {
                alert(`${duplicateCount} duplicate file(s) removed. Only unique files were added.`);
            }

            // Reset processing state when selecting new files (e.g., after previous completion)
            if (processingStatus?.status === 'completed' || processingStatus?.status === 'failed') {
                setIsProcessing(false);
                setProcessingStatus(null);
                localStorage.removeItem('salesCompletionStatus'); // Clear saved completion
                setSalesStatus({ processingCount: 0, reviewCount: 0, syncCount: 0 }); // Clear global status
            }

            setFiles((prev) => [...prev, ...uniqueFiles]);
        }
    };

    const removeFile = (index: number) => {
        setFiles((prev) => prev.filter((_, i) => i !== index));
    };

    // Preview modal handlers
    const handleOpenPreview = (index: number) => {
        setPreviewIndex(index);
        setPreviewModalOpen(true);
    };

    const handleClosePreview = () => {
        setPreviewModalOpen(false);
    };

    const handleDeleteFromPreview = (index: number) => {
        setFiles((prev) => prev.filter((_, i) => i !== index));

        // Adjust preview index after deletion
        if (files.length === 1) {
            // Last file deleted - close modal
            setPreviewModalOpen(false);
        } else if (index === files.length - 1) {
            // Deleted last file - show previous
            setPreviewIndex(Math.max(0, index - 1));
        }
        // If deleting middle file, current index now points to next file automatically
    };

    const handleNavigatePreview = (newIndex: number) => {
        setPreviewIndex(newIndex);
    };

    const handleUploadAndProcess = async (forceUpload: boolean = false) => {
        if (files.length === 0) return;

        try {
            console.log('🚀 [DEBUG] Upload & Process STARTED');
            console.log(`📁 [DEBUG] Total files to upload: ${files.length}`);

            // CRITICAL: Clear any old completion status from previous uploads
            localStorage.removeItem('salesCompletionStatus');
            setProcessingStatus(null);

            setIsUploading(true);
            setSalesStatus({
                isUploading: true,
                processingCount: files.length,
                totalProcessing: files.length,
                reviewCount: 0,
                syncCount: 0,
                isComplete: false  // Ensure completion badge is cleared
            });

            setUploadProgress(0);

            // Initialize upload tracking
            const totalFiles = files.length;
            setTotalToUpload(totalFiles);
            setUploadedCount(0);
            setUploadStartTime(Date.now());
            setEstimatedTimeRemaining(null);
            setEstimatedTimeRemaining(null);
            const initialStats = { totalUploaded: totalFiles, replaced: 0, skipped: 0, newFiles: 0 };
            setDuplicateStats(initialStats);
            duplicateStatsRef.current = initialStats;

            let fileKeys: string[] = [];
            const BATCH_SIZE = 5;
            let processedCount = 0;

            for (let i = 0; i < totalFiles; i += BATCH_SIZE) {
                const batch = files.slice(i, i + BATCH_SIZE);

                console.log(`📤 [DEBUG] Uploading batch ${Math.floor(i / BATCH_SIZE) + 1}, size: ${batch.length}`);
                const response = await salesAPI.uploadFiles(batch, (progressEvent) => {
                    const batchPercent = progressEvent.loaded / progressEvent.total;
                    const validBatchSize = batch.length;
                    const currentBatchProgress = batchPercent * validBatchSize;
                    const totalProgress = Math.round(((processedCount + currentBatchProgress) / totalFiles) * 100);
                    setUploadProgress(totalProgress);
                });
                console.log(`✅ [DEBUG] Batch upload response:`, response);

                if (response.uploaded_files) {
                    fileKeys = [...fileKeys, ...response.uploaded_files];
                    console.log(`📦 [DEBUG] Accumulated ${fileKeys.length} file keys so far`);
                }

                processedCount += batch.length;
                setUploadedCount(processedCount);

                // Calculate estimated time remaining
                const elapsedTime = (Date.now() - (uploadStartTime || Date.now())) / 1000; // seconds
                const avgTimePerFile = elapsedTime / processedCount;
                const remainingFiles = totalFiles - processedCount;
                const estimatedSeconds = avgTimePerFile * remainingFiles;
                setEstimatedTimeRemaining(estimatedSeconds);

                // Force progress update to completion for this batch
                setUploadProgress(Math.round((processedCount / totalFiles) * 100));
            }

            setUploadedFiles(fileKeys);
            setIsUploading(false);
            setUploadProgress(0);
            setEstimatedTimeRemaining(null);

            console.log(`✅ [DEBUG] All files uploaded successfully!`);
            console.log(`📋 [DEBUG] Total R2 keys: ${fileKeys.length}`, fileKeys);

            // Start processing with forceUpload parameter
            setIsProcessing(true);
            setSalesStatus({ isUploading: false, processingCount: fileKeys.length, totalProcessing: fileKeys.length, reviewCount: 0, syncCount: 0 });

            console.log(`🔄 [DEBUG] Starting processing...`);
            console.log(`🔄 [DEBUG] File keys:`, fileKeys);
            console.log(`🔄 [DEBUG] Force upload:`, forceUpload);
            const processResponse = await salesAPI.processInvoices(fileKeys, forceUpload);
            console.log(`✅ [DEBUG] Process API response:`, processResponse);
            setProcessingStatus(processResponse);

            // Save taskId to localStorage for persistence
            const taskId = processResponse.task_id;
            console.log(`💾 [DEBUG] Task ID saved: ${taskId}`);
            localStorage.setItem('activeSalesTaskId', taskId);
            const pollInterval = setInterval(async () => {
                const status = await salesAPI.getProcessStatus(taskId);
                setProcessingStatus(status);

                const processed = status.progress?.processed || 0;
                const total = status.progress?.total || 0;
                const remaining = Math.max(0, total - processed);
                setSalesStatus({ processingCount: remaining, totalProcessing: total, reviewCount: 0, syncCount: 0 });


                // Handle duplicate detection - START SEQUENTIAL WORKFLOW
                if (status.status === 'duplicate_detected' && (status as any).duplicates?.length > 0) {
                    clearInterval(pollInterval);
                    intervalRef.current = null;
                    setPollingInterval(null);
                    setIsProcessing(false);

                    // Initialize duplicate queue
                    const duplicates = (status as any).duplicates;


                    setDuplicateQueue(duplicates);
                    setCurrentDuplicateIndex(0);

                    setSalesStatus({
                        processingCount: 0,
                        reviewCount: duplicates.length,
                        syncCount: processed
                    });

                    const newFilesProcessed = status.progress?.processed || 0;
                    setDuplicateStats(prev => ({ ...prev, newFiles: newFilesProcessed }));
                    duplicateStatsRef.current = { ...(duplicateStatsRef.current || { totalUploaded: 0, replaced: 0, skipped: 0, newFiles: 0 }), newFiles: newFilesProcessed };


                    // Set first duplicate info - check if it has existing_invoice
                    const firstDup = duplicates[0];
                    setDuplicateInfo(firstDup);
                    setShowDuplicateModal(true);
                    setFilesToSkip([]);
                    setFilesToForceUpload([]);

                    // CRITICAL FIX: Update uploadedFiles with R2 keys from the processing status
                    // Before this point, uploadedFiles contains temp paths
                    // Now we need to extract the actual R2 keys that were uploaded
                    // The duplicates contain R2 file_keys
                    // Since backend detected duplicates AFTER uploading ALL files to R2,
                    // we need to get all R2 keys (duplicates are subset)
                    // The backend should return all uploaded R2 keys in the status
                    // For now, set uploadedFiles to the fileKeys that were sent for processing
                    // These are R2 keys from the initial upload phase
                    setUploadedFiles((status as any).uploaded_r2_keys || []); // Backend returns ALL R2 keys
                    // Store in window for passing through call chain (avoids React state timing)
                    (window as any).__temp_r2_keys = (status as any).uploaded_r2_keys || [];

                    setUploadedFiles((status as any).uploaded_r2_keys || []); // Backend returns ALL R2 keys
                    // Store in window for passing through call chain (avoids React state timing)
                    (window as any).__temp_r2_keys = (status as any).uploaded_r2_keys || [];

                    return;
                }

                // Handle completion or failure
                if (status.status === 'completed' || status.status === 'failed') {
                    clearInterval(pollInterval);
                    intervalRef.current = null;
                    setPollingInterval(null);

                    if (status.status === 'completed') {
                        // Call finishProcessing to properly set completion state
                        // This keeps files visible and shows Review Sales button
                        finishProcessing(status);
                    } else {
                        setIsProcessing(false);
                        setSalesStatus({ processingCount: 0, reviewCount: 0, syncCount: 0 });
                    }
                }
            }, 1000); // Poll every 1 second for responsive updates

            intervalRef.current = pollInterval;
            setPollingInterval(pollInterval);
        } catch (error) {
            console.error('❌ [DEBUG] Upload/Process ERROR:', error);
            console.error('❌ [DEBUG] Error details:', {
                message: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                response: (error as any)?.response?.data
            });
            setIsUploading(false);
            setIsProcessing(false);
            setSalesStatus({ isUploading: false, processingCount: 0, reviewCount: 0, syncCount: 0 });
        }
    };

    // Sequential duplicate handling
    const handleSkipDuplicate = () => {
        const currentDup = duplicateQueue[currentDuplicateIndex];
        const updatedSkip = [...filesToSkip, currentDup.file_key];
        setFilesToSkip(updatedSkip);
        setSalesStatus({ reviewCount: Math.max(0, duplicateQueue.length - (currentDuplicateIndex + 1)) });
        setSalesStatus({ reviewCount: Math.max(0, duplicateQueue.length - (currentDuplicateIndex + 1)) });
        setDuplicateStats(prev => {
            const next = { ...prev, skipped: prev.skipped + 1 };
            duplicateStatsRef.current = next;
            return next;
        });
        moveToNextDuplicate(updatedSkip, filesToForceUpload, (window as any).__temp_r2_keys || []);
    };

    const handleUploadAnyway = () => {
        const currentDup = duplicateQueue[currentDuplicateIndex];
        const updatedForceUpload = [...filesToForceUpload, currentDup.file_key];
        setFilesToForceUpload(updatedForceUpload);
        setSalesStatus({ reviewCount: Math.max(0, duplicateQueue.length - (currentDuplicateIndex + 1)) });
        setSalesStatus({ reviewCount: Math.max(0, duplicateQueue.length - (currentDuplicateIndex + 1)) });
        setDuplicateStats(prev => {
            const next = { ...prev, replaced: prev.replaced + 1 };
            duplicateStatsRef.current = next;
            return next;
        });
        moveToNextDuplicate(filesToSkip, updatedForceUpload, (window as any).__temp_r2_keys || []);
    };



    const moveToNextDuplicate = (skipList: string[] = filesToSkip, forceUploadList: string[] = filesToForceUpload, allR2Keys: string[] = uploadedFiles) => {
        const nextIndex = currentDuplicateIndex + 1;

        if (nextIndex < duplicateQueue.length) {
            // Show next duplicate
            setCurrentDuplicateIndex(nextIndex);
            setDuplicateInfo(duplicateQueue[nextIndex]);
            // Modal stays open
        } else {
            // All duplicates handled - close modal and process remaining files
            setShowDuplicateModal(false);
            setDuplicateQueue([]);
            setDuplicateInfo(null);
            // Pass the arrays AND R2 keys directly to avoid React state timing issues
            processRemainingFiles(skipList, forceUploadList, allR2Keys);
        }
    };

    const processRemainingFiles = async (_skipList: string[] = filesToSkip, forceUploadList: string[] = filesToForceUpload, allR2Keys: string[] = uploadedFiles) => {


        try {
            setIsProcessing(true);
            setSalesStatus({ processingCount: allR2Keys.length, totalProcessing: allR2Keys.length, reviewCount: 0, syncCount: 0 });

            // CRITICAL: Filter uploadedFiles to ensure we only have R2 keys, not temp file paths


            // Calculate which files are NOT duplicates and weren't skipped
            // These were uploaded to R2 but processing stopped when duplicates were detected


            // Calculate which files are ACTUALLY new (not duplicates at all)
            // nonDuplicateFiles should exclude BOTH skipped AND replaced duplicates
            const allDuplicateKeys = [..._skipList, ...forceUploadList];
            const nonDuplicateFiles = allR2Keys.filter(key => !allDuplicateKeys.includes(key));


            // Combine both: non-duplicates (normal process) + forced duplicates (replace old)
            const allFilesToProcess = [...nonDuplicateFiles, ...forceUploadList];

            if (allFilesToProcess.length > 0) {


                // Show processing state
                // IMPORTANT: Store counts now to preserve them for summary message
                setProcessingStatus({
                    task_id: '',
                    status: 'processing',
                    progress: { total: allFilesToProcess.length, processed: 0, failed: 0 },
                    message: `Processing ${allFilesToProcess.length} file(s)...`,
                    duplicateStats: {  // Store for later summary - use PARAMETERS not state!
                        skipped: _skipList.length,
                        replaced: forceUploadList.length,
                        newFiles: nonDuplicateFiles.length
                    }
                });
                duplicateStatsRef.current = {
                    totalUploaded: allR2Keys.length,
                    skipped: _skipList.length,
                    replaced: forceUploadList.length,
                    newFiles: nonDuplicateFiles.length
                };

                // Send all files for processing
                // CRITICAL: Force upload MUST be true because files are already in R2
                // (even if we're not force-uploading duplicates, the non-duplicates are in R2)
                const processResponse = await salesAPI.processInvoices(allFilesToProcess, true);

                // IMPORTANT: Save task ID for session persistence
                localStorage.setItem('activeSalesTaskId', processResponse.task_id);


                // Preserve duplicateStats from initial status
                setProcessingStatus((prev: any) => ({
                    ...processResponse,
                    duplicateStats: prev?.duplicateStats  // Keep our stored stats
                }));

                // Poll for completion
                const interval = setInterval(async () => {
                    const status = await salesAPI.getProcessStatus(processResponse.task_id);

                    // UPDATE GLOBAL STATUS to keep sidebar in sync
                    const total = status.progress?.total || 0;
                    const processed = status.progress?.processed || 0;
                    const remaining = Math.max(0, total - processed);

                    setSalesStatus({
                        processingCount: remaining,
                        totalProcessing: total,
                        reviewCount: 0,
                        syncCount: 0
                    });

                    // Preserve duplicateStats across polling updates
                    setProcessingStatus((prev: any) => ({
                        ...status,
                        duplicateStats: prev?.duplicateStats  // Keep our stored stats
                    }));

                    if (status.status === 'completed' || status.status === 'failed') {
                        clearInterval(interval);
                        intervalRef.current = null;
                        setPollingInterval(null);
                        finishProcessing(status);  // Pass latest status directly
                        localStorage.removeItem('activeSalesTaskId');  // Clear session
                    }
                }, 1000);

                // Store interval for cleanup
                intervalRef.current = interval;
                setPollingInterval(interval);
            } else {
                finishProcessing();
            }
        } catch (error) {
            console.error('❌ Error processing remaining files:', error);
            setIsProcessing(false);
        }
    };

    const finishProcessing = (latestStatus?: any) => {
        // Use latest status if provided, otherwise fall back to state
        const statusToUse = latestStatus || processingStatus;

        // IMPORTANT: Process status already has the correct counts from the backend
        // Just mark it as completed without recalculating
        if (statusToUse && statusToUse.progress) {
            // Calculate summary for user clarity
            const totalProcessed = statusToUse.progress.processed || 0;

            // Use stored stats from REF (reliable across closures), otherwise fall back to state
            const statsRef = duplicateStatsRef.current;
            const skippedCount = statsRef?.skipped ?? (statusToUse as any).duplicateStats?.skipped ?? filesToSkip.length;
            const replacedCount = statsRef?.replaced ?? (statusToUse as any).duplicateStats?.replaced ?? filesToForceUpload.length;
            // Use logical OR || instead of ?? to ensure 0 (from initialization) falls back to calculation
            // This fixes "New Files: 0" on happy path where statsRef.newFiles is 0 but never updated
            const newCount = statsRef?.newFiles || (statusToUse as any).duplicateStats?.newFiles || (totalProcessed - replacedCount);

            const completionStats = {
                totalUploaded: statsRef?.totalUploaded || totalProcessed,
                skipped: skippedCount,
                replaced: replacedCount,
                newFiles: newCount
            };

            let summaryMessage = `Successfully processed ${totalProcessed} invoice${totalProcessed !== 1 ? 's' : ''}`;

            // Show breakdown if there were any duplicates (replaced OR skipped)
            if (completionStats.replaced > 0 || completionStats.skipped > 0) {
                const parts = [];
                if (completionStats.newFiles > 0) parts.push(`${completionStats.newFiles} new`);
                if (completionStats.replaced > 0) parts.push(`${completionStats.replaced} replaced`);
                if (completionStats.skipped > 0) parts.push(`${completionStats.skipped} skipped`);
                if (parts.length > 0) {
                    summaryMessage += ` (${parts.join(', ')})`;
                }
            }

            // Backend has valid status - preserve ALL data and just update status + message
            const completionData = {
                ...statusToUse,
                status: 'completed',
                message: summaryMessage,
                duplicateStats: {
                    skipped: skippedCount,
                    replaced: replacedCount,
                    newFiles: newCount
                }
            };

            setProcessingStatus(completionData);

            // Save completion status for when user returns
            localStorage.setItem('salesCompletionStatus', JSON.stringify(completionData));

            // Update global status with completion badge
            setSalesStatus({
                isUploading: false,
                processingCount: 0,
                reviewCount: 0,
                syncCount: totalProcessed,
                isComplete: true
            });
        }

        setIsProcessing(false);
        // DON'T clear files here - keep them visible so user can see completion state
        // setFiles([]);  // Commented out to keep the two-column layout visible
        setUploadedFiles([]);
        setDuplicateQueue([]);
        setFilesToSkip([]);
        setFilesToForceUpload([]);

        // Clear localStorage task
        localStorage.removeItem('activeSalesTaskId');

        queryClient.invalidateQueries({ queryKey: ['invoices'] });
        queryClient.invalidateQueries({ queryKey: ['review'] });
    };

    return (
        <div className="max-w-4xl mx-auto space-y-4">
            {/* Warning Banner During Upload */}
            {isUploading && (
                <div className="fixed top-0 left-0 right-0 bg-yellow-500 text-white px-6 py-4 shadow-lg z-50">
                    <div className="max-w-7xl mx-auto flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <Loader2 className="animate-spin" size={24} />
                            <div>
                                <p className="font-bold">Files Uploading - Do Not Close or Navigate Away</p>
                                <p className="text-sm">Leaving this page will cancel the upload! ({uploadProgress}% done)</p>
                            </div>
                        </div>
                        <div className="w-32 bg-yellow-600 rounded-full h-2">
                            <div
                                className="bg-white h-2 rounded-full transition-all"
                                style={{ width: `${uploadProgress}%` }}
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* Upload Area */}
            <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-10 text-center transition ${isDragging
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-300 bg-white hover:border-gray-400'
                    }`}
            >
                <UploadIcon className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                <p className="text-lg font-medium text-gray-700 mb-2">
                    Drop invoice images here
                </p>
                <p className="text-sm text-gray-500 mb-3">
                    or click to browse (JPG, PNG supported)
                </p>
                <label className="inline-block">
                    <input
                        type="file"
                        multiple
                        accept="image/*"
                        onChange={handleFileInput}
                        className="hidden"
                    />
                    <span className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition cursor-pointer inline-block">
                        Select Files
                    </span>
                </label>
            </div>

            {/* Two-Column Layout: Image Preview (Left) + Processing Status (Right) */}
            {(files.length > 0 || isProcessing || processingStatus) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* LEFT COLUMN: Image Preview & Upload Button - Hide if no files (resume case) */}
                    {files.length > 0 ? (
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                            <h3 className="text-base font-semibold text-gray-900 mb-3">
                                Selected Files ({files.length})
                            </h3>

                            {/* Scrollable Image Grid - Increased height */}
                            <div className="max-h-[280px] overflow-y-auto border border-gray-200 rounded-lg p-3 bg-gray-50 mb-3">
                                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
                                    {files.map((file, index) => (
                                        <div
                                            key={index}
                                            className="relative group aspect-square bg-white border-2 border-gray-200 rounded-lg overflow-hidden hover:border-blue-400 transition-all shadow-sm hover:shadow-md cursor-pointer"
                                            onClick={() => handleOpenPreview(index)}
                                        >
                                            {/* Image Preview */}
                                            <img
                                                src={URL.createObjectURL(file)}
                                                alt={file.name}
                                                className="w-full h-full object-cover"
                                            />

                                            {/* Overlay with file info */}
                                            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                                                <div className="absolute bottom-0 left-0 right-0 p-1">
                                                    <p className="text-white text-[10px] font-medium truncate">
                                                        {file.name}
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Remove button */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    removeFile(index);
                                                }}
                                                className="absolute top-0.5 right-0.5 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                                                disabled={isUploading || isProcessing}
                                                title="Remove"
                                            >
                                                <X size={12} />
                                            </button>

                                            {/* File number badge */}
                                            <div className="absolute top-0.5 left-0.5 bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                                                #{index + 1}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Upload Progress Bar */}
                            {isUploading && uploadProgress > 0 && (
                                <div className="mb-3">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-xs font-medium text-gray-700">
                                            Uploading... {uploadedCount}/{totalToUpload}
                                        </span>
                                        <span className="text-xs font-medium text-blue-600">
                                            {uploadProgress}%
                                        </span>
                                    </div>
                                    <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300 ease-out rounded-full"
                                            style={{
                                                width: `${uploadProgress}%`
                                            }}
                                        />
                                    </div>
                                    {estimatedTimeRemaining !== null && estimatedTimeRemaining > 0 && (
                                        <p className="text-xs text-gray-500 mt-1">
                                            ~{formatTimeRemaining(estimatedTimeRemaining)} remaining
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Upload & Process Button - Hide when completed */}
                            {processingStatus?.status !== 'completed' && (
                                <button
                                    onClick={() => handleUploadAndProcess()}
                                    disabled={isUploading || isProcessing}
                                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-4 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                                >
                                    {isUploading && <Loader2 className="animate-spin mr-2" size={18} />}
                                    {isProcessing && <Loader2 className="animate-spin mr-2" size={18} />}
                                    {isUploading
                                        ? `Uploading... ${uploadProgress}%`
                                        : isProcessing
                                            ? 'Processing...'
                                            : 'Upload & Process'}
                                </button>
                            )}
                        </div>
                    ) : processingStatus?.status === 'completed' ? (
                        // NEW: Completion summary on left side when returning to completed upload
                        <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl shadow-sm border-2 border-green-200 p-6 flex items-center justify-center min-h-[300px]">
                            <div className="text-center w-full px-4">
                                <div className="mx-auto mb-4 w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
                                    <CheckCircle className="text-green-600" size={40} />
                                </div>
                                <p className="text-lg font-bold text-green-900 mb-2">
                                    Upload Successful! ✓
                                </p>

                                {/* Detailed Summary in Left Card */}
                                <div className="bg-white/60 rounded-lg p-3 text-sm text-left mx-auto max-w-xs space-y-1 mb-2">
                                    {(() => {
                                        const stats = (processingStatus as any).duplicateStats || {};
                                        const processed = processingStatus.progress?.processed || 0;
                                        const newFiles = stats.newFiles !== undefined ? stats.newFiles : processed;
                                        const replaced = stats.replaced || 0;
                                        const skipped = stats.skipped || 0;

                                        return (
                                            <>
                                                <div className="flex justify-between">
                                                    <span className="text-green-800">New Files:</span>
                                                    <span className="font-bold text-green-700">{newFiles}</span>
                                                </div>
                                                {replaced > 0 && (
                                                    <div className="flex justify-between">
                                                        <span className="text-blue-800">Replaced:</span>
                                                        <span className="font-bold text-blue-700">{replaced}</span>
                                                    </div>
                                                )}
                                                {skipped > 0 && (
                                                    <div className="flex justify-between">
                                                        <span className="text-orange-800">Skipped:</span>
                                                        <span className="font-bold text-orange-700">{skipped}</span>
                                                    </div>
                                                )}
                                            </>
                                        );
                                    })()}
                                </div>

                                <p className="text-xs text-green-600">
                                    {processingStatus.message}
                                </p>
                            </div>
                        </div>
                    ) : (
                        // When resuming with no files, show a placeholder
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-center justify-center min-h-[300px]">
                            <div className="text-center">
                                <div className="mx-auto mb-3 w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center">
                                    <Loader2 className="text-blue-600 animate-spin" size={32} />
                                </div>
                                <p className="text-sm font-semibold text-gray-800 mb-1">Background Processing Active</p>
                                <p className="text-xs text-gray-500">Check progress on the right →</p>
                            </div>
                        </div>
                    )}

                    {/* RIGHT COLUMN: Processing Status */}
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                        {processingStatus ? (
                            <>
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-base font-semibold text-gray-900">Processing Status</h3>
                                    {processingStatus.status === 'completed' && (
                                        <CheckCircle className="text-green-500" size={20} />
                                    )}
                                    {processingStatus.status === 'failed' && (
                                        <XCircle className="text-red-500" size={20} />
                                    )}
                                    {(processingStatus.status === 'processing' || processingStatus.status === 'uploading' || processingStatus.status === 'queued') && (
                                        <Loader2 className="animate-spin text-blue-500" size={20} />
                                    )}
                                </div>

                                {/* Progress Bar */}
                                {(processingStatus.status === 'processing' || processingStatus.status === 'uploading' || processingStatus.status === 'queued') && processingStatus.progress && (
                                    <div className="mb-3">
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="text-xs font-medium text-gray-700">
                                                {processingStatus.progress.processed || 0} / {processingStatus.progress.total || 0}
                                            </span>
                                            <span className="text-xs font-medium text-blue-600">
                                                {Math.round(((processingStatus.progress.processed || 0) / (processingStatus.progress.total || 1)) * 100)}%
                                            </span>
                                        </div>
                                        <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                                            <div
                                                className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300 ease-out rounded-full"
                                                style={{
                                                    width: `${Math.min(100, ((processingStatus.progress.processed || 0) / (processingStatus.progress.total || 1)) * 100)}%`
                                                }}
                                            />
                                        </div>
                                        {/* Time Estimate */}
                                        {(() => {
                                            const processed = processingStatus.progress.processed || 0;
                                            const total = processingStatus.progress.total || 1;
                                            const remaining = total - processed;

                                            if (processed > 0 && remaining > 0 && (processingStatus as any).start_time) {
                                                const startTime = new Date((processingStatus as any).start_time).getTime();
                                                const now = Date.now();
                                                const elapsedSeconds = (now - startTime) / 1000;
                                                const avgTimePerFile = elapsedSeconds / processed;
                                                const estimatedSecondsRemaining = Math.ceil(avgTimePerFile * remaining);

                                                const minutes = Math.floor(estimatedSecondsRemaining / 60);
                                                const seconds = estimatedSecondsRemaining % 60;

                                                return (
                                                    <p className="text-xs text-blue-600 mt-1 font-medium">
                                                        ⏱️ ~{minutes > 0 ? `${minutes}m ` : ''}{seconds}s remaining
                                                    </p>
                                                );
                                            }
                                            return null;
                                        })()}
                                        {(processingStatus as any).current_file && (
                                            <p className="text-xs text-gray-600 mt-1 truncate">
                                                Processing: {(processingStatus as any).current_file}
                                            </p>
                                        )}
                                    </div>
                                )}

                                <div className="space-y-2 text-xs">
                                    {/* Detailed Breakdown */}
                                    <div className="flex justify-between">
                                        <span className="text-gray-600">Total Uploaded:</span>
                                        <span className="font-medium">{processingStatus.progress?.total || 0}</span>
                                    </div>

                                    <div className="border-t border-gray-100 my-1 pt-1 space-y-1">
                                        {/* Logic to extract stats safely */}
                                        {(() => {
                                            const stats = (processingStatus as any).duplicateStats || {};
                                            const processed = processingStatus.progress?.processed || 0;

                                            // If we have explicit stats, use them. 
                                            // Otherwise fallback: if processed > 0, assume all are new (unless we know better)
                                            // But really we only know for sure if duplicateStats exists.
                                            const hasStats = stats.newFiles !== undefined;

                                            const newFiles = hasStats ? stats.newFiles : processed;
                                            const replaced = stats.replaced || 0;
                                            const skipped = stats.skipped || 0;

                                            return (
                                                <>
                                                    <div className="flex justify-between pl-2 border-l-2 border-green-100">
                                                        <span className="text-gray-500">New Files:</span>
                                                        <span className="font-medium text-green-600">{newFiles}</span>
                                                    </div>
                                                    {replaced > 0 && (
                                                        <div className="flex justify-between pl-2 border-l-2 border-blue-100">
                                                            <span className="text-gray-500">Replaced Duplicates:</span>
                                                            <span className="font-medium text-blue-600">{replaced}</span>
                                                        </div>
                                                    )}
                                                    {skipped > 0 && (
                                                        <div className="flex justify-between pl-2 border-l-2 border-orange-100">
                                                            <span className="text-gray-500">Skipped Duplicates:</span>
                                                            <span className="font-medium text-orange-600">{skipped}</span>
                                                        </div>
                                                    )}
                                                </>
                                            );
                                        })()}
                                    </div>

                                    {(processingStatus.progress?.failed || 0) > 0 && (
                                        <div className="flex justify-between border-t border-gray-100 pt-1 mt-1">
                                            <span className="text-gray-600">Failed:</span>
                                            <span className="font-medium text-red-600">
                                                {processingStatus.progress?.failed || 0}
                                            </span>
                                        </div>
                                    )}
                                    <div className="pt-2 border-t border-gray-200">
                                        <p className="text-xs text-gray-700">{processingStatus.message}</p>
                                    </div>
                                </div>

                                {processingStatus.status === 'completed' && (
                                    <div className="mt-3 p-4 bg-green-50 border-2 border-green-200 rounded-lg">
                                        <div className="flex items-start gap-3 mb-3">
                                            <CheckCircle className="text-green-600 mt-0.5" size={20} />
                                            <div>
                                                <p className="text-sm font-semibold text-green-900 mb-1">
                                                    Processing Complete!
                                                </p>
                                                <p className="text-xs text-green-700">
                                                    {processingStatus.message || 'All files have been processed successfully'}
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => {
                                                setFiles([]);
                                                setProcessingStatus(null);
                                                localStorage.removeItem('salesCompletionStatus');
                                                navigate('/sales/review');
                                            }}
                                            className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 px-4 rounded-lg transition flex items-center justify-center gap-2 shadow-sm"
                                        >
                                            <CheckCircle size={18} />
                                            Review Sales →
                                        </button>
                                        <button
                                            onClick={() => {
                                                setFiles([]);
                                                setProcessingStatus(null);
                                                localStorage.removeItem('salesCompletionStatus');
                                            }}
                                            className="w-full mt-2 bg-white hover:bg-gray-50 text-gray-700 font-medium py-2 px-4 rounded-lg transition border border-gray-300 text-sm"
                                        >
                                            Upload More Files
                                        </button>
                                    </div>
                                )}
                            </>
                        ) : isProcessing ? (
                            <div className="h-full flex items-center justify-center text-gray-300 border-2 border-dashed border-gray-200 rounded-lg p-6">
                                <div className="text-center">
                                    <Loader2 className="mx-auto mb-3 w-8 h-8 text-blue-500 animate-spin" />
                                    <p className="text-xs font-medium text-gray-700 mb-1">Loading status...</p>
                                    <p className="text-xs text-gray-500">
                                        Fetching processing details
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="h-full flex items-center justify-center text-gray-300 border-2 border-dashed border-gray-200 rounded-lg p-6">
                                <div className="text-center">
                                    <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
                                        <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                    </div>
                                    <p className="text-xs font-medium text-gray-500 mb-1">No Active Processing</p>
                                    <p className="text-xs text-gray-400">
                                        Processing details will appear here after you click "Upload & Process"
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Duplicate Warning Modal */}
            <DuplicateWarningModal
                isOpen={showDuplicateModal}
                duplicateData={duplicateInfo?.existing_invoice || duplicateInfo || null}
                fileName={duplicateInfo?.file_key || duplicateInfo?.filename || ''}
                currentIndex={currentDuplicateIndex}
                totalDuplicates={duplicateQueue.length}
                onUploadAnyway={handleUploadAnyway}
                onSkip={handleSkipDuplicate}
            />

            {/* Image Preview Modal */}
            <ImagePreviewModal
                isOpen={previewModalOpen}
                files={files}
                currentIndex={previewIndex}
                onClose={handleClosePreview}
                onDelete={handleDeleteFromPreview}
                onNavigate={handleNavigatePreview}
            />
        </div>
    );
};

export default UploadPage;
