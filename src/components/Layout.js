import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/auth';
import { OfflineBadge } from '@/components/OfflineBadge';
import Toasts from '@/components/Toasts';
import useLowStockWatcher from '@/features/inventory/useLowStockWatcher';
import { LanguageSelector } from '@/components/LanguageSelector';
import { AccessibilityControls } from '@/components/AccessibilityControls';
import { SyncButton } from '@/components/SyncButton';
import { can } from '@/auth/roles';
import { SessionManager } from '@/utils/sessionManager';
import { SessionWarning, SessionStatus } from '@/components/SessionWarning';
import { HomeIcon, UserGroupIcon, QueueListIcon, CubeIcon, UsersIcon, ArrowRightOnRectangleIcon, BeakerIcon, GiftIcon, TicketIcon, TrophyIcon, ClipboardDocumentListIcon, ChartBarIcon, CheckCircleIcon, ArrowLeftIcon, XMarkIcon, Bars3Icon } from '@heroicons/react/24/outline';
// Pharmacy Overlay Component
function PharmacyOverlay({ onClose }) {
    React.useEffect(() => {
        const onKey = (e) => e.key === "Escape" && onClose();
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);
    const cards = [
        {
            to: "/rx/dispense",
            title: "Dispense",
            desc: "Record prescriptions & counsel patients",
            Icon: BeakerIcon,
        },
        {
            to: "/rx/stock",
            title: "Inventory",
            desc: "Stock counts, restock & FEFO tracking",
            Icon: CubeIcon,
        },
        {
            to: "/rx/new",
            title: "New Stock",
            desc: "Receive deliveries / add new items",
            Icon: ClipboardDocumentListIcon,
        },
        {
            to: "/pharmacy/reports",
            title: "Reports",
            desc: "Daily summary & controlled log",
            Icon: ClipboardDocumentListIcon,
        },
    ];
    return (_jsxs("main", { className: "p-4 sm:p-6 max-w-5xl mx-auto", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsxs("button", { onClick: onClose, className: "inline-flex items-center gap-2 text-sm text-gray-700 hover:text-gray-900 focus:outline-none focus:ring", children: [_jsx(ArrowLeftIcon, { className: "h-4 w-4", "aria-hidden": true }), "Back to Dashboard"] }), _jsx("button", { onClick: onClose, "aria-label": "Close pharmacy menu", className: "rounded-full p-2 hover:bg-gray-100 focus:outline-none focus:ring", children: _jsx(XMarkIcon, { className: "h-5 w-5" }) })] }), _jsx("h1", { className: "text-2xl font-bold mb-2", children: "Pharmacy" }), _jsx("p", { className: "text-gray-600 mb-6", children: "Choose what you'd like to do." }), _jsx("section", { "aria-label": "Pharmacy options", className: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4", children: cards.map(({ to, title, desc, Icon }) => (_jsxs(Link, { to: to, onClick: onClose, className: "group rounded-2xl border border-gray-200 p-5 hover:shadow-md focus:outline-none focus:ring focus:ring-primary/30", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "rounded-xl bg-gray-100 p-3", children: _jsx(Icon, { className: "h-6 w-6", "aria-hidden": true }) }), _jsx("h2", { className: "text-lg font-semibold", children: title })] }), _jsx("p", { className: "mt-3 text-sm text-gray-600", children: desc }), _jsxs("span", { className: "sr-only", children: ["Open ", title] })] }, to))) })] }));
}
// Fallback icon for nav items missing icons
const FallbackIcon = (props) => (_jsx("svg", { viewBox: "0 0 24 24", fill: "none", ...props, children: _jsx("circle", { cx: "12", cy: "12", r: "9", stroke: "currentColor" }) }));
export function Layout({ children }) {
    const { t } = useTranslation();
    const location = useLocation();
    const navigate = useNavigate();
    const { currentUser, logout, updateActivity, checkSessionExpiry } = useAuthStore();
    const [overlay, setOverlay] = React.useState(null);
    const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
    const [showSessionWarning, setShowSessionWarning] = React.useState(false);
    const [timeRemaining, setTimeRemaining] = React.useState(0);
    const sessionManagerRef = React.useRef(null);
    // Start low stock monitoring
    useLowStockWatcher();
    // Close mobile menu on route change
    React.useEffect(() => {
        setMobileMenuOpen(false);
    }, [location.pathname]);
    // Initialize session manager
    React.useEffect(() => {
        if (!currentUser)
            return;
        const sessionManager = new SessionManager('staff', (remaining) => {
            setTimeRemaining(remaining);
            setShowSessionWarning(true);
        }, () => {
            logout();
            navigate('/login');
        });
        sessionManagerRef.current = sessionManager;
        return () => {
            sessionManager.destroy();
        };
    }, [currentUser, logout, navigate]);
    // Check session expiry periodically
    React.useEffect(() => {
        if (!currentUser)
            return;
        const interval = setInterval(() => {
            const expired = checkSessionExpiry();
            if (expired) {
                navigate('/login');
            }
        }, 60 * 1000);
        return () => clearInterval(interval);
    }, [currentUser, checkSessionExpiry, navigate]);
    // Update activity on user interaction
    React.useEffect(() => {
        if (!currentUser)
            return;
        const handleActivity = () => {
            updateActivity();
        };
        const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
        events.forEach(event => {
            window.addEventListener(event, handleActivity, { passive: true });
        });
        return () => {
            events.forEach(event => {
                window.removeEventListener(event, handleActivity);
            });
        };
    }, [currentUser, updateActivity]);
    const baseNavigation = [
        { name: 'Dashboard', href: '/dashboard', icon: HomeIcon },
        { name: 'Patients', href: '/patients', icon: UserGroupIcon },
        { name: 'Queue', href: '/queue', icon: QueueListIcon },
        { name: 'Inventory', href: '/inventory', icon: CubeIcon },
        { name: 'Pharmacy', href: '/pharmacy', icon: BeakerIcon },
        { name: 'Game Hub', href: '/games', icon: TrophyIcon },
        { name: 'Analytics', href: '/analytics', icon: ChartBarIcon },
        { name: 'Issue Tickets', href: '/tickets/issue', icon: TicketIcon },
        { name: 'Restock Game', href: '/inv/game', icon: GiftIcon }
    ];
    // Add admin-only navigation items
    const navigation = [
        ...baseNavigation,
        ...(currentUser && can(currentUser.role, 'users') ? [
            { name: 'User Management', href: '/users', icon: UsersIcon },
            { name: 'Approve Games', href: '/admin/approvals', icon: CheckCircleIcon }
        ] : [])
    ];
    const handleLogout = async () => {
        if (sessionManagerRef.current) {
            sessionManagerRef.current.cleanup();
        }
        await logout();
        navigate('/login');
    };
    const handleExtendSession = () => {
        if (sessionManagerRef.current) {
            sessionManagerRef.current.extendSession();
        }
        updateActivity();
        setShowSessionWarning(false);
    };
    const sessionInfo = sessionManagerRef.current?.getSessionInfo();
    return (_jsxs("div", { className: "min-h-screen bg-gray-50", children: [_jsx("header", { className: "bg-primary text-white shadow-lg sticky top-0 z-30", children: _jsx("div", { className: "max-w-7xl mx-auto px-4 sm:px-6 lg:px-8", children: _jsxs("div", { className: "flex justify-between items-center py-3 md:py-4", children: [_jsx("button", { onClick: () => setMobileMenuOpen(!mobileMenuOpen), className: "md:hidden p-2 rounded-lg hover:bg-primary/80 transition-colors min-h-touch-target min-w-touch-target", "aria-label": "Toggle menu", children: _jsx(Bars3Icon, { className: "h-6 w-6" }) }), _jsxs("div", { className: "flex-1 md:flex-initial", children: [_jsx("h1", { className: "text-lg md:text-xl font-bold text-shadow", children: t('app.title') }), _jsx("p", { className: "text-xs md:text-sm opacity-90 hidden sm:block", children: t('app.subtitle') })] }), _jsxs("div", { className: "flex items-center gap-2 md:gap-4", children: [sessionInfo && sessionInfo.timeRemaining < 600 && (_jsx("div", { className: "hidden sm:block", children: _jsx(SessionStatus, { timeRemaining: sessionInfo.timeRemaining, userType: "staff" }) })), _jsx("div", { className: "hidden xs:block", children: _jsx(OfflineBadge, {}) }), _jsx(SyncButton, {}), _jsx("div", { className: "hidden md:block", children: _jsx(LanguageSelector, {}) }), _jsx("div", { className: "hidden lg:block", children: _jsx(AccessibilityControls, {}) }), currentUser && (_jsxs("div", { className: "flex items-center gap-2", children: [_jsxs("div", { className: "text-right hidden md:block", children: [_jsx("p", { className: "text-sm font-medium", children: currentUser.fullName }), _jsx("p", { className: "text-xs opacity-75 capitalize", children: currentUser.role })] }), _jsx("button", { onClick: handleLogout, className: "p-2 rounded-lg hover:bg-primary/80 transition-colors min-h-touch-target min-w-touch-target", title: t('auth.logout'), children: _jsx(ArrowRightOnRectangleIcon, { className: "h-5 w-5" }) })] }))] })] }) }) }), _jsxs("div", { className: "flex relative min-h-[calc(100vh-73px)]", children: [mobileMenuOpen && (_jsx("div", { className: "fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden", onClick: () => setMobileMenuOpen(false) })), _jsx("nav", { className: `
          fixed md:sticky md:top-0 inset-y-0 left-0 z-50
          w-64 bg-white shadow-lg md:shadow-sm
          transform transition-transform duration-300 ease-in-out
          ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
          overflow-y-auto md:h-[calc(100vh-73px)] md:self-start
        `, children: _jsxs("div", { className: "p-4", children: [_jsxs("div", { className: "flex items-center justify-between mb-4 md:hidden", children: [_jsxs("div", { children: [_jsx("p", { className: "font-semibold text-gray-900", children: currentUser?.fullName }), _jsx("p", { className: "text-xs text-gray-600 capitalize", children: currentUser?.role })] }), _jsx("button", { onClick: () => setMobileMenuOpen(false), className: "p-2 rounded-lg hover:bg-gray-100 min-h-touch-target min-w-touch-target", "aria-label": "Close menu", children: _jsx(XMarkIcon, { className: "h-5 w-5" }) })] }), _jsxs("div", { className: "mb-4 space-y-2 md:hidden", children: [_jsx(LanguageSelector, {}), _jsx(AccessibilityControls, {})] }), _jsx("ul", { className: "space-y-1 md:space-y-2", children: navigation.map((item) => {
                                        const isPharmacy = item.name === 'Pharmacy';
                                        // Better active state detection
                                        let isActive = false;
                                        if (isPharmacy) {
                                            isActive = location.pathname.startsWith('/rx/') ||
                                                location.pathname === '/pharmacy' ||
                                                location.pathname.startsWith('/pharmacy/');
                                        }
                                        else if (item.href === '/') {
                                            isActive = location.pathname === '/';
                                        }
                                        else {
                                            isActive = location.pathname === item.href ||
                                                location.pathname.startsWith(item.href + '/');
                                        }
                                        const Common = (_jsxs(_Fragment, { children: [_jsx(item.icon, { className: "h-5 w-5 flex-shrink-0" }), _jsx("span", { className: "font-medium", children: item.name })] }));
                                        return (_jsx("li", { children: isPharmacy ? (_jsx("button", { type: "button", onClick: () => {
                                                    setOverlay("pharmacy");
                                                    setMobileMenuOpen(false);
                                                }, className: `w-full flex items-center gap-3 px-3 md:px-4 py-3 rounded-lg transition-colors min-h-touch-target text-left ${isActive
                                                    ? 'bg-primary text-white'
                                                    : 'text-gray-700 hover:bg-gray-100 active:bg-gray-200'}`, "aria-haspopup": "dialog", "aria-controls": "pharmacy-menu", children: Common })) : (_jsx(Link, { to: item.href, onClick: () => setMobileMenuOpen(false), className: `flex items-center gap-3 px-3 md:px-4 py-3 rounded-lg transition-colors min-h-touch-target ${isActive
                                                    ? 'bg-primary text-white'
                                                    : 'text-gray-700 hover:bg-gray-100 active:bg-gray-200'}`, children: Common })) }, item.name));
                                    }) })] }) }), _jsx("main", { className: "flex-1 w-full md:w-auto overflow-x-hidden min-h-full", children: overlay === "pharmacy" ? (_jsx("div", { id: "pharmacy-menu", role: "dialog", "aria-modal": "true", className: "p-4 sm:p-6", children: _jsx(PharmacyOverlay, { onClose: () => setOverlay(null) }) })) : (_jsx("div", { className: "p-4 sm:p-6 max-w-7xl mx-auto min-h-full", children: children })) })] }), _jsx(Toasts, {}), _jsx(SessionWarning, { isOpen: showSessionWarning, timeRemaining: timeRemaining, userType: "staff", onExtend: handleExtendSession, onLogout: handleLogout })] }));
}
