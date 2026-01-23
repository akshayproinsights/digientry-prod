import React, { useState, useRef, useEffect } from 'react';
import { X } from 'lucide-react';

/**
 * Bounding box coordinates in normalized format (0-1 range)
 */
interface BBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Props for CroppedFieldPreview component
 */
interface CroppedFieldPreviewProps {
    imageUrl: string;
    bboxes: Record<string, BBox>;
    fields: string[]; // e.g., ['date', 'receipt_number']
    combineFields?: boolean; // If true, merge all fields into one horizontal strip
    fieldLabels?: Record<string, string>; // e.g., {'date': 'Date', 'receipt_number': 'Receipt #'}
    padding?: number; // Extra padding around bbox (0-0.1 range)
}

/**
 * CroppedFieldPreview displays only the cropped portions of an image
 * based on bounding box coordinates, showing just the extracted fields.
 */
const CroppedFieldPreview: React.FC<CroppedFieldPreviewProps> = ({
    imageUrl,
    bboxes,
    fields,
    combineFields = false,
    fieldLabels = {},
    padding = 0.02 // 2% padding around each field
}) => {
    const [imageLoaded, setImageLoaded] = useState(false);
    const [imageError, setImageError] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
    const combinedCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const imgRef = useRef<HTMLImageElement | null>(null);

    useEffect(() => {
        if (imageLoaded && imgRef.current) {
            if (combineFields && combinedCanvasRef.current) {
                // COMBINED MODE: Merge all bboxes into one horizontal strip
                const validBboxes = fields
                    .map(field => bboxes[field] || bboxes[`${field}_bbox`])
                    .filter(bbox => bbox !== null && bbox !== undefined);

                if (validBboxes.length === 0) return;

                // Calculate combined bounding box (min x/y, max x+width/y+height)
                const minX = Math.min(...validBboxes.map(b => b.x));
                const minY = Math.min(...validBboxes.map(b => b.y));
                const maxX = Math.max(...validBboxes.map(b => b.x + b.width));
                const maxY = Math.max(...validBboxes.map(b => b.y + b.height));

                const combinedBbox = {
                    x: minX,
                    y: minY,
                    width: maxX - minX,
                    height: maxY - minY
                };

                // Apply padding
                const paddedX = Math.max(0, combinedBbox.x - padding);
                const paddedY = Math.max(0, combinedBbox.y - padding);
                const paddedWidth = Math.min(1 - paddedX, combinedBbox.width + 2 * padding);
                const paddedHeight = Math.min(1 - paddedY, combinedBbox.height + 2 * padding);

                const img = imgRef.current;
                const canvas = combinedCanvasRef.current;
                const ctx = canvas.getContext('2d');
                if (!ctx) return;

                // Convert to pixel coords
                const sx = paddedX * img.naturalWidth;
                const sy = paddedY * img.naturalHeight;
                const sWidth = paddedWidth * img.naturalWidth;
                const sHeight = paddedHeight * img.naturalHeight;

                canvas.width = sWidth;
                canvas.height = sHeight;

                ctx.drawImage(
                    img,
                    sx, sy, sWidth, sHeight,
                    0, 0, sWidth, sHeight
                );
            } else {
                // INDIVIDUAL MODE: Draw each field separately
                fields.forEach(field => {
                    const bbox = bboxes[field] || bboxes[`${field}_bbox`];
                    const canvas = canvasRefs.current[field];

                    if (bbox && canvas && imgRef.current) {
                        const img = imgRef.current;
                        const ctx = canvas.getContext('2d');
                        if (!ctx) return;

                        const paddedX = Math.max(0, bbox.x - padding);
                        const paddedY = Math.max(0, bbox.y - padding);
                        const paddedWidth = Math.min(1 - paddedX, bbox.width + 2 * padding);
                        const paddedHeight = Math.min(1 - paddedY, bbox.height + 2 * padding);

                        const sx = paddedX * img.naturalWidth;
                        const sy = paddedY * img.naturalHeight;
                        const sWidth = paddedWidth * img.naturalWidth;
                        const sHeight = paddedHeight * img.naturalHeight;

                        canvas.width = sWidth;
                        canvas.height = sHeight;

                        ctx.drawImage(
                            img,
                            sx, sy, sWidth, sHeight,
                            0, 0, sWidth, sHeight
                        );
                    }
                });
            }
        }
    }, [imageLoaded, bboxes, fields, combineFields, padding]);

    const handleImageLoad = () => {
        setImageLoaded(true);
    };

    const handleImageError = () => {
        setImageError(true);
    };

    if (!imageUrl) {
        return <span className="text-gray-400 text-xs">No image</span>;
    }

    if (imageError) {
        return <span className="text-red-400 text-xs">⚠️ Error loading</span>;
    }

    return (
        <>
            {/* Hidden image for canvas processing */}
            <img
                ref={imgRef}
                src={imageUrl}
                alt="Receipt source"
                onLoad={handleImageLoad}
                onError={handleImageError}
                className="hidden"
            />

            {/* Cropped field previews */}
            {combineFields ? (
                // Combined horizontal strip
                <div
                    className="border border-gray-300 rounded bg-white shadow-sm cursor-pointer hover:shadow-md transition-shadow overflow-hidden w-full"
                    onClick={() => setIsModalOpen(true)}
                    title="Click to view full receipt"
                >
                    {!imageLoaded ? (
                        <div className="flex items-center justify-center h-12 bg-gray-100">
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-300 border-t-blue-600" />
                        </div>
                    ) : (
                        <canvas
                            ref={combinedCanvasRef}
                            className="w-full h-auto"
                            style={{ imageRendering: 'auto' }}
                        />
                    )}
                </div>
            ) : (
                // Individual field crops
                <div className="flex flex-col gap-2">
                    {fields.map(field => {
                        const bbox = bboxes[field] || bboxes[`${field}_bbox`];
                        const label = fieldLabels[field] || field;

                        if (!bbox) {
                            return (
                                <div key={field} className="text-xs text-gray-400">
                                    {label}: N/A
                                </div>
                            );
                        }

                        return (
                            <div key={field} className="flex flex-col gap-1">
                                <span className="text-[10px] text-gray-500 uppercase font-medium">
                                    {label}
                                </span>
                                <div
                                    className="border border-gray-300 rounded bg-white shadow-sm cursor-pointer hover:shadow-md transition-shadow overflow-hidden"
                                    onClick={() => setIsModalOpen(true)}
                                    title="Click to view full receipt"
                                >
                                    {!imageLoaded ? (
                                        <div className="flex items-center justify-center h-12 bg-gray-100">
                                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-300 border-t-blue-600" />
                                        </div>
                                    ) : (
                                        <canvas
                                            ref={el => canvasRefs.current[field] = el}
                                            className="w-full h-auto"
                                            style={{ imageRendering: 'auto' }}
                                        />
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Full image modal */}
            {isModalOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75 p-4"
                    onClick={() => setIsModalOpen(false)}
                >
                    <div
                        className="relative max-w-4xl max-h-full"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            onClick={() => setIsModalOpen(false)}
                            className="absolute -top-10 right-0 text-white hover:text-gray-300 transition"
                        >
                            <X size={32} />
                        </button>

                        <div className="relative bg-white rounded-lg shadow-2xl max-h-[90vh] overflow-auto">
                            <img
                                src={imageUrl}
                                alt="Receipt full size"
                                className="w-full h-auto"
                            />
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default CroppedFieldPreview;
