import React, { useState, useCallback } from 'react';
import { Upload as UploadIcon, X, FileImage, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { uploadAPI } from '../services/api';
import { useQueryClient } from '@tanstack/react-query';
import DuplicateWarningModal from '../components/DuplicateWarningModal';

const UploadPage: React.FC = () => {
    const navigate = useNavigate();
    const [files, setFiles] = useState<File[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingStatus, setProcessingStatus] = useState<any>(null);

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
    const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
    const queryClient = useQueryClient();

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

                const response = await uploadAPI.uploadFiles(batch, (progressEvent) => {
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
            const processResponse = await uploadAPI.processInvoices(fileKeys, forceUpload);
            setProcessingStatus(processResponse);

            // Poll for status
            const taskId = processResponse.task_id;
            const pollInterval = setInterval(async () => {
                const status = await uploadAPI.getProcessStatus(taskId);
                setProcessingStatus(status);


                // Handle duplicate detection - START SEQUENTIAL WORKFLOW
                if (status.status === 'duplicate_detected' && (status as any).duplicates?.length > 0) {
                    clearInterval(pollInterval);
                    setIsProcessing(false);

                    // Initialize duplicate queue
                    const duplicates = (status as any).duplicates;
                    setDuplicateQueue(duplicates);
                    setCurrentDuplicateIndex(0);

                    // Set first duplicate info - check if it has existing_invoice
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
                    setIsProcessing(false);

                    if (status.status === 'completed') {
                        // Clear files and reset
                        setFiles([]);
                        setUploadedFiles([]);

                        // Invalidate queries to refresh data
                        queryClient.invalidateQueries({ queryKey: ['invoices'] });
                        queryClient.invalidateQueries({ queryKey: ['review'] });
                    }
                }
            }, 1000); // Poll every 1 second for responsive updates
        } catch (error) {
            console.error('Error:', error);
            setIsUploading(false);
            setIsProcessing(false);
        }
    };

    // Sequential duplicate handling
    const handleSkipDuplicate = () => {
        const currentDup = duplicateQueue[currentDuplicateIndex];
        const updatedSkip = [...filesToSkip, currentDup.file_key];
        setFilesToSkip(updatedSkip);
        moveToNextDuplicate(updatedSkip, filesToForceUpload);
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
            // Modal stays open
        } else {
            // All duplicates handled - close modal and process remaining files
            setShowDuplicateModal(false);
            setDuplicateQueue([]);
            setDuplicateInfo(null);
            // Pass the arrays directly to avoid React state timing issues
            processRemainingFiles(skipList, forceUploadList);
        }
    };

    const processRemainingFiles = async (_skipList: string[] = filesToSkip, forceUploadList: string[] = filesToForceUpload) => {
        try {
            setIsProcessing(true);
            // Skip list is used for tracking skipped files in finishProcessing

            // Files that were never checked for duplicates (truly new, not in the initial batch)
            // NOTE: In current flow, all uploaded files go through duplicate check,
            // so newFiles might be empty. The real logic is:
            // - filesToForceUpload = duplicates that user chose to replace
            // - filesToSkip = duplicates that user chose to skip
            // - Already processed successfully = files that passed duplicate check and were processed

            // Get files that were neither duplicates nor processed
            // Since we detect duplicates BEFORE processing, we need to track which files were actually processed
            // The safest approach: Only process files explicitly marked for force upload
            // Don't re-process files that weren't duplicates (they were already processed!)


            // Batch 1: Force upload duplicates (user chose to replace)
            if (forceUploadList.length > 0) {
                // Clear duplicate status and show processing state
                setProcessingStatus({
                    task_id: '',
                    status: 'processing',
                    progress: { total: forceUploadList.length, processed: 0, failed: 0 },
                    message: 'Processing replaced files...'
                });

                const forceResponse = await uploadAPI.processInvoices(forceUploadList, true);
                setProcessingStatus(forceResponse);

                // Poll for force upload completion
                const pollForce = setInterval(async () => {
                    const status = await uploadAPI.getProcessStatus(forceResponse.task_id);
                    setProcessingStatus(status);

                    if (status.status === 'completed' || status.status === 'failed') {
                        clearInterval(pollForce);
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
        // Calculate how many files were actually processed
        const totalFiles = uploadedFiles.length;
        const skippedCount = filesToSkip.length;
        const processedCount = totalFiles - skippedCount;

        // Set a completion status message
        setProcessingStatus({
            task_id: '',
            status: 'completed',
            progress: {
                total: totalFiles,
                processed: processedCount,
                failed: 0
            },
            message: skippedCount > 0
                ? `Successfully processed ${processedCount} invoice${processedCount !== 1 ? 's' : ''}. Skipped ${skippedCount} duplicate${skippedCount !== 1 ? 's' : ''}.`
                : `Successfully processed ${processedCount} invoice${processedCount !== 1 ? 's' : ''}.`
        });

        setIsProcessing(false);
        setFiles([]);
        setUploadedFiles([]);
        setDuplicateQueue([]);
        setFilesToSkip([]);
        setFilesToForceUpload([]);

        queryClient.invalidateQueries({ queryKey: ['invoices'] });
        queryClient.invalidateQueries({ queryKey: ['review'] });
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-gray-900">Upload & Process Invoices</h1>
                <p className="text-gray-600 mt-2">
                    Upload invoice images for automated data extraction
                </p>
            </div>

            {/* Upload Area */}
            <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-12 text-center transition ${isDragging
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-300 bg-white hover:border-gray-400'
                    }`}
            >
                <UploadIcon className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                <p className="text-lg font-medium text-gray-700 mb-2">
                    Drop invoice images here
                </p>
                <p className="text-sm text-gray-500 mb-4">
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

            {/* File List */}
            {files.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                    <h3 className="text-lg font-semibold text-gray-900 mb-4">
                        Selected Files ({files.length})
                    </h3>
                    <div className="space-y-2">
                        {files.map((file, index) => (
                            <div
                                key={index}
                                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                            >
                                <div className="flex items-center space-x-3">
                                    <FileImage size={20} className="text-gray-400" />
                                    <span className="text-sm font-medium text-gray-700">{file.name}</span>
                                    <span className="text-xs text-gray-500">
                                        {(file.size / 1024 / 1024).toFixed(2)} MB
                                    </span>
                                </div>
                                <button
                                    onClick={() => removeFile(index)}
                                    className="text-red-500 hover:text-red-700 transition"
                                    disabled={isUploading || isProcessing}
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* Upload Progress Bar */}
                    {isUploading && uploadProgress > 0 && (
                        <div className="mt-4">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-sm font-medium text-gray-700">
                                    Uploading files... {uploadedCount}/{totalToUpload}
                                </span>
                                <div className="flex items-center gap-3">
                                    <span className="text-sm font-medium text-blue-600">
                                        {uploadProgress}%
                                    </span>
                                    {estimatedTimeRemaining !== null && estimatedTimeRemaining > 0 && (
                                        <span className="text-xs text-gray-500">
                                            ~{formatTimeRemaining(estimatedTimeRemaining)} remaining
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                                <div
                                    className="h-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-300 ease-out rounded-full"
                                    style={{
                                        width: `${uploadProgress}%`
                                    }}
                                />
                            </div>
                        </div>
                    )}

                    <button
                        onClick={() => handleUploadAndProcess()}
                        disabled={isUploading || isProcessing}
                        className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                    >
                        {isUploading && <Loader2 className="animate-spin mr-2" size={20} />}
                        {isProcessing && <Loader2 className="animate-spin mr-2" size={20} />}
                        {isUploading
                            ? `Uploading... ${uploadProgress}%`
                            : isProcessing
                                ? 'Processing...'
                                : 'Upload & Process'}
                    </button>
                </div>
            )}

            {/* Processing Status */}
            {processingStatus && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold text-gray-900">Processing Status</h3>
                        {processingStatus.status === 'completed' && (
                            <CheckCircle className="text-green-500" size={24} />
                        )}
                        {processingStatus.status === 'failed' && (
                            <XCircle className="text-red-500" size={24} />
                        )}
                        {processingStatus.status === 'processing' && (
                            <Loader2 className="animate-spin text-blue-500" size={24} />
                        )}
                    </div>

                    {/* Progress Bar */}
                    {processingStatus.status === 'processing' && processingStatus.progress && (
                        <div className="mb-4">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-sm font-medium text-gray-700">
                                    Progress: {processingStatus.progress.processed || 0} / {processingStatus.progress.total || 0}
                                </span>
                                <span className="text-sm font-medium text-blue-600">
                                    {Math.round(((processingStatus.progress.processed || 0) / (processingStatus.progress.total || 1)) * 100)}%
                                </span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
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

                                // Calculate estimated time if we have progress
                                if (processed > 0 && remaining > 0 && (processingStatus as any).start_time) {
                                    const startTime = new Date((processingStatus as any).start_time).getTime();
                                    const now = Date.now();
                                    const elapsedSeconds = (now - startTime) / 1000;
                                    const avgTimePerFile = elapsedSeconds / processed;
                                    const estimatedSecondsRemaining = Math.ceil(avgTimePerFile * remaining);

                                    const minutes = Math.floor(estimatedSecondsRemaining / 60);
                                    const seconds = estimatedSecondsRemaining % 60;

                                    return (
                                        <p className="text-xs text-blue-600 mt-2 font-medium">
                                            ⏱️ ~{minutes > 0 ? `${minutes}m ` : ''}{seconds}s remaining
                                        </p>
                                    );
                                }
                                return null;
                            })()}
                            {(processingStatus as any).current_file && (
                                <p className="text-xs text-gray-600 mt-2 truncate">
                                    Processing: {(processingStatus as any).current_file}
                                </p>
                            )}
                        </div>
                    )}

                    <div className="space-y-3">
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Total Files:</span>
                            <span className="font-medium">{processingStatus.progress?.total || 0}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Processed:</span>
                            <span className="font-medium text-green-600">
                                {processingStatus.progress?.processed || 0}
                            </span>
                        </div>
                        {(processingStatus.progress?.failed || 0) > 0 && (
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-600">Failed:</span>
                                <span className="font-medium text-red-600">
                                    {processingStatus.progress?.failed || 0}
                                </span>
                            </div>
                        )}
                        <div className="pt-3 border-t border-gray-200">
                            <p className="text-sm text-gray-700">{processingStatus.message}</p>
                        </div>
                    </div>

                    {processingStatus.status === 'completed' && (
                        <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                            <p className="text-sm font-medium text-green-800 mb-3">
                                ✓ Processing complete! Go to Check Pending Sales to verify the extracted data.
                            </p>
                            <button
                                onClick={() => navigate('/sales/review')}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-4 rounded-lg transition flex items-center justify-center gap-2"
                            >
                                <CheckCircle size={18} />
                                Check Pending Sales
                            </button>
                        </div>
                    )}
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
        </div>
    );
};

export default UploadPage;
