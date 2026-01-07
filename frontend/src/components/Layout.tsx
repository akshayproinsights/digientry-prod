import React, { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
    LayoutDashboard,
    Upload,
    ClipboardCheck,
    CheckCircle,
    LogOut,
    Menu,
    X,
    ShoppingCart,
    Package,
    ChevronDown,
    ChevronRight,
    Map,
    Archive,
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

    const navigation: NavItem[] = [
        { name: 'Home', path: '/', icon: LayoutDashboard },
        {
            name: 'Sales',
            icon: ShoppingCart,
            isSection: true,
            children: [
                { name: 'Add Sales Bills', path: '/sales/upload', icon: Upload },
                { name: 'Check Pending Sales', path: '/sales/review', icon: ClipboardCheck },
                { name: 'All Past Sales', path: '/sales/verified', icon: CheckCircle },
            ]
        },
        {
            name: 'Stock (Godown)',
            icon: Package,
            isSection: true,
            children: [
                { name: 'My Stock Register', path: '/inventory/stock', icon: Warehouse },
                { name: 'Add Purchase Bills', path: '/inventory/upload', icon: Upload },
                { name: 'Check Pending Purchases', path: '/inventory/verify', icon: ClipboardCheck },
                { name: 'Fix New Item Names', path: '/inventory/mapping', icon: Map },
                { name: 'Linked Items', path: '/inventory/mapped', icon: Archive },
            ]
        },
    ];

    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 12) return 'Good Morning';
        if (hour < 18) return 'Good Afternoon';
        return 'Good Evening';
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
                    <div
                        className={`flex items-center w-full ${isSidebarOpen ? 'px-4' : 'px-2 justify-center'
                            } py-3 rounded-lg transition cursor-pointer ${hasActiveChild
                                ? 'bg-blue-50 text-blue-700 font-medium'
                                : 'text-gray-700 hover:bg-gray-100'
                            }`}
                        title={item.name}
                    >
                        {/* Icon navigates to first child */}
                        <Link
                            to={item.children[0].path!}
                            className="flex-shrink-0"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <Icon size={20} />
                        </Link>
                        {isSidebarOpen && (
                            <>
                                <span
                                    className="ml-3 flex-1 text-left cursor-pointer"
                                    onClick={() => toggleSection(item.name)}
                                >
                                    {item.name}
                                </span>
                                <span onClick={() => toggleSection(item.name)} className="cursor-pointer">
                                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                </span>
                            </>
                        )}
                    </div>

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
                                            ? 'bg-blue-100 text-blue-700 font-medium'
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
                        ? 'bg-blue-50 text-blue-700 font-medium'
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
                {/* Sidebar Header */}
                <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                    {isSidebarOpen && (
                        <h1 className="text-xl font-bold text-gray-900">Invoice Hub</h1>
                    )}
                    <button
                        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                        className="p-2 hover:bg-gray-100 rounded-lg transition"
                    >
                        {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
                    </button>
                </div>

                {/* Navigation */}
                <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
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
                {/* Header */}
                <header className="bg-white border-b border-gray-200 px-6 py-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-2xl font-bold text-gray-900">
                                {getGreeting()}, {user?.username}!
                            </h2>
                            <p className="text-sm text-gray-600 mt-1">
                                Manage your invoice processing workflow
                            </p>
                        </div>
                    </div>
                </header>

                {/* Page Content */}
                <main className="flex-1 overflow-auto p-6">
                    <Outlet />
                </main>
            </div>
        </div>
    );
};

export default Layout;
