import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

// Status for a specific section (Inventory or Sales)
export interface SectionStatus {
    isUploading: boolean;
    processingCount: number; // Currently processing
    totalProcessing: number; // Total files in current batch
    reviewCount: number;     // Waiting for review
    syncCount: number;       // Ready to sync/finish
    isComplete: boolean;     // Recently completed processing (Green Tick)
}

// Initial state for a section
const initialSectionStatus: SectionStatus = {
    isUploading: false,
    processingCount: 0,
    totalProcessing: 0,
    reviewCount: 0,
    syncCount: 0,
    isComplete: false,
};

interface GlobalStatusContextType {
    inventory: SectionStatus;
    sales: SectionStatus;
    setInventoryStatus: (status: Partial<SectionStatus>) => void;
    setSalesStatus: (status: Partial<SectionStatus>) => void;
}

const GlobalStatusContext = createContext<GlobalStatusContextType | undefined>(undefined);

export const GlobalStatusProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [inventory, setInventory] = useState<SectionStatus>(initialSectionStatus);
    const [sales, setSales] = useState<SectionStatus>(initialSectionStatus);

    const setInventoryStatus = useCallback((status: Partial<SectionStatus>) => {
        console.log('[🔵 INVENTORY STATUS UPDATE]', status);
        setInventory(prev => ({ ...prev, ...status }));
    }, []);

    const setSalesStatus = useCallback((status: Partial<SectionStatus>) => {
        console.log('[🟢 SALES STATUS UPDATE]', status);
        setSales(prev => ({ ...prev, ...status }));
    }, []);



    return (
        <GlobalStatusContext.Provider value={{ inventory, sales, setInventoryStatus, setSalesStatus }}>
            {children}
        </GlobalStatusContext.Provider>
    );
};

export const useGlobalStatus = () => {
    const context = useContext(GlobalStatusContext);
    if (!context) {
        throw new Error('useGlobalStatus must be used within a GlobalStatusProvider');
    }
    return context;
};
