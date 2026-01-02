import React, { useState } from 'react';
import { X } from 'lucide-react';

/**
 * Bounding box coordinates in normalized format (0-1 range)
 */
interface BBox {
    x: number;        // Normalized x position (0-1)
    y: number;        // Normalized y position (0-1)
    width: number;    // Normalized width (0-1)
    height: number;   // Normalized height (0-1)
}

/**
 * Props for ReceiptThumbnail component
 */
interface ReceiptThumbnailProps {
    imageUrl: string;
    bboxes?: Record<string, BBox | null>;
    highlightFields?: string[];
    width?: number;
}

/**
 * Color mapping for different field types
 */
const FIELD_COLORS: Record<string, string> = {
    date: '#10b981',              // Green
    receipt_number: '#3b82f6',    // Blue
    description: '#8b5cf6',       // Purple
    quantity: '#f59e0b',          // Amber
    rate: '#ef4444',              // Red
    amount: '#ec4899',            // Pink
};

/**
 * ReceiptThumbnail component displays a receipt image with bounding box overlays
 * highlighting specific fields for quick visual verification.
 * 
 * Click to expand to full size in a modal.
 */
const ReceiptThumbnail: React.FC<ReceiptThumbnailProps> = ({
    imageUrl,
    bboxes = {},
    highlightFields = [],
    width = 200  // Increased from 120 to 200 for better visibility
}) => {
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imageError, setImageError] = useState(false);
    const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Handle image load to get natural dimensions
    const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        const img = e.currentTarget;
        setImageDimensions({
            width: img.naturalWidth,
            height: img.naturalHeight
        });
        setImageLoaded(true);
    };

    const handleImageError = () => {
        setImageError(true);
    };

    // Calculate display height maintaining aspect ratio
    const displayHeight = imageDimensions.height > 0
        ? (width / imageDimensions.width) * imageDimensions.height
        : width * 1.4; // Fallback aspect ratio

    // Filter bboxes to only show highlighted fields
    const activeBboxes = highlightFields
        .map(field => ({
            field,
            bbox: bboxes[field] || bboxes[`${field}_bbox`],
            color: FIELD_COLORS[field] || '#6b7280'
        }))
        .filter(item => item.bbox !== null && item.bbox !== undefined);

    if (!imageUrl) {
        return (
            <div
                className="flex items-center justify-center bg-gray-100 rounded border border-gray-300"
                style={{ width, height: displayHeight }}
            >
                <span className="text-gray-400 text-xs">No image</span>
            </div>
        );
    }

    if (imageError) {
        return (
            <div
                className="flex items-center justify-center bg-red-50 rounded border border-red-300"
                style={{ width, height: displayHeight }}
            >
                <span className="text-red-400 text-xs">⚠️ Error</span>
            </div>
        );
    }

    return (
        <>
            {/* Thumbnail - Click to expand */}
            <div
                className="relative inline-block rounded overflow-hidden border border-gray-300 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
                style={{ width, height: displayHeight || width * 1.4 }}
                onClick={() => setIsModalOpen(true)}
                title="Click to view full size"
            >
                {/* Receipt Image */}
                <img
                    src={imageUrl}
                    alt="Receipt thumbnail"
                    onLoad={handleImageLoad}
                    onError={handleImageError}
                    className="absolute inset-0 w-full h-full object-cover"
                    style={{ opacity: imageLoaded ? 1 : 0.3 }}
                />

                {/* Loading indicator */}
                {!imageLoaded && !imageError && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
                        <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-300 border-t-blue-600" />
                    </div>
                )}

                {/* Bounding Box Overlays */}
                {imageLoaded && activeBboxes.length > 0 && (
                    <svg
                        className="absolute inset-0 w-full h-full pointer-events-none"
                        viewBox="0 0 1 1"
                        preserveAspectRatio="none"
                        style={{ zIndex: 10 }}
                    >
                        {activeBboxes.map(({ field, bbox, color }) => {
                            if (!bbox) return null;

                            return (
                                <g key={field}>
                                    {/* Semi-transparent fill */}
                                    <rect
                                        x={bbox.x}
                                        y={bbox.y}
                                        width={bbox.width}
                                        height={bbox.height}
                                        fill={color}
                                        fillOpacity="0.15"
                                        stroke={color}
                                        strokeWidth="0.004"
                                        strokeOpacity="0.8"
                                        rx="0.005"
                                    />
                                </g>
                            );
                        })}
                    </svg>
                )}

                {/* Legend (small dots indicating which fields are highlighted) */}
                {imageLoaded && activeBboxes.length > 0 && (
                    <div className="absolute bottom-1 left-1 flex gap-1 pointer-events-none">
                        {activeBboxes.map(({ field, color }) => (
                            <div
                                key={field}
                                className="w-2 h-2 rounded-full border border-white shadow-sm"
                                style={{ backgroundColor: color }}
                                title={field}
                            />
                        ))}
                    </div>
                )}

                {/* Click hint overlay */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity bg-black bg-opacity-30">
                    <span className="text-white text-xs font-medium bg-black bg-opacity-50 px-2 py-1 rounded">
                        Click to expand
                    </span>
                </div>
            </div>

            {/* Full Size Modal */}
            {isModalOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4"
                    onClick={() => setIsModalOpen(false)}
                >
                    <div
                        className="relative max-w-4xl max-h-full"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Close button */}
                        <button
                            onClick={() => setIsModalOpen(false)}
                            className="absolute -top-10 right-0 text-white hover:text-gray-300 transition"
                        >
                            <X size={32} />
                        </button>

                        {/* Full-size image with bboxes */}
                        <div className="relative bg-white rounded-lg shadow-2xl max-h-[90vh] overflow-auto">
                            <img
                                src={imageUrl}
                                alt="Receipt full size"
                                className="w-full h-auto"
                                style={{ maxHeight: '90vh' }}
                            />

                            {/* Bounding boxes on full image */}
                            {activeBboxes.length > 0 && (
                                <svg
                                    className="absolute inset-0 w-full h-full pointer-events-none"
                                    viewBox="0 0 1 1"
                                    preserveAspectRatio="none"
                                >
                                    {activeBboxes.map(({ field, bbox, color }) => {
                                        if (!bbox) return null;

                                        return (
                                            <g key={field}>
                                                <rect
                                                    x={bbox.x}
                                                    y={bbox.y}
                                                    width={bbox.width}
                                                    height={bbox.height}
                                                    fill={color}
                                                    fillOpacity="0.2"
                                                    stroke={color}
                                                    strokeWidth="0.003"
                                                    strokeOpacity="0.9"
                                                    rx="0.003"
                                                />
                                            </g>
                                        );
                                    })}
                                </svg>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default ReceiptThumbnail;
