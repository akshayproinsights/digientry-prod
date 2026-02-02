import React from 'react';
import { Loader2 } from 'lucide-react';

interface SyncProgressModalProps {
    isOpen: boolean;
    stage: string;
    percentage: number;
    message: string;
    onClose?: () => void;
}

const SyncProgressModal: React.FC<SyncProgressModalProps> = ({ isOpen, stage, percentage, message, onClose }) => {
    if (!isOpen) return null;

    // Success State
    if (stage === 'success') {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm transition-all duration-300">
                <div className="bg-white rounded-xl shadow-2xl p-8 max-w-sm w-full mx-4 transform transition-all scale-100 opacity-100">
                    <div className="text-center">
                        <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-green-100 mb-6">
                            <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                        </div>

                        <h2 className="text-2xl font-bold text-gray-900 mb-2">Sync Complete!</h2>
                        <p className="text-gray-600 mb-8">{message}</p>

                        <button
                            onClick={onClose}
                            className="w-full inline-flex justify-center items-center px-4 py-3 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-colors"
                        >
                            Continue
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    const stages = [
        { id: 'reading', label: 'Reading Data', percentage: 5 },
        { id: 'saving_invoices', label: 'Saving Invoices', percentage: 60 },
        { id: 'building_verified', label: 'Building Verified', percentage: 40 },
        { id: 'saving_verified', label: 'Saving Verified', percentage: 80 },
        { id: 'cleanup', label: 'Cleanup', percentage: 95 },
        { id: 'complete', label: 'Complete', percentage: 100 }
    ];

    const currentStageIndex = stages.findIndex(s => s.id === stage);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-white rounded-lg shadow-2xl p-8 max-w-md w-full mx-4">
                <div className="text-center">
                    <h2 className="text-2xl font-bold text-gray-900 mb-4">Syncing & Finalizing</h2>

                    {/* Progress Bar */}
                    <div className="relative w-full h-3 bg-gray-200 rounded-full overflow-hidden mb-6">
                        <div
                            className="absolute top-0 left-0 h-full bg-gradient-to-r from-green-500 to-green-600 transition-all duration-300 ease-out"
                            style={{ width: `${percentage}%` }}
                        ></div>
                    </div>

                    {/* Percentage */}
                    <div className="text-3xl font-bold text-green-600 mb-4">
                        {percentage}%
                    </div>

                    {/* Stage Indicators */}
                    <div className="flex justify-between mb-6">
                        {stages.slice(0, -1).map((s, index) => (
                            <div key={s.id} className="flex flex-col items-center">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${index <= currentStageIndex
                                    ? 'bg-green-600 text-white'
                                    : 'bg-gray-300 text-gray-600'
                                    }`}>
                                    {index < currentStageIndex ? '✓' : index + 1}
                                </div>
                                <div className="text-xs mt-1 text-gray-600">{s.label}</div>
                            </div>
                        ))}
                    </div>

                    {/* Current Message */}
                    <div className="flex items-center justify-center text-gray-700 mb-4">
                        <Loader2 className="animate-spin mr-2" size={20} />
                        <span>{message}</span>
                    </div>

                    <p className="text-sm text-gray-500">Please wait while we process your changes...</p>
                </div>
            </div>
        </div>
    );
};

export default SyncProgressModal;
