import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState, useMemo, useCallback, memo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/auth';
import { db } from '@/db';
import { can } from '@/auth/roles';
import { queryCache, createCacheKey } from '@/utils/queryCache';
import { OfflineAnalytics } from '@/components/OfflineAnalytics';
import { EnhancedQueueBoard } from '@/components/EnhancedQueueBoard';
import { ExportButtons } from '@/components/ExportButtons';
import { AudioButton } from '@/components/AudioButton';
import { MessageOutbox } from '@/components/MessageOutbox';
import { UserPlusIcon, UsersIcon, HeartIcon, CubeIcon, Cog6ToothIcon, QueueListIcon } from '@heroicons/react/24/outline';
// Memoized stat card component
const StatCard = memo(({ icon: Icon, label, value, colorClass }) => (_jsx("div", { className: "bg-white rounded-lg shadow-sm p-6", children: _jsxs("div", { className: "flex items-center", children: [_jsx("div", { className: `flex-shrink-0 p-2 rounded-lg ${colorClass}`, children: _jsx(Icon, { className: "h-6 w-6" }) }), _jsxs("div", { className: "ml-4", children: [_jsx("p", { className: "text-sm font-medium text-gray-500", children: label }), _jsx("p", { className: "text-2xl font-bold text-gray-900", children: value })] })] }) })));
StatCard.displayName = 'StatCard';
export function Dashboard() {
    const { t } = useTranslation();
    const { currentUser } = useAuthStore();
    const [stats, setStats] = useState({
        totalPatients: 0,
        todayRegistrations: 0,
        totalUsers: 0
    });
    const loadStats = useCallback(async () => {
        try {
            // Check cache first
            const cacheKey = createCacheKey('dashboard', 'stats', new Date().toDateString());
            const cached = queryCache.get(cacheKey);
            if (cached) {
                setStats(cached);
                return;
            }
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const [totalPatients, todayRegistrations, totalUsers] = await Promise.all([
                db.patients.count(),
                db.patients.where('createdAt').between(today, tomorrow).count(),
                db.users.count()
            ]);
            const newStats = {
                totalPatients,
                todayRegistrations,
                totalUsers
            };
            setStats(newStats);
            // Cache for 5 minutes
            queryCache.set(cacheKey, newStats, 5 * 60 * 1000);
        }
        catch (error) {
            console.error('Error loading stats:', error);
        }
    }, []);
    useEffect(() => {
        loadStats();
    }, [loadStats]);
    // Memoize quick actions based on user role
    const quickActions = useMemo(() => {
        const actions = [
            {
                name: 'Register Patient',
                href: '/register',
                icon: UserPlusIcon,
                color: 'bg-blue-500 hover:bg-blue-600',
                description: 'Add new patient'
            },
            {
                name: 'View Patients',
                href: '/patients',
                icon: UsersIcon,
                color: 'bg-green-500 hover:bg-green-600',
                description: 'Patient records'
            },
            {
                name: 'View Queue',
                href: '/queue',
                icon: HeartIcon,
                color: 'bg-purple-500 hover:bg-purple-600',
                description: 'Patient flow'
            },
            {
                name: 'Inventory',
                href: '/inventory',
                icon: CubeIcon,
                color: 'bg-orange-500 hover:bg-orange-600',
                description: 'Stock management'
            }
        ];
        // Add admin-only actions
        if (currentUser && can(currentUser.role, 'users')) {
            actions.push({
                name: 'User Management',
                href: '/users',
                icon: Cog6ToothIcon,
                color: 'bg-purple-500 hover:bg-purple-600',
                description: 'Manage users'
            });
        }
        return actions;
    }, [currentUser]);
    const formattedDate = useMemo(() => {
        return new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }, []);
    return (_jsxs("div", { className: "space-y-6", children: [_jsx("div", { className: "bg-white rounded-lg shadow-sm p-6", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsxs("h1", { className: "text-2xl font-bold text-gray-900", children: ["Welcome back, ", currentUser?.fullName] }), _jsx("p", { className: "text-gray-600 mt-1", children: "Here's what's happening at your clinic today" })] }), _jsx("div", { className: "text-right", children: _jsx("p", { className: "text-sm text-gray-500", children: formattedDate }) })] }) }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-3 gap-6", children: [_jsx(StatCard, { icon: UsersIcon, label: "Total Patients", value: stats.totalPatients, colorClass: "bg-blue-50 text-blue-600" }), _jsx(StatCard, { icon: UserPlusIcon, label: "Today's Registrations", value: stats.todayRegistrations, colorClass: "bg-green-50 text-green-600" }), _jsx(StatCard, { icon: HeartIcon, label: "System Users", value: stats.totalUsers, colorClass: "bg-purple-50 text-purple-600" })] }), _jsx(MessageOutbox, {}), _jsx(OfflineAnalytics, {}), _jsx(EnhancedQueueBoard, {}), _jsx(ExportButtons, {}), _jsxs("div", { className: "bg-white rounded-lg shadow-sm p-6", children: [_jsx("h2", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Getting Started" }), _jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx("div", { className: "w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center", children: _jsx("span", { className: "text-blue-600 font-semibold text-sm", children: "1" }) }), _jsxs("div", { children: [_jsx("p", { className: "font-medium text-gray-900", children: "Register your first patient" }), _jsx("p", { className: "text-sm text-gray-600", children: "Start by adding patient information to the system" })] })] }), _jsxs("div", { className: "flex items-center space-x-3", children: [_jsx("div", { className: "w-8 h-8 bg-green-100 rounded-full flex items-center justify-center", children: _jsx("span", { className: "text-green-600 font-semibold text-sm", children: "2" }) }), _jsxs("div", { children: [_jsx("p", { className: "font-medium text-gray-900", children: "Record vital signs" }), _jsx("p", { className: "text-sm text-gray-600", children: "Take measurements and track patient health" })] })] }), _jsxs("div", { className: "flex items-center space-x-3", children: [_jsx("div", { className: "w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center", children: _jsx("span", { className: "text-purple-600 font-semibold text-sm", children: "3" }) }), _jsxs("div", { children: [_jsx("p", { className: "font-medium text-gray-900", children: "Manage inventory" }), _jsx("p", { className: "text-sm text-gray-600", children: "Keep track of medications and supplies" })] })] })] }), _jsx("div", { className: "mt-6 pt-4 border-t border-gray-200", children: _jsxs("div", { className: "flex space-x-4", children: [_jsx(AudioButton, { audioKey: "action.register", fallbackText: "Register Patient", onClick: () => { }, className: "btn-primary", children: _jsxs(Link, { to: "/register", className: "flex items-center space-x-2", children: [_jsx(UserPlusIcon, { className: "h-5 w-5" }), _jsx("span", { children: "Register Patient" })] }) }), _jsx(AudioButton, { audioKey: "nav.queue", fallbackText: "View Queue", onClick: () => { }, className: "btn-secondary", children: _jsxs(Link, { to: "/queue", className: "flex items-center space-x-2", children: [_jsx(QueueListIcon, { className: "h-5 w-5" }), _jsx("span", { children: "View Queue" })] }) })] }) })] })] }));
}
