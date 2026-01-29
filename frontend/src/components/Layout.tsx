import React, { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import Sidebar from './Sidebar';
import SalesBackgroundPoller from './SalesBackgroundPoller';
import InventoryBackgroundPoller from './InventoryBackgroundPoller';




const Layout: React.FC = () => {
    const { user } = useAuth();
    const location = useLocation();

    // State for page-specific header actions (buttons, etc.)
    const [headerActions, setHeaderActions] = useState<React.ReactNode>(null);

    // Get time-based greeting (Good morning/afternoon/evening)
    const getTimeBasedGreeting = () => {
        const hour = new Date().getHours();

        if (hour >= 5 && hour < 12) {
            return 'Good morning';
        } else if (hour >= 12 && hour < 18) {
            return 'Good afternoon';
        } else {
            return 'Good evening';
        }
    };

    const getPageTitle = () => {
        const path = location.pathname;

        // Special case: Home page shows personalized greeting
        if (path === '/') {
            const greeting = getTimeBasedGreeting();
            return `${greeting}, ${user?.username || 'User'}`;
        }

        // Special case: Review Sales - hide Layout header completely
        if (path === '/sales/review') {
            return '';
        }

        // Map routes to page titles
        const titleMap: Record<string, string> = {
            '/sales/upload': 'Add Sales Bills',
            '/sales/verified': 'All Past Sales',
            '/inventory/stock': 'My Stock Register',
            '/inventory/upload': 'Add Purchase Bills',
            '/inventory/verify': 'All Past Purchases',
            '/inventory/mapped': 'Mapped Items',
        };

        return titleMap[path] || 'Dashboard';
    };

    return (
        <div className="flex h-screen bg-gray-50">
            <SalesBackgroundPoller />
            <InventoryBackgroundPoller />
            {/* Sidebar */}
            <Sidebar />

            {/* Main Content */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Unified Header - h-20 to match sidebar header */}
                {getPageTitle() && (
                    <header className="h-20 bg-white border-b border-gray-200 px-6 flex items-center justify-between">
                        {/* Page Title */}
                        <div>
                            <h1 className="text-2xl font-semibold text-gray-900">
                                {getPageTitle()}
                            </h1>
                        </div>

                        {/* Page Actions (set by child pages via context) */}
                        <div className="flex items-center gap-3">
                            {headerActions}
                        </div>
                    </header>
                )}

                {/* Page Content */}
                <main className="flex-1 overflow-auto p-6">
                    <Outlet context={{ setHeaderActions }} />
                </main>
                {/* Toast Notifications */}
                <Toaster
                    position="bottom-center"
                    toastOptions={{
                        duration: 4000,
                        success: { duration: 3000 },
                        error: { duration: 5000 },
                    }}
                />
            </div >
        </div >
    );
};

export default Layout;
