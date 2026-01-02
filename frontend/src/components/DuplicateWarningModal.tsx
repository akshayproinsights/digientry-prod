import React, { useState } from 'react';
import { AlertTriangle, X, FileImage, Database } from 'lucide-react';

interface DuplicateWarningModalProps {
    isOpen: boolean;
    duplicateData: any;
    fileName: string;
    currentIndex?: number;
    totalDuplicates?: number;
    onUploadAnyway: () => void;
    onSkip: () => void;
}

const DuplicateWarningModal: React.FC<DuplicateWarningModalProps> = ({
    isOpen,
    duplicateData,
    fileName,
    currentIndex = 0,
    totalDuplicates = 1,
    onUploadAnyway,
    onSkip,
}) => {
    const [isClosing, setIsClosing] = useState(false);

    if (!isOpen) return null;

    const handleClose = () => {
        setIsClosing(true);
        setTimeout(() => {
            setIsClosing(false);
            onSkip();
        }, 200);
    };

    // Extract filename from full path
    const extractFileName = (fileKey: string) => {
        if (!fileKey) return 'Unknown file';
        const parts = fileKey.split('/');
        const fullName = parts[parts.length - 1];
        // Remove timestamp prefix (e.g., "20251231_143045_")
        return fullName.replace(/^\d{8}_\d{6}_/, '');
    };

    const newFileName = extractFileName(fileName);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm"
                onClick={handleClose}
            />

            {/* Modal */}
            <div className={`relative bg-white rounded-2xl shadow-2xl max-w-3xl w-full mx-4 overflow-hidden transition-all ${isClosing ? 'scale-95 opacity-0' : 'scale-100 opacity-100'}`}>
                {/* Header */}
                <div className="bg-gradient-to-r from-yellow-500 to-amber-500 px-6 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <div className="bg-white rounded-full p-2">
                                <AlertTriangle className="text-yellow-600" size={24} />
                            </div>
                            <div>
                                <h2 className="text-2xl font-bold text-white">
                                    Duplicate Invoice Detected
                                </h2>
                                {totalDuplicates > 1 && (
                                    <p className="text-white text-sm mt-1">
                                        Duplicate {currentIndex + 1} of {totalDuplicates}
                                    </p>
                                )}
                            </div>
                        </div>
                        <button
                            onClick={handleClose}
                            className="text-white hover:bg-white hover:bg-opacity-20 rounded-full p-2 transition"
                        >
                            <X size={24} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 space-y-4">
                    {/* Image Comparison Section */}
                    <div className="grid grid-cols-2 gap-4">
                        {/* New Upload Image Preview */}
                        <div className="text-center">
                            <p className="text-sm font-semibold text-blue-700 mb-2">📤 New Uploaded</p>
                            <div
                                onClick={async () => {
                                    try {
                                        // Import uploadAPI
                                        const { uploadAPI } = await import('../services/api');
                                        // Generate presigned URL for the uploaded file
                                        const url = await uploadAPI.getFileUrl(fileName);
                                        window.open(url, '_blank');
                                    } catch (error) {
                                        console.error('Failed to open image:', error);
                                        alert('Failed to open image. Please try again.');
                                    }
                                }}
                                className="bg-blue-100 rounded-lg p-4 border-2 border-blue-300 cursor-pointer hover:bg-blue-200"
                            >
                                <FileImage className="mx-auto text-blue-600 mb-2" size={48} />
                                <p className="text-xs text-gray-600 break-all px-2">{newFileName}</p>
                                <p className="text-xs text-blue-600 mt-2 font-medium">Click to view image</p>
                            </div>
                        </div>

                        {/* Existing Database Image Preview */}
                        <div className="text-center">
                            <p className="text-sm font-semibold text-green-700 mb-2">💾 Already in DB</p>
                            <div
                                onClick={() => {
                                    const receiptLink = duplicateData?.receipt_link;
                                    if (receiptLink) {
                                        window.open(receiptLink, '_blank');
                                    }
                                }}
                                className={`bg-green-100 rounded-lg p-4 border-2 border-green-300 ${duplicateData?.receipt_link ? 'cursor-pointer hover:bg-green-200' : 'cursor-not-allowed opacity-60'}`}
                            >
                                <Database className="mx-auto text-green-600 mb-2" size={48} />
                                <div className="space-y-1">
                                    <p className="text-xs text-gray-700"><strong>Receipt:</strong> {duplicateData?.receipt_number || 'N/A'}</p>
                                    <p className="text-xs text-gray-700"><strong>Date:</strong> {duplicateData?.date || 'N/A'}</p>
                                    <p className="text-xs text-gray-700"><strong>Customer:</strong> {duplicateData?.customer_name || 'N/A'}</p>
                                    <p className="text-xs text-blue-600 mt-2 font-medium">Click to view image</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-3 pt-2">
                        <button
                            onClick={() => {
                                setIsClosing(true);
                                setTimeout(() => {
                                    setIsClosing(false);
                                    onUploadAnyway();
                                }, 200);
                            }}
                            className="flex-1 bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white font-semibold py-3 px-4 rounded-lg transition shadow-md hover:shadow-lg"
                        >
                            Replace Old Record
                        </button>
                        <button
                            onClick={handleClose}
                            className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold py-3 px-4 rounded-lg transition shadow-md hover:shadow-lg"
                        >
                            Skip This File
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DuplicateWarningModal;
