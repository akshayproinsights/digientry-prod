
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Minus } from 'lucide-react';
import { toast } from 'react-hot-toast';

interface StockStepperProps {
    currentStock: number;
    partNumber: string;
    onUpdate: (partNumber: string, newStock: number) => Promise<{ status_corrected?: boolean }>;
}

const StockStepper: React.FC<StockStepperProps> = ({ currentStock, partNumber, onUpdate }) => {
    const [value, setValue] = useState(currentStock);
    const [isFocused, setIsFocused] = useState(false);
    const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
    const debouncedUpdateRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Sync with external updates if we are not editing
    useEffect(() => {
        if (!isFocused && status !== 'saving') {
            setValue(currentStock);
        }
    }, [currentStock, isFocused, status]);

    const triggerUpdate = useCallback(async (newValue: number) => {
        setStatus('saving');

        try {
            const response = await onUpdate(partNumber, newValue);

            setStatus('success');
            setTimeout(() => setStatus('idle'), 2000);

            if (response?.status_corrected) {
                toast.success("Inventory Log Updated", {
                    id: `stock-update-${partNumber}`, // Prevent duplicates
                    duration: 3000,
                });
            }
        } catch (error) {
            console.error("Stock update failed", error);
            setStatus('error');
            toast.error("Failed to update stock");
            setValue(currentStock); // Revert on error
            setTimeout(() => setStatus('idle'), 3000);
        }
    }, [currentStock, onUpdate, partNumber]);

    const debouncedTrigger = useCallback((newValue: number) => {
        if (debouncedUpdateRef.current) {
            clearTimeout(debouncedUpdateRef.current);
        }

        debouncedUpdateRef.current = setTimeout(() => {
            triggerUpdate(newValue);
        }, 500);
    }, [triggerUpdate]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValueStr = e.target.value;
        if (newValueStr === '') {
            setValue(0); // or handle empty differently, but number input usually needs a number
            return;
        }

        const newValue = parseInt(newValueStr, 10);
        if (isNaN(newValue)) return;

        setValue(newValue);
        debouncedTrigger(newValue);
    };

    const handleIncrement = () => {
        const newValue = value + 1;
        setValue(newValue);
        // Instant update for buttons? Prompt says "Debouncing: If the user types rapidly". 
        // For buttons, typically we also debounce if user clicks fast, OR we specificially said "Clicking + or - increments/decrements immediately". 
        // "Optimistic UI: When the user changes the value, update the UI immediately".
        // I'll debounce the API call even for buttons to avoid spamming if they click 10 times in a second.
        debouncedTrigger(newValue);
    };

    const handleDecrement = () => {
        const newValue = value - 1;
        setValue(newValue);
        debouncedTrigger(newValue);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            handleIncrement();
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            handleDecrement();
        }
    };

    // Determine border color based on status
    let borderColor = 'border-transparent';
    let bgColor = 'bg-transparent';

    if (isFocused) {
        borderColor = 'border-indigo-400';
    } else if (status === 'success') {
        borderColor = 'border-green-500';
        bgColor = 'bg-green-50';
    } else if (status === 'error') {
        borderColor = 'border-red-500';
        bgColor = 'bg-red-50';
    }

    return (
        <div
            className={`group relative flex items-center justify-center w-32 h-10 rounded-lg border transition-all duration-200 ${borderColor} ${bgColor} hover:border-gray-300 hover:bg-gray-50`}
        >
            {/* Decrement Button */}
            <button
                onClick={handleDecrement}
                className="absolute left-0 w-8 h-full flex items-center justify-center text-gray-400 hover:text-indigo-600 active:scale-90 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                tabIndex={-1} // Skip tab for buttons, use arrow keys on input
                aria-label="Decrease stock"
            >
                <Minus size={16} strokeWidth={3} />
            </button>

            {/* Input */}
            <input
                type="number"
                value={value}
                onChange={handleChange}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                onKeyDown={handleKeyDown}
                className={`w-full text-center font-bold text-gray-800 bg-transparent outline-none appearance-none cursor-text md:text-sm text-base`}
                style={{ MozAppearance: 'textfield' }} // Hide native spinners
            />

            {/* Increment Button */}
            <button
                onClick={handleIncrement}
                className="absolute right-0 w-8 h-full flex items-center justify-center text-gray-400 hover:text-indigo-600 active:scale-90 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                tabIndex={-1}
                aria-label="Increase stock"
            >
                <Plus size={16} strokeWidth={3} />
            </button>

            {/* CSS to hide native spinners in Webkit */}
            <style>{`
                input[type=number]::-webkit-inner-spin-button, 
                input[type=number]::-webkit-outer-spin-button { 
                    -webkit-appearance: none; 
                    margin: 0; 
                }
            `}</style>
        </div>
    );
};

export default StockStepper;
