import React, { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import {
    LayoutDashboard,
    Upload,
    ClipboardCheck,
    CheckCircle,
    LogOut,
    Menu,
    ChevronLeft,
    ShoppingCart,
    Package,
    ChevronDown,
    ChevronRight,
    Warehouse
} from 'lucide-react';

interface NavItem {
    name: string;
    path?: string;
    icon: any;
    isSection?: boolean;
    children?: NavItem[];
}

const Layout: React.FC = () => {
    const { user, logout } = useAuth();
    const location = useLocation();
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    // Keep both sections expanded by default
    const [expandedSections, setExpandedSections] = useState<string[]>(['Sales', 'Inventory']);

    // State for page-specific header actions (buttons, etc.)
    const [headerActions, setHeaderActions] = useState<React.ReactNode>(null);

    const navigation: NavItem[] = [
        { name: 'Dashboard', path: '/', icon: LayoutDashboard },
        {
            name: 'Sales',
            icon: ShoppingCart,
            isSection: true,
            children: [
                { name: 'Add Sales Bills', path: '/sales/upload', icon: Upload },
                { name: 'Review Sales', path: '/sales/review', icon: ClipboardCheck },
                { name: 'All Past Sales', path: '/sales/verified', icon: CheckCircle },
            ]
        },
        {
            name: 'Inventory',
            icon: Package,
            isSection: true,
            children: [
                { name: 'My Stock Register', path: '/inventory/stock', icon: Warehouse },
                { name: 'Add Purchase Bills', path: '/inventory/upload', icon: Upload },
                { name: 'All Past Purchases', path: '/inventory/verify', icon: ClipboardCheck },
            ]
        },
    ];

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


    const toggleSection = (sectionName: string) => {
        setExpandedSections(prev =>
            prev.includes(sectionName)
                ? prev.filter(s => s !== sectionName)
                : [...prev, sectionName]
        );
    };

    const renderNavItem = (item: NavItem) => {
        const Icon = item.icon;

        // Section with children
        if (item.isSection && item.children) {
            const isExpanded = expandedSections.includes(item.name);
            const hasActiveChild = item.children.some(child => child.path === location.pathname);

            return (
                <div key={item.name}>
                    {/* Section Header */}
                    <Link
                        to={item.children[0].path!}
                        onClick={() => toggleSection(item.name)}
                        className={`flex items-center w-full ${isSidebarOpen ? 'px-4' : 'px-2 justify-center'
                            } py-3 rounded-lg transition ${hasActiveChild
                                ? 'bg-blue-600 text-white font-medium'
                                : 'text-gray-700 hover:bg-gray-100'
                            }`}
                        title={item.name}
                    >
                        <Icon size={20} className="flex-shrink-0" />
                        {isSidebarOpen && (
                            <>
                                <span className="ml-3 flex-1 text-left">
                                    {item.name}
                                </span>
                                <span className="ml-2">
                                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                </span>
                            </>
                        )}
                    </Link>

                    {/* Section Children */}
                    {isExpanded && isSidebarOpen && (
                        <div className="ml-4 mt-1 space-y-1">
                            {item.children.map(child => {
                                const ChildIcon = child.icon;
                                const isActive = location.pathname === child.path;
                                return (
                                    <Link
                                        key={child.path}
                                        to={child.path!}
                                        className={`flex items-center px-4 py-2 rounded-lg transition text-sm ${isActive
                                            ? 'bg-blue-600 text-white font-medium'
                                            : 'text-gray-600 hover:bg-gray-50'
                                            }`}
                                        title={child.name}
                                    >
                                        <ChildIcon size={16} className="flex-shrink-0" />
                                        <span className="ml-3">{child.name}</span>
                                    </Link>
                                );
                            })}
                        </div>
                    )}
                    {/* Add divider after each section in collapsed view */}
                    {!isSidebarOpen && <div className="h-px bg-gray-200 mx-2 my-2"></div>}
                </div>
            );
        }

        // Regular nav item
        const isActive = location.pathname === item.path;
        return (
            <Link
                key={item.path}
                to={item.path!}
                className={`flex items-center ${isSidebarOpen ? 'px-4' : 'px-2 justify-center'
                    } py-3 rounded-lg transition ${isActive
                        ? 'bg-blue-600 text-white font-medium'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                title={item.name}
            >
                <Icon size={20} className="flex-shrink-0" />
                {isSidebarOpen && <span className="ml-3">{item.name}</span>}
            </Link>
        );
    };

    return (
        <div className="flex h-screen bg-gray-50">
            {/* Sidebar */}
            <aside
                className={`${isSidebarOpen ? 'w-64' : 'w-20'
                    } bg-white border-r border-gray-200 transition-all duration-300 flex flex-col`}
            >
                {/* Logo / Brand Header - h-20 for better spacing */}
                <div className={`h-20 border-b border-gray-200 flex items-center ${isSidebarOpen ? 'px-5 justify-between' : 'justify-center'}`}>
                    {isSidebarOpen ? (
                        <>
                            {/* Expanded view: Icon + Text */}
                            <Link to="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
                                <img
                                    src="/digientry-icon.png"
                                    alt="DigiEntry Icon"
                                    className="h-11 w-11 object-contain flex-shrink-0"
                                />
                                <div className="flex flex-col min-w-0">
                                    <span className="text-xl font-bold text-gray-900 leading-tight">DigiEntry</span>
                                    <span className="text-xs text-gray-500 leading-tight whitespace-nowrap">Smart Digital Munim</span>
                                </div>
                            </Link>
                            <button
                                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                                className="p-2 hover:bg-gray-100 rounded-lg transition flex-shrink-0"
                                title="Collapse sidebar"
                            >
                                <ChevronLeft size={20} />
                            </button>
                        </>
                    ) : (
                        <div className="flex items-center justify-center">
                            {/* Collapsed view: Icon only - centered properly */}
                            <Link to="/" className="flex items-center justify-center p-1" title="DigiEntry Home">
                                <img
                                    src="/digientry-icon.png"
                                    alt="DigiEntry"
                                    className="h-10 w-10 object-contain hover:opacity-80 transition-opacity"
                                />
                            </Link>
                        </div>
                    )}
                </div>

                {/* Collapse/Expand Toggle Button - Outside header for collapsed state */}
                {!isSidebarOpen && (
                    <div className="px-3 py-3 border-b border-gray-200">
                        <button
                            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                            className="w-full p-2 hover:bg-gray-100 rounded-lg transition flex items-center justify-center"
                            title="Expand sidebar"
                        >
                            <Menu size={20} />
                        </button>
                    </div>
                )}

                {/* Navigation */}
                <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
                    {navigation.map(renderNavItem)}
                </nav>

                {/* User Section */}
                <div className="p-4 border-t border-gray-200">
                    {isSidebarOpen ? (
                        <div className="space-y-2">
                            <p className="text-sm font-medium text-gray-900">{user?.username}</p>
                            <button
                                onClick={logout}
                                className="flex items-center w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition"
                            >
                                <LogOut size={16} className="mr-2" />
                                Logout
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={logout}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition w-full flex justify-center"
                            title="Logout"
                        >
                            <LogOut size={20} />
                        </button>
                    )}
                </div>
            </aside>

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
