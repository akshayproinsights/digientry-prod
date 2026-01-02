/**
 * Validation utility functions for form fields
 * Provides consistent validation across all pages
 */

export const validateReceiptNumber = (value: string): string | null => {
    if (!value || value.trim() === '') {
        return 'Receipt number required';
    }
    if (!/^[a-zA-Z0-9-/]+$/.test(value)) {
        return 'Only letters, numbers, hyphens, and slashes allowed';
    }
    return null;
};

export const validateDate = (value: string): string | null => {
    if (!value || value.trim() === '') {
        return 'Date required';
    }
    // DD-MMM-YYYY format (e.g., 01-Jan-2026)
    const dateRegex = /^\d{2}-[A-Za-z]{3}-\d{4}$/;
    if (!dateRegex.test(value)) {
        return 'Invalid format (use DD-MMM-YYYY, e.g., 01-Jan-2026)';
    }

    // Validate month abbreviation
    const validMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = value.split('-')[1];
    if (!validMonths.includes(month)) {
        return 'Invalid month abbreviation';
    }

    return null;
};

export const validatePositiveNumber = (value: string | number, fieldName: string): string | null => {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num)) {
        return `${fieldName} must be a valid number`;
    }
    if (num <= 0) {
        return `${fieldName} must be greater than 0`;
    }
    return null;
};

export const validateNotEmpty = (value: string, fieldName: string): string | null => {
    if (!value || value.trim() === '') {
        return `${fieldName} is required`;
    }
    return null;
};

/**
 * Get border color class based on field state
 */
export const getBorderColor = (state: 'idle' | 'editing' | 'saving' | 'saved' | 'error'): string => {
    switch (state) {
        case 'error':
            return 'border-red-500 ring-1 ring-red-500';
        case 'editing':
            return 'border-yellow-400 ring-1 ring-yellow-400';
        case 'saved':
            return 'border-green-500 ring-1 ring-green-500';
        case 'saving':
            return 'border-blue-400 ring-1 ring-blue-400';
        default:
            return 'border-gray-300';
    }
};

/**
 * Get background color class based on field state
 */
export const getBackgroundColor = (state: 'idle' | 'editing' | 'saving' | 'saved' | 'error'): string => {
    switch (state) {
        case 'error':
            return 'bg-red-50';
        case 'editing':
            return 'bg-yellow-50';
        case 'saved':
            return 'bg-green-50';
        default:
            return 'bg-white';
    }
};
