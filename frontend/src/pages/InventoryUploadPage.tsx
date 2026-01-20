import React, { useState, useCallback, useEffect } from 'react';
import { Upload as UploadIcon, X, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { inventoryAPI } from '../services/inventoryApi';
import { useQueryClient } from '@tanstack/react-query';
import DuplicateWarningModal from '../components/DuplicateWarningModal';

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
    const [duplicateStats, setDuplicateStats] = useState<{ newFiles: number; replaced: number; skipped: number }>({ newFiles: 0, replaced: 0, skipped: 0 });
    const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
    const queryClient = useQueryClient();

    // Resume monitoring on page load if there's an active task
    useEffect(() => {
        // First check if there's a saved completion status
        const savedCompletion = localStorage.getItem('inventoryCompletionStatus');
        if (savedCompletion) {
            try {
                const completionData = JSON.parse(savedCompletion);
                setProcessingStatus(completionData);
                setIsProcessing(true);
                setIsUploading(false);
                console.log('📦 Restored inventory completion status');
                return;
            } catch (e) {
                console.error('Error parsing inventory completion:', e);
                localStorage.removeItem('inventoryCompletionStatus');
            }
        }

        const activeTaskId = localStorage.getItem('activeInventoryTaskId');
        if (activeTaskId) {
            console.log('📦 Resuming inventory session for task:', activeTaskId);

            // CRITICAL: Set processing state IMMEDIATELY
            setIsProcessing(true);
            setIsUploading(false);

            // Start continuous polling
            const interval = setInterval(async () => {
                try {
                    const statusData = await inventoryAPI.getProcessStatus(activeTaskId);
                    console.log('📊 Polled inventory status:', statusData.status, `${statusData.progress?.processed}/${statusData.progress?.total}`);

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

                        const allFileKeys = duplicates.map((dup: any) => dup.file_key);
                        setUploadedFiles(allFileKeys);

                        localStorage.removeItem('activeInventoryTaskId');
                        return;
                    }

                    // Handle completion
                    if (statusData.status === 'completed' || statusData.status === 'failed') {
                        clearInterval(interval);
                        setPollingInterval(null);
                        localStorage.removeItem('activeInventoryTaskId');
                        localStorage.setItem('inventoryCompletionStatus', JSON.stringify(statusData));
                        console.log('✅ Inventory processing completed');
                    }
                } catch (error: any) {
                    console.error('Error polling inventory status:', error);
                    if (error?.response?.status === 403 || error?.response?.status === 404) {
                        console.log('Inventory task no longer exists');
                        clearInterval(interval);
                        setPollingInterval(null);
                        localStorage.removeItem('activeInventoryTaskId');
                        setIsProcessing(false);
                        setProcessingStatus(null);
                    }
                }
            }, 1000);

            setPollingInterval(interval);
        }

        // Cleanup on unmount - preserve session
        return () => {
            if (pollingInterval) {
                console.log('🔄 Page unmounting - stopping polling (session preserved)');
                clearInterval(pollingInterval);
            }
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
            }

            setFiles((prev) => [...prev, ...uniqueFiles]);
        }
    };

    const removeFile = (index: number) => {
        setFiles((prev) => prev.filter((_, i) => i !== index));
    };

    const handleUploadAndProcess = async (forceUpload: boolean = false) => {
        if (files.length === 0) return;

        try {
            setIsUploading(true);
            setUploadProgress(0);

            // Initialize upload tracking
            const totalFiles = files.length;
            setTotalToUpload(totalFiles);
            setUploadedCount(0);
            setUploadStartTime(Date.now());
            setEstimatedTimeRemaining(null);

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
            const processResponse = await inventoryAPI.processInventory(fileKeys, forceUpload);
            setProcessingStatus(processResponse);

            // Save taskId to localStorage for persistence
            const taskId = processResponse.task_id;
            localStorage.setItem('activeInventoryTaskId', taskId);
            const pollInterval = setInterval(async () => {
                const status = await inventoryAPI.getProcessStatus(taskId);
                setProcessingStatus(status);

                // Handle duplicate detection - START SEQUENTIAL WORKFLOW
                if (status.status === 'duplicate_detected' && (status as any).duplicates?.length > 0) {
                    clearInterval(pollInterval);
                    setIsProcessing(false);

                    // Initialize duplicate queue
                    const duplicates = (status as any).duplicates;
                    setDuplicateQueue(duplicates);
                    setCurrentDuplicateIndex(0);

                    // Track how many files were successfully processed before duplicates
                    const newFilesProcessed = status.progress?.processed || 0;
                    setDuplicateStats(prev => ({ ...prev, newFiles: newFilesProcessed }));

                    // Set first duplicate info
                    const firstDup = duplicates[0];
                    setDuplicateInfo(firstDup);
                    setShowDuplicateModal(true);
                    setFilesToSkip([]);
                    setFilesToForceUpload([]);
                    return;
                }

                // Handle completion or failure
                if (status.status === 'completed' || status.status === 'failed') {
                    clearInterval(pollInterval);

                    if (status.status === 'completed') {
                        // No duplicates - all files processed successfully
                        const processedCount = status.progress?.processed || 0;
                        setDuplicateStats({ newFiles: processedCount, replaced: 0, skipped: 0 });
                        finishProcessing();
                    } else {
                        setIsProcessing(false);
                    }
                }
            }, 1000);
        } catch (error) {
            console.error('Error:', error);
            setIsUploading(false);
            setIsProcessing(false);
        }
    };

    // Sequential duplicate handling
    const handleSkipDuplicate = () => {
        if (!duplicateInfo) return;

        // Add current file to skip list
        const skipList = [...filesToSkip, duplicateInfo.file_key];
        setFilesToSkip(skipList);

        // Track skipped files
        setDuplicateStats(prev => ({ ...prev, skipped: prev.skipped + 1 }));

        // Move to next duplicate or finish
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
            processRemainingFiles(skipList, filesToForceUpload);
        }
    };

    const handleUploadAnyway = () => {
        const currentDup = duplicateQueue[currentDuplicateIndex];
        const updatedForceUpload = [...filesToForceUpload, currentDup.file_key];
        setFilesToForceUpload(updatedForceUpload);
        moveToNextDuplicate(filesToSkip, updatedForceUpload);
    };

    const moveToNextDuplicate = (skipList: string[] = filesToSkip, forceUploadList: string[] = filesToForceUpload) => {
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
            processRemainingFiles(skipList, forceUploadList);
        }
    };

    const processRemainingFiles = async (_skipList: string[] = filesToSkip, forceUploadList: string[] = filesToForceUpload) => {
        try {
            setIsProcessing(true);

            // Batch: Force upload duplicates (user chose to replace)
            if (forceUploadList.length > 0) {
                setProcessingStatus({
                    task_id: '',
                    status: 'processing',
                    progress: { total: forceUploadList.length, processed: 0, failed: 0 },
                    message: 'Processing replaced files...'
                });

                const forceResponse = await inventoryAPI.processInventory(forceUploadList, true);
                setProcessingStatus(forceResponse);

                // Poll for force upload completion
                const pollForce = setInterval(async () => {
                    const status = await inventoryAPI.getProcessStatus(forceResponse.task_id);
                    setProcessingStatus(status);

                    if (status.status === 'completed' || status.status === 'failed') {
                        clearInterval(pollForce);
                        // Track replaced files count
                        const replacedCount = status.progress?.processed || 0;
                        setDuplicateStats(prev => ({ ...prev, replaced: replacedCount }));
                        finishProcessing();
                    }
                }, 1000);
            } else {
                // No files to force upload, just finish
                finishProcessing();
            }
        } catch (error) {
            console.error('Error processing remaining files:', error);
            setIsProcessing(false);
        }
    };

    const finishProcessing = () => {
        // Generate summary message using tracked duplicate stats
        const { newFiles, replaced, skipped } = duplicateStats;
        const totalProcessed = newFiles + replaced;

        let summaryMessage = '';

        if (totalProcessed > 0) {
            const parts: string[] = [];

            // Main processed count
            parts.push(`Successfully processed ${totalProcessed} vendor invoice${totalProcessed !== 1 ? 's' : ''}`);

            // Breakdown if there were duplicates
            if (replaced > 0 || skipped > 0) {
                const breakdown: string[] = [];
                if (newFiles > 0) breakdown.push(`${newFiles} new`);
                if (replaced > 0) breakdown.push(`${replaced} replaced`);
                if (skipped > 0) breakdown.push(`${skipped} skipped`);
                parts.push(`(${breakdown.join(', ')})`);
            }

            summaryMessage = parts.join(' ');
        } else {
            summaryMessage = 'Processing complete';
        }

        setProcessingStatus({
            task_id: '',
            status: 'completed',
            progress: {
                total: files.length,
                processed: totalProcessed,
                failed: 0
            },
            message: summaryMessage
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
            {(files.length > 0 || isProcessing) && (
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
                                            className="relative group aspect-square bg-white border-2 border-gray-200 rounded-lg overflow-hidden hover:border-blue-400 transition-all shadow-sm hover:shadow-md"
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
                                                onClick={() => removeFile(index)}
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
                                        <span className="font-medium">{processingStatus.progress?.total || 0}</span>
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
                                    <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                                        <p className="text-xs font-medium text-green-800 mb-2">
                                            ✓ Processing complete! Verify the extracted data.
                                        </p>
                                        <button
                                            onClick={() => {
                                                setFiles([]);
                                                setProcessingStatus(null);
                                                localStorage.removeItem('inventoryCompletionStatus');
                                                navigate('/inventory/verify');
                                            }}
                                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-3 rounded-lg transition flex items-center justify-center gap-2 text-sm"
                                        >
                                            <CheckCircle size={16} />
                                            Verify All Purchases
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
        </div>
    );
};

export default InventoryUploadPage;
