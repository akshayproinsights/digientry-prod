import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useGlobalStatus } from '../contexts/GlobalStatusContext';
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

const Sidebar: React.FC = () => {
    const { user, logout } = useAuth();
    const { inventory, sales } = useGlobalStatus();
    const location = useLocation();
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const [expandedSections, setExpandedSections] = useState<string[]>(['Sales', 'Inventory']);

    const toggleSection = (sectionName: string) => {
        setExpandedSections(prev =>
            prev.includes(sectionName)
                ? prev.filter(s => s !== sectionName)
                : [...prev, sectionName]
        );
    };

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

    const getBadge = (name: string) => {
        // Inventory badge removed as per request

        if (name === 'Add Purchase Bills') {
            if (inventory.isComplete) {
                return (
                    <span className="bg-green-100 text-green-700 text-xs font-bold p-1 rounded-full ml-auto">
                        <CheckCircle size={14} />
                    </span>
                );
            }
            if (inventory.isUploading || inventory.processingCount > 0) {
                return (
                    <span className="bg-blue-100 text-blue-600 text-xs font-semibold px-2 py-0.5 rounded-full ml-auto">
                        Processing {inventory.processingCount}/{inventory.totalProcessing || '?'}
                    </span>
                );
            }
        }

        if (name === 'All Past Purchases') {
            return null;
        }

        // Sales badge removed as per request

        if (name === 'Review Sales') {
            const totalReview = sales.reviewCount + sales.syncCount;
            if (totalReview > 0) {
                return (
                    <span className="bg-orange-100 text-orange-700 text-xs font-bold px-2 py-0.5 rounded-full ml-auto">
                        {totalReview}
                    </span>
                );
            }
        }

        if (name === 'Add Sales Bills') {
            if (sales.isComplete) {
                return (
                    <span className="bg-green-100 text-green-700 text-xs font-bold p-1 rounded-full ml-auto">
                        <CheckCircle size={14} />
                    </span>
                );
            }
            if (sales.isUploading || sales.processingCount > 0) {
                const completed = (sales.totalProcessing || 0) - sales.processingCount;
                return (
                    <span className="bg-blue-100 text-blue-600 text-xs font-semibold px-2 py-0.5 rounded-full ml-auto">
                        Processing {completed}/{sales.totalProcessing || '?'}
                    </span>
                );
            }
        }

        return null;
    };


    const renderNavItem = (item: NavItem) => {
        const Icon = item.icon;

        // Section with children
        if (item.isSection && item.children) {
            const isExpanded = expandedSections.includes(item.name);
            const hasActiveChild = item.children.some(child => child.path === location.pathname);
            const badge = getBadge(item.name);

            return (
                <div key={item.name}>
                    {/* Section Header */}
                    <div
                        onClick={() => toggleSection(item.name)}
                        className={`flex items-center w-full ${isSidebarOpen ? 'px-4' : 'px-2 justify-center'
                            } py-3 rounded-lg transition cursor-pointer ${hasActiveChild
                                ? 'bg-blue-50 text-blue-700 font-medium'
                                : 'text-gray-700 hover:bg-gray-100'
                            }`}
                        title={item.name}
                    >
                        <Icon size={20} className="flex-shrink-0" />
                        {isSidebarOpen && (
                            <>
                                <span className="ml-3 flex-1 text-left flex items-center justify-between">
                                    {item.name}
                                    {badge}
                                </span>
                                <span className="ml-2">
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
                                const childBadge = getBadge(child.name);

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
                                        <span className="ml-3 flex-1 flex items-center justify-between">
                                            {child.name}
                                            {childBadge}
                                        </span>
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
        <aside
            className={`${isSidebarOpen ? 'w-64' : 'w-20'
                } bg-white border-r border-gray-200 transition-all duration-300 flex flex-col h-screen flex-shrink-0`}
        >
            {/* Logo / Brand Header */}
            <div className={`h-20 border-b border-gray-200 flex items-center ${isSidebarOpen ? 'px-5 justify-between' : 'justify-center'}`}>
                {isSidebarOpen ? (
                    <>
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

            {/* Collapse/Expand Toggle Button */}
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
            <nav className="flex-1 p-4 space-y-2 overflow-y-auto custom-scrollbar">
                {navigation.map(renderNavItem)}
            </nav>

            {/* User Section */}
            <div className="p-4 border-t border-gray-200">
                {isSidebarOpen ? (
                    <div className="space-y-2">
                        <p className="text-sm font-medium text-gray-900 truncate">{user?.username}</p>
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
    );
};

export default Sidebar;
