import React, { useState, useCallback, useEffect } from 'react';
import { Upload as UploadIcon, X, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { inventoryAPI } from '../services/inventoryApi';
import { useQueryClient } from '@tanstack/react-query';
import DuplicateWarningModal from '../components/DuplicateWarningModal';
import ImagePreviewModal from '../components/ImagePreviewModal';
import { useGlobalStatus } from '../contexts/GlobalStatusContext';

const InventoryUploadPage: React.FC = () => {
    const navigate = useNavigate();
    const [files, setFiles] = useState<File[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingStatus, setProcessingStatus] = useState<any>(null);
    const [pollingInterval, setPollingInterval] = useState<number | null>(null);

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
    const [filesToSkip, setFilesToSkip] = useState<string[]>([]);
    const [filesToForceUpload, setFilesToForceUpload] = useState<string[]>([]);
    const [duplicateStats, setDuplicateStats] = useState<{ totalUploaded: number; replaced: number; skipped: number }>({ totalUploaded: 0, replaced: 0, skipped: 0 });
    const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
    const queryClient = useQueryClient();
    const { setInventoryStatus } = useGlobalStatus(); // NEW: Global Context

    // Image preview modal state
    const [previewModalOpen, setPreviewModalOpen] = useState(false);
    const [previewIndex, setPreviewIndex] = useState(0);

    // Resume monitoring on page load if there's an active task
    useEffect(() => {
        // Clear completion badge if visiting this page
        setInventoryStatus({ isComplete: false });

        let interval: any = null;

        const checkStatus = () => {
            // First check if there's a saved completion status
            const savedCompletion = localStorage.getItem('inventoryCompletionStatus');

            if (savedCompletion) {
                try {
                    const completionData = JSON.parse(savedCompletion);
                    // Only update if state is different to avoid renders
                    if (JSON.stringify(processingStatus) !== JSON.stringify(completionData)) {
                        setProcessingStatus(completionData);
                    }

                    setIsProcessing(false);
                    setIsUploading(false);
                    setFiles([]);

                    // RESTORE GLOBAL STATUS ON LOAD
                    const processed = completionData.progress?.processed || 0;
                    setInventoryStatus({
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
                    console.error('Error parsing inventory completion:', e);
                    localStorage.removeItem('inventoryCompletionStatus');
                }
            }

            const activeTaskId = localStorage.getItem('activeInventoryTaskId');

            if (activeTaskId && !pollingInterval) {
                // CRITICAL: Set processing state IMMEDIATELY/RESUME
                setIsProcessing(true);
                setIsUploading(false);
                setInventoryStatus({ isUploading: false, processingCount: 1, totalProcessing: 1 }); // Approx

                startPolling(activeTaskId);
                return true;
            }
            return false;
        };

        const startPolling = (taskId: string) => {
            // Start continuous polling
            interval = setInterval(async () => {
                try {
                    const statusData = await inventoryAPI.getProcessStatus(taskId);

                    // UPDATE GLOBAL STATUS
                    const total = statusData.progress?.total || 0;
                    const processed = statusData.progress?.processed || 0;
                    const remaining = Math.max(0, total - processed);

                    setInventoryStatus({
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
                        setPollingInterval(null);
                        setIsProcessing(false);

                        const duplicates = (statusData as any).duplicates;
                        setDuplicateQueue(duplicates);
                        setCurrentDuplicateIndex(0);
                        setDuplicateInfo(duplicates[0]);
                        setShowDuplicateModal(true);
                        setFilesToSkip([]);
                        setFilesToForceUpload([]);

                        setInventoryStatus({
                            isUploading: false,
                            processingCount: 0,
                            reviewCount: duplicates.length,
                            syncCount: processed
                        });

                        const allFileKeys = (statusData as any).uploaded_r2_keys || duplicates.map((dup: any) => dup.file_key);
                        setUploadedFiles(allFileKeys);
                        (window as any).__temp_r2_keys = allFileKeys;

                        localStorage.removeItem('activeInventoryTaskId');
                        return;
                    }

                    // Handle completion
                    if (statusData.status === 'completed' || statusData.status === 'failed') {
                        clearInterval(interval);
                        setPollingInterval(null);
                        localStorage.removeItem('activeInventoryTaskId');
                        localStorage.setItem('inventoryCompletionStatus', JSON.stringify(statusData));

                        setInventoryStatus({
                            isUploading: false,
                            processingCount: 0,
                            reviewCount: 0,
                            syncCount: processed
                        });

                        // Force a refresh of the status to show success UI immediately
                        checkStatus();
                    }
                } catch (error: any) {
                    console.error('Error polling inventory status:', error);
                    if (error?.response?.status === 403 || error?.response?.status === 404) {
                        clearInterval(interval);
                        setPollingInterval(null);
                        localStorage.removeItem('activeInventoryTaskId');
                        setIsProcessing(false);
                        setProcessingStatus(null);
                        setInventoryStatus({ processingCount: 0, isUploading: false });
                    }
                }
            }, 1000);

            setPollingInterval(interval);
        };

        // Initial check
        if (!checkStatus()) {
            // If initially idle, set up an idle poller to watch for background updates
            const idleWatcher = setInterval(() => {
                checkStatus();
            }, 2000); // Check every 2 seconds

            return () => {
                clearInterval(idleWatcher);
                if (pollingInterval) clearInterval(pollingInterval);
            };
        }

        // Cleanup on unmount
        return () => {
            if (interval) clearInterval(interval);
            // Clear completion badge when leaving the page
            setInventoryStatus({ isComplete: false });
        };
    }, []);

    // Browser warning when trying to close/refresh during upload
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (isUploading) {
                e.preventDefault();
                e.returnValue = 'Files are uploading to server. Please wait a few seconds.';
                return 'Files are uploading to server. Please wait a few seconds.';
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

            // Reset processing state when selecting new files
            if (processingStatus?.status === 'completed' || processingStatus?.status === 'failed') {
                setIsProcessing(false);
                setProcessingStatus(null);
                localStorage.removeItem('inventoryCompletionStatus');
                setInventoryStatus({ syncCount: 0, processingCount: 0 }); // Reset global status
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
            setIsUploading(true);
            // UPDATE GLOBAL STATUS: Uploading
            setInventoryStatus({
                isUploading: true,
                processingCount: files.length,
                totalProcessing: files.length,
                reviewCount: 0,
                syncCount: 0
            });

            setUploadProgress(0);

            // Initialize upload tracking
            const totalFiles = files.length;
            setTotalToUpload(totalFiles);
            setUploadedCount(0);
            setUploadStartTime(Date.now());
            setEstimatedTimeRemaining(null);

            // Track total files uploaded for correct summary calculation
            setDuplicateStats({ totalUploaded: totalFiles, replaced: 0, skipped: 0 });

            let fileKeys: string[] = [];
            const BATCH_SIZE = 5;
            let processedCount = 0;

            for (let i = 0; i < totalFiles; i += BATCH_SIZE) {
                const batch = files.slice(i, i + BATCH_SIZE);

                const response = await inventoryAPI.uploadFiles(batch, (progressEvent) => {
                    const batchPercent = progressEvent.loaded / progressEvent.total;
                    const validBatchSize = batch.length;
                    const currentBatchProgress = batchPercent * validBatchSize;
                    const totalProgress = Math.round(((processedCount + currentBatchProgress) / totalFiles) * 100);
                    setUploadProgress(totalProgress);
                });

                if (response.uploaded_files) {
                    fileKeys = [...fileKeys, ...response.uploaded_files];
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

            // Start processing with forceUpload parameter
            setIsProcessing(true);
            // UPDATE GLOBAL STATUS: Processing
            setInventoryStatus({ isUploading: false }); // Still processingCount = total

            const processResponse = await inventoryAPI.processInventory(fileKeys, forceUpload);
            setProcessingStatus(processResponse);

            // Save taskId to localStorage for persistence
            const taskId = processResponse.task_id;
            localStorage.setItem('activeInventoryTaskId', taskId);
            const pollInterval = setInterval(async () => {
                const status = await inventoryAPI.getProcessStatus(taskId);
                setProcessingStatus(status);

                // UPDATE GLOBAL STATUS: Processing Progress
                const processed = status.progress?.processed || 0;
                const total = status.progress?.total || 0;
                const remaining = Math.max(0, total - processed);
                setInventoryStatus({ processingCount: remaining });

                // Handle duplicate detection - START SEQUENTIAL WORKFLOW
                if (status.status === 'duplicate_detected' && (status as any).duplicates?.length > 0) {
                    clearInterval(pollInterval);
                    setIsProcessing(false);

                    // Initialize duplicate queue
                    const duplicates = (status as any).duplicates;
                    setDuplicateQueue(duplicates);
                    setCurrentDuplicateIndex(0);

                    // UPDATE GLOBAL STATUS: Need Review
                    setInventoryStatus({
                        processingCount: 0,
                        reviewCount: duplicates.length,
                        syncCount: processed // Successful ones are ready to sync
                    });

                    // Track how many files were successfully processed before duplicates
                    const newFilesProcessed = status.progress?.processed || 0;
                    setDuplicateStats(prev => ({ ...prev, newFiles: newFilesProcessed }));

                    // Set first duplicate info
                    const firstDup = duplicates[0];
                    setDuplicateInfo(firstDup);
                    setShowDuplicateModal(true);
                    setFilesToSkip([]);
                    setFilesToForceUpload([]);

                    // CRITICAL FIX: Update uploadedFiles with R2 keys from the processing status
                    setUploadedFiles((status as any).uploaded_r2_keys || []);
                    (window as any).__temp_r2_keys = (status as any).uploaded_r2_keys || [];

                    return;
                }

                // Handle completion or failure
                if (status.status === 'completed' || status.status === 'failed') {
                    clearInterval(pollInterval);

                    if (status.status === 'completed') {
                        // When no duplicates detected, all files are new
                        // totalUploaded was set at upload start, just finish with current stats
                        finishProcessing(duplicateStats);
                    } else {
                        setIsProcessing(false);
                        // Failed
                        setInventoryStatus({ processingCount: 0 });
                    }
                }
            }, 1000);
        } catch (error) {
            console.error('Error:', error);
            setIsUploading(false);
            setIsProcessing(false);
            setInventoryStatus({ isUploading: false, processingCount: 0 });
        }
    };

    // Sequential duplicate handling
    const handleSkipDuplicate = () => {
        if (!duplicateInfo) return;

        // Add current file to skip list
        const skipList = [...filesToSkip, duplicateInfo.file_key];
        setFilesToSkip(skipList);

        // Decrement global review count
        setInventoryStatus({ reviewCount: Math.max(0, duplicateQueue.length - (currentDuplicateIndex + 1)) });


        // Track skipped files
        setDuplicateStats(prev => ({ ...prev, skipped: prev.skipped + 1 }));

        moveToNextDuplicate(skipList, filesToForceUpload, (window as any).__temp_r2_keys || []);
    };

    const handleUploadAnyway = () => {
        const currentDup = duplicateQueue[currentDuplicateIndex];
        const updatedForceUpload = [...filesToForceUpload, currentDup.file_key];
        setFilesToForceUpload(updatedForceUpload);

        // Decrement global review count
        setInventoryStatus({ reviewCount: Math.max(0, duplicateQueue.length - (currentDuplicateIndex + 1)) });

        moveToNextDuplicate(filesToSkip, updatedForceUpload, (window as any).__temp_r2_keys || []);
    };

    const moveToNextDuplicate = (skipList: string[] = filesToSkip, forceUploadList: string[] = filesToForceUpload, allR2Keys: string[] = uploadedFiles) => {
        const nextIndex = currentDuplicateIndex + 1;

        if (nextIndex < duplicateQueue.length) {
            // Show next duplicate
            setCurrentDuplicateIndex(nextIndex);
            setDuplicateInfo(duplicateQueue[nextIndex]);
        } else {
            // All duplicates handled - close modal and process remaining files
            setShowDuplicateModal(false);
            setDuplicateQueue([]);
            setDuplicateInfo(null);
            processRemainingFiles(skipList, forceUploadList, allR2Keys);
        }
    };

    const processRemainingFiles = async (_skipList: string[] = filesToSkip, forceUploadList: string[] = filesToForceUpload, allR2Keys: string[] = uploadedFiles) => {
        try {
            setIsProcessing(true);

            // UPDATE GLOBAL STATUS: Back to Processing
            // Only forced uploads are processed again? Or skipped just ignored.
            // Actually, we are starting a NEW process for everything including new + forced.
            // Logic in processRemainingFiles calculates allFilesToProcess.

            // Filter non-duplicate files from allR2Keys
            const allDuplicateKeys = [..._skipList, ...forceUploadList];
            const nonDuplicateFiles = allR2Keys.filter(key => !allDuplicateKeys.includes(key));
            const allFilesToProcess = [...nonDuplicateFiles, ...forceUploadList];

            setInventoryStatus({
                isUploading: false,
                processingCount: allFilesToProcess.length,
                totalProcessing: allFilesToProcess.length,
                reviewCount: 0
            });


            if (allFilesToProcess.length > 0) {
                // Update stats for summary later
                setProcessingStatus({
                    task_id: '',
                    status: 'processing',
                    progress: { total: allFilesToProcess.length, processed: 0, failed: 0 },
                    message: `Processing ${allFilesToProcess.length} file(s)...`,
                    duplicateStats: {
                        skipped: _skipList.length,
                        replaced: forceUploadList.length,
                        newFiles: nonDuplicateFiles.length,
                        totalUploaded: allR2Keys.length
                    }
                });

                // Send all files for processing
                // CRITICAL: Force upload MUST be true because files are already in R2
                const processResponse = await inventoryAPI.processInventory(allFilesToProcess, true);
                setProcessingStatus(processResponse);

                // Poll for completion
                const pollForce = setInterval(async () => {
                    const status = await inventoryAPI.getProcessStatus(processResponse.task_id);
                    // Preserve duplicateStats across polling updates
                    setProcessingStatus((prev: any) => ({
                        ...status,
                        duplicateStats: prev?.duplicateStats
                    }));

                    // UPDATE GLOBAL STATUS: Progress
                    const processed = status.progress?.processed || 0;
                    const total = status.progress?.total || 0;
                    const remaining = Math.max(0, total - processed);
                    setInventoryStatus({ processingCount: remaining });


                    if (status.status === 'completed' || status.status === 'failed') {
                        clearInterval(pollForce);
                        finishProcessing(status);
                    }
                }, 1000);
            } else {
                // No files to process - all were skipped
                finishProcessing();
            }
        } catch (error) {
            console.error('Error processing remaining files:', error);
            setIsProcessing(false);
            setInventoryStatus({ processingCount: 0 });
        }
    };

    const finishProcessing = (latestStatus?: any) => {
        // Use latest status if provided (which might be the full status object), otherwise fall back to state
        const statusToUse = (latestStatus && latestStatus.progress) ? latestStatus : processingStatus;

        // Extract stats from status, or passed param, or state
        const stats = (statusToUse as any).duplicateStats || duplicateStats;
        const { totalUploaded, replaced, skipped } = stats;

        // Calculate new files: new = total uploaded - replaced - skipped
        // If we processed everything directly (no duplicates flow), newFiles is simply totalProcessed
        // We use statusToUse.progress.processed for total successful processed count
        const totalProcessed = statusToUse?.progress?.processed || 0;

        let newFiles = 0;
        if (totalUploaded > 0) {
            newFiles = Math.max(0, totalUploaded - replaced - skipped);
        } else {
            // Fallback if totalUploaded wasn't set correctly (legacy flow)
            newFiles = Math.max(0, totalProcessed - replaced);
        }

        let summaryMessage = `Successfully processed ${totalProcessed} vendor invoice${totalProcessed !== 1 ? 's' : ''}`;

        if (replaced > 0 || skipped > 0) {
            const parts: string[] = [];
            if (newFiles > 0) parts.push(`${newFiles} new`);
            if (replaced > 0) parts.push(`${replaced} replaced`);
            if (skipped > 0) parts.push(`${skipped} skipped`);
            if (parts.length > 0) summaryMessage += ` (${parts.join(', ')})`;
        } else {
            summaryMessage = 'Processing complete';
        }

        const finalStatus = {
            task_id: '',
            status: 'completed',
            progress: {
                total: totalProcessed + skipped, // Total attempted (successfully processed + skipped)
                processed: totalProcessed, // Only successfully processed
                failed: 0
            },
            message: summaryMessage,
            duplicateStats: duplicateStats  // Preserve stats for display
        };

        setProcessingStatus(finalStatus);
        localStorage.setItem('inventoryCompletionStatus', JSON.stringify(finalStatus));

        // UPDATE GLOBAL STATUS: Sync Ready
        setInventoryStatus({
            isUploading: false,
            processingCount: 0,
            reviewCount: 0,
            syncCount: finalStatus.progress.processed,
            isComplete: true // Show green tick
        });

        setIsProcessing(false);
        // DON'T clear files or state here - keep them so the success UI displays properly
        // Files will be cleared when user clicks "Verify Purchases" button

        // Clear localStorage task
        localStorage.removeItem('activeInventoryTaskId');

        queryClient.invalidateQueries({ queryKey: ['inventory'] });
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
                                <p className="font-bold">कृपया प्रतीक्षा करें - Please Wait!</p>
                                <p className="text-sm">Files uploading to server... Don't close this page ({uploadProgress}% done)</p>
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
            {/* Simulator Removed */}
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
                    Drop purchase bill images here
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
            {(files.length > 0 || isProcessing || processingStatus?.status === 'completed') && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* LEFT COLUMN: Image Preview & Upload Button - Hide if no files (resume case) */}
                    {files.length > 0 ? (
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                            <h3 className="text-base font-semibold text-gray-900 mb-3">
                                Selected Files ({files.length})
                            </h3>

                            {/* Scrollable Image Grid */}
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

                            {/* Upload & Process Button */}
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
                            <div className="text-center">
                                <div className="mx-auto mb-4 w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
                                    <CheckCircle className="text-green-600" size={40} />
                                </div>
                                <p className="text-lg font-bold text-green-900 mb-2">
                                    Upload Successful! ✓
                                </p>
                                <p className="text-sm text-green-700 mb-1">
                                    {processingStatus.progress?.processed || 0} purchase bill(s) processed
                                </p>
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
                                    {(processingStatus.status === 'processing' || processingStatus.status === 'uploading') && (
                                        <Loader2 className="animate-spin text-blue-500" size={20} />
                                    )}
                                </div>

                                {/* Progress Bar */}
                                {(processingStatus.status === 'processing' || processingStatus.status === 'uploading') && processingStatus.progress && (
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
                                        {(processingStatus as any).current_file && (
                                            <p className="text-xs text-gray-600 mt-1 truncate">
                                                Processing: {(processingStatus as any).current_file}
                                            </p>
                                        )}
                                    </div>
                                )}

                                <div className="space-y-2 text-xs">
                                    <div className="flex justify-between">
                                        <span className="text-gray-600">Total Files:</span>
                                        <span className="font-medium">{(processingStatus as any).duplicateStats?.totalUploaded || processingStatus.progress?.total || 0}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-gray-600">Processed:</span>
                                        <span className="font-medium text-green-600">
                                            {processingStatus.progress?.processed || 0}
                                        </span>
                                    </div>
                                    {(processingStatus.progress?.failed || 0) > 0 && (
                                        <div className="flex justify-between">
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
                                                localStorage.removeItem('inventoryCompletionStatus');
                                                navigate('/inventory/verify');
                                            }}
                                            className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 px-4 rounded-lg transition flex items-center justify-center gap-2 shadow-sm"
                                        >
                                            <CheckCircle size={18} />
                                            Verify All Purchases →
                                        </button>
                                        <button
                                            onClick={() => {
                                                setFiles([]);
                                                setProcessingStatus(null);
                                                localStorage.removeItem('inventoryCompletionStatus');
                                            }}
                                            className="w-full mt-2 bg-white hover:bg-gray-50 text-gray-700 font-medium py-2 px-4 rounded-lg transition border border-gray-300 text-sm"
                                        >
                                            Upload More Files
                                        </button>
                                    </div>
                                )}
                            </>
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
                duplicateData={duplicateInfo?.existing_record || duplicateInfo || null}
                fileName={duplicateInfo?.file_key || ''}
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

export default InventoryUploadPage;
