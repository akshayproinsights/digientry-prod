import React, { useState } from 'react';

interface StatusToggleProps {
    status: string;
    onChange: (newStatus: string) => void;
    disabled?: boolean;
}

const StatusToggle: React.FC<StatusToggleProps> = ({ status, onChange, disabled = false }) => {
    const [showSaved, setShowSaved] = useState(false);
    const isPending = status === 'Pending';

    const handleStatusChange = (newStatus: string) => {
        if (disabled || status === newStatus) return;

        onChange(newStatus);

        // Show "Saved!" message for 2 seconds
        setShowSaved(true);
        setTimeout(() => {
            setShowSaved(false);
        }, 2000);
    };

    return (
        <div className="flex items-center gap-2">
            {/* Segmented Control - Both options visible */}
            <div className="inline-flex rounded-lg border border-gray-300 bg-gray-50 p-1">
                {/* Pending Button */}
                <button
                    onClick={() => handleStatusChange('Pending')}
                    disabled={disabled}
                    className={`
                        px-3 py-1.5 rounded-md font-medium text-sm
                        transition-all duration-200 ease-in-out
                        disabled:opacity-50 disabled:cursor-not-allowed
                        ${isPending
                            ? 'bg-amber-500 text-white shadow-sm'  // More visible pending color
                            : 'bg-transparent text-gray-600 hover:bg-gray-100'
                        }
                    `}
                >
                    <span className="flex items-center gap-1">
                        <span className="text-base">⏳</span>
                        Pending
                    </span>
                </button>

                {/* Done Button */}
                <button
                    onClick={() => handleStatusChange('Done')}
                    disabled={disabled}
                    className={`
                        px-3 py-1.5 rounded-md font-medium text-sm
                        transition-all duration-200 ease-in-out
                        disabled:opacity-50 disabled:cursor-not-allowed
                        ${!isPending
                            ? 'bg-green-600 text-white shadow-sm'  // Solid, reassuring green
                            : 'bg-transparent text-gray-600 hover:bg-gray-100'
                        }
                    `}
                >
                    <span className="flex items-center gap-1">
                        <span className="text-base">✓</span>
                        Done
                    </span>
                </button>
            </div>

            {/* Save confirmation message */}
            {showSaved && (
                <span className="text-green-600 text-sm font-medium animate-fade-in">
                    ✓ Saved!
                </span>
            )}
        </div>
    );
};

export default StatusToggle;
