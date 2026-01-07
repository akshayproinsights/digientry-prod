import React, { useState } from 'react';
import { Upload as UploadIcon, X, FileImage, Loader2, CheckCircle, XCircle } from 'lucide-react';
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

    // Duplicate handling - queue-based approach
    const [duplicateQueue, setDuplicateQueue] = useState<any[]>([]);
    const [currentDuplicateIndex, setCurrentDuplicateIndex] = useState(0);
    const [showDuplicateModal, setShowDuplicateModal] = useState(false);
    const [duplicateInfo, setDuplicateInfo] = useState<any>(null);
    const [filesToSkip, setFilesToSkip] = useState<string[]>([]);
    const [filesToReplace, setFilesToReplace] = useState<any[]>([]);

    const queryClient = useQueryClient();

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        const droppedFiles = Array.from(e.dataTransfer.files).filter((file) =>
            file.type.startsWith('image/')
        );

        setFiles((prev) => [...prev, ...droppedFiles]);
    };

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            const selectedFiles = Array.from(e.target.files);
            setFiles((prev) => [...prev, ...selectedFiles]);
        }
    };

    const removeFile = (index: number) => {
        setFiles((prev) => prev.filter((_, i) => i !== index));
    };

    const handleUploadAndProcess = async () => {
        if (files.length === 0) return;

        try {
            setIsUploading(true);
            setUploadProgress(0);

            // Upload files
            const response = await inventoryAPI.uploadFiles(files, (progressEvent) => {
                const percent = Math.round((progressEvent.loaded / progressEvent.total) * 100);
                setUploadProgress(percent);
            });

            setIsUploading(false);
            setUploadProgress(0);

            // Start processing
            setIsProcessing(true);
            const processResponse = await inventoryAPI.processInventory(response.uploaded_files);
            setProcessingStatus(processResponse);

            // Poll for status
            const taskId = processResponse.task_id;
            const pollInterval = setInterval(async () => {
                const status = await inventoryAPI.getProcessStatus(taskId);
                setProcessingStatus(status);

                // Handle duplicate detection - CRITICAL: Check during processing, not just at completion
                if (status.status === 'duplicate_detected' && status.duplicates && status.duplicates.length > 0) {
                    clearInterval(pollInterval);
                    setIsProcessing(false);

                    // Show duplicate modal
                    setDuplicateQueue(status.duplicates);
                    setCurrentDuplicateIndex(0);
                    setDuplicateInfo(status.duplicates[0]);
                    setShowDuplicateModal(true);
                    return;
                }

                // Check if processing is complete or failed
                if (status.status === 'completed' || status.status === 'failed') {
                    clearInterval(pollInterval);
                    setIsProcessing(false);

                    if (status.status === 'completed') {
                        setFiles([]);
                        queryClient.invalidateQueries({ queryKey: ['inventory'] });
                    }
                }
            }, 1000);
        } catch (error) {
            console.error('Error:', error);
            setIsUploading(false);
            setIsProcessing(false);
        }
    };

    // Handle duplicate modal actions - queue-based approach
    const handleSkipDuplicate = () => {
        const currentDup = duplicateQueue[currentDuplicateIndex];
        const updatedSkip = [...filesToSkip, currentDup.file_key];
        setFilesToSkip(updatedSkip);
        moveToNextDuplicate(updatedSkip, filesToReplace);
    };

    const handleReplaceOldRecord = () => {
        // Add current duplicate to replace list and immediately move to next
        const currentDup = duplicateQueue[currentDuplicateIndex];
        const updatedReplace = [...filesToReplace, currentDup];
        setFilesToReplace(updatedReplace);
        moveToNextDuplicate(filesToSkip, updatedReplace);
    };

    const moveToNextDuplicate = (skipList: string[], replaceList: any[]) => {
        const nextIndex = currentDuplicateIndex + 1;

        if (nextIndex < duplicateQueue.length) {
            // Show next duplicate - modal stays open
            setCurrentDuplicateIndex(nextIndex);
            setDuplicateInfo(duplicateQueue[nextIndex]);
        } else {
            // All duplicates handled - close modal and process
            setShowDuplicateModal(false);
            setDuplicateQueue([]);
            setCurrentDuplicateIndex(0);
            setDuplicateInfo(null);

            // Process replacement files if any
            processReplacementFiles(skipList, replaceList);
        }
    };

    const processReplacementFiles = async (skipList: string[], replaceList: any[]) => {
        try {
            if (replaceList.length > 0) {
                setIsProcessing(true);
                setProcessingStatus({
                    task_id: '',
                    status: 'processing',
                    progress: { total: replaceList.length, processed: 0, failed: 0 },
                    message: 'Replacing old records and processing...'
                });

                let processedCount = 0;
                let failedCount = 0;

                for (const dup of replaceList) {
                    try {
                        // Step 1: Delete old records with same image_hash
                        const deleteResponse = await inventoryAPI.deleteByImageHash(dup.image_hash);

                        if (!deleteResponse.success) {
                            throw new Error('Failed to delete old record');
                        }

                        // Step 2: Reprocess the file
                        const processResponse = await inventoryAPI.processInventory([dup.file_key]);
                        const taskId = processResponse.task_id;

                        // Step 3: Poll for completion
                        let attempts = 0;
                        const maxAttempts = 30;

                        while (attempts < maxAttempts) {
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            attempts++;

                            const status = await inventoryAPI.getProcessStatus(taskId);

                            if (status.status === 'completed') {
                                processedCount++;
                                break;
                            } else if (status.status === 'failed') {
                                failedCount++;
                                break;
                            }
                        }

                        // Update progress
                        setProcessingStatus({
                            task_id: '',
                            status: 'processing',
                            progress: {
                                total: replaceList.length,
                                processed: processedCount,
                                failed: failedCount
                            },
                            message: `Processing ${processedCount + failedCount}/${replaceList.length}...`
                        });

                    } catch (error) {
                        console.error('Error processing replacement:', error);
                        failedCount++;
                    }
                }

                // Final status
                finishProcessing(skipList, processedCount, failedCount);
            } else {
                // No files to replace, just show skipped status
                finishProcessing(skipList, 0, 0);
            }
        } catch (error) {
            console.error('Error in processReplacementFiles:', error);
            setIsProcessing(false);
        }
    };

    const finishProcessing = (skipList: string[], replacedCount: number, failedCount: number) => {
        const skippedCount = skipList.length;
        const totalProcessed = replacedCount;

        let message = '';
        if (totalProcessed > 0 && skippedCount > 0) {
            message = `Processing complete. ${totalProcessed} replaced, ${skippedCount} skipped.`;
        } else if (totalProcessed > 0) {
            message = `Processing complete. ${totalProcessed} invoice${totalProcessed !== 1 ? 's' : ''} replaced.`;
        } else if (skippedCount > 0) {
            message = `Processing complete. ${skippedCount} duplicate${skippedCount !== 1 ? 's were' : ' was'} skipped.`;
        } else {
            message = 'Processing complete.';
        }

        if (failedCount > 0) {
            message += ` ${failedCount} failed.`;
        }

        setProcessingStatus({
            task_id: '',
            status: 'completed',
            progress: { total: totalProcessed + skippedCount, processed: totalProcessed, failed: failedCount },
            message
        });

        setIsProcessing(false);
        setFiles([]);
        setFilesToSkip([]);
        setFilesToReplace([]);
        queryClient.invalidateQueries({ queryKey: ['inventory'] });
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-gray-900">New Parts Upload & Process</h1>
                <p className="text-gray-600 mt-2">
                    Upload vendor invoice images for inventory processing
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
                    Drop vendor invoice images here
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

                    {/* Upload Progress */}
                    {isUploading && uploadProgress > 0 && (
                        <div className="mt-4">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-sm font-medium text-gray-700">
                                    Uploading files...
                                </span>
                                <span className="text-sm font-medium text-blue-600">
                                    {uploadProgress}%
                                </span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-3">
                                <div
                                    className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all"
                                    style={{ width: `${uploadProgress}%` }}
                                />
                            </div>
                        </div>
                    )}

                    <button
                        onClick={handleUploadAndProcess}
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
                        <div className="pt-3 border-t border-gray-200">
                            <p className="text-sm text-gray-700">{processingStatus.message}</p>
                        </div>
                    </div>

                    {processingStatus.status === 'completed' && (
                        <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                            <p className="text-sm font-medium text-green-800 mb-3">
                                ✓ Processing complete! Review the extracted data in Vendor Verified Invoices.
                            </p>
                            <button
                                onClick={() => navigate('/inventory/verify')}
                                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 px-4 rounded-lg transition flex items-center justify-center gap-2"
                            >
                                <CheckCircle size={18} />
                                Go to Vendor Verified Invoices
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Duplicate Warning Modal */}
            <DuplicateWarningModal
                isOpen={showDuplicateModal}
                duplicateData={duplicateInfo?.existing_record}
                fileName={duplicateInfo?.file_key || ''}
                currentIndex={currentDuplicateIndex}
                totalDuplicates={duplicateQueue.length}
                onUploadAnyway={handleReplaceOldRecord}
                onSkip={handleSkipDuplicate}
            />
        </div>
    );
};

export default InventoryUploadPage;
