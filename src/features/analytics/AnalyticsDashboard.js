import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import Dexie from 'dexie';
import { useAuthStore } from '@/stores/auth';
import { db } from '@/db';
import { can } from '@/auth/roles';
import { ChartBarIcon, UsersIcon, ClockIcon, HeartIcon, TrophyIcon, ExclamationTriangleIcon, CalendarIcon } from '@heroicons/react/24/outline';
// Date range helpers to ensure valid IndexedDB keys
const toISO = (v) => {
    if (!v)
        return undefined;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
};
const makeBoundsISO = (from, to) => {
    const lo = toISO(from) ?? Dexie.minKey;
    const hi = toISO(to) ?? Dexie.maxKey;
    return [lo, hi];
};
/** Range helper: if no bounds, fall back to full index scan (ordered). */
const rangeOrAll = (table, index, from, to) => {
    if (from || to) {
        const [lo, hi] = makeBoundsISO(from, to);
        return table.where(index).between(lo, hi, true, true);
    }
    return table.orderBy(index);
};
export default function AnalyticsDashboard() {
    const { currentUser } = useAuthStore();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [dateRange, setDateRange] = useState({
        from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 7 days ago
        to: new Date().toISOString().split('T')[0] // today
    });
    // Only admins can access analytics
    if (!currentUser || !can(currentUser.role, 'export')) {
        return (_jsxs("div", { className: "text-center py-12", children: [_jsx(ChartBarIcon, { className: "h-12 w-12 mx-auto text-gray-400 mb-4" }), _jsx("h3", { className: "text-lg font-medium text-gray-900 mb-2", children: "Access Restricted" }), _jsx("p", { className: "text-gray-600", children: "Only administrators can access the analytics dashboard." })] }));
    }
    useEffect(() => {
        loadAnalyticsData();
    }, [dateRange]);
    const loadAnalyticsData = async () => {
        setLoading(true);
        try {
            // Validate date range inputs
            const fromDate = dateRange.from ? new Date(dateRange.from + 'T00:00:00.000Z') : null;
            const toDate = dateRange.to ? new Date(dateRange.to + 'T23:59:59.999Z') : null;
            // Overview metrics
            const [totalPatients, todayCount, pendingCount, wallets] = await Promise.all([
                db.patients.count(),
                rangeOrAll(db.patients, 'createdAt', fromDate, toDate).count(),
                db.gameSessions.filter(s => !s.committed && !!s.finishedAt).count(),
                db.gamificationWallets.orderBy('tokens').reverse().limit(5).toArray()
            ]);
            // Throughput data for the last 7 days
            const throughputData = [];
            for (let i = 6; i >= 0; i--) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
                const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
                const [registrations, vitalsCount, consultations, dispenses] = await Promise.all([
                    rangeOrAll(db.patients, 'createdAt', dayStart, dayEnd).count(),
                    rangeOrAll(db.vitals, 'takenAt', dayStart, dayEnd).count(),
                    rangeOrAll(db.consultations, 'createdAt', dayStart, dayEnd).count(),
                    rangeOrAll(db.dispenses, 'dispensedAt', dayStart, dayEnd).count()
                ]);
                throughputData.push({
                    date: date.toISOString().split('T')[0],
                    registrations,
                    vitals: vitalsCount,
                    consultations,
                    dispenses
                });
            }
            // Queue metrics (current state)
            const queueMetrics = await Promise.all([
                'registration', 'vitals', 'consult', 'pharmacy'
            ].map(async (stage) => {
                const waiting = await db.queue.where('stage').equals(stage).and(q => q.status === 'waiting').count();
                return {
                    stage,
                    avgWaitMinutes: 15, // Placeholder
                    throughput: 0, // Placeholder
                    currentWaiting: waiting
                };
            }));
            // Top performers
            const users = await db.users.toArray();
            const userMap = new Map(users.map(u => [u.id, u.fullName]));
            const topPerformers = wallets.map(wallet => ({
                name: userMap.get(wallet.volunteerId) || 'Unknown',
                tokens: wallet.tokens,
                badges: wallet.badges.length
            }));
            const analyticsData = {
                overview: {
                    totalPatients,
                    todayRegistrations: todayCount,
                    activeVisits: 0, // Simplified for now
                    completedVisits: 0, // Simplified for now
                    avgWaitTime: 15, // Simplified for now
                    tokensAwarded: wallets.reduce((sum, w) => sum + w.tokens, 0)
                },
                throughput: throughputData,
                queueMetrics,
                gamification: {
                    totalSessions: 0, // Simplified for now
                    pendingApprovals: pendingCount,
                    topPerformers
                }
            };
            setData(analyticsData);
        }
        catch (error) {
            console.error('Error loading analytics data:', error);
        }
        finally {
            setLoading(false);
        }
    };
    if (loading) {
        return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(ChartBarIcon, { className: "h-8 w-8 text-primary" }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Analytics Dashboard" }), _jsx("p", { className: "text-gray-600", children: "Loading clinic performance data..." })] })] }), _jsx("div", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6", children: [...Array(8)].map((_, i) => (_jsx("div", { className: "card animate-pulse", children: _jsx("div", { className: "h-20 bg-gray-200 rounded" }) }, i))) })] }));
    }
    if (!data)
        return null;
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(ChartBarIcon, { className: "h-8 w-8 text-primary" }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Analytics Dashboard" }), _jsx("p", { className: "text-gray-600", children: "Clinic performance and gamification insights" })] })] }), _jsx("div", { className: "flex items-center space-x-4", children: _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(CalendarIcon, { className: "h-5 w-5 text-gray-400" }), _jsx("input", { type: "date", value: dateRange.from, onChange: (e) => setDateRange({ ...dateRange, from: e.target.value }), className: "input-field text-sm py-2" }), _jsx("span", { className: "text-gray-500", children: "to" }), _jsx("input", { type: "date", value: dateRange.to, onChange: (e) => setDateRange({ ...dateRange, to: e.target.value }), className: "input-field text-sm py-2" })] }) })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6", children: [_jsx("div", { className: "card bg-blue-50 border-blue-200", children: _jsxs("div", { className: "flex items-center", children: [_jsx("div", { className: "flex-shrink-0 p-2 rounded-lg bg-blue-100", children: _jsx(UsersIcon, { className: "h-6 w-6 text-blue-600" }) }), _jsxs("div", { className: "ml-4", children: [_jsx("p", { className: "text-sm font-medium text-blue-600", children: "Total Patients" }), _jsx("p", { className: "text-2xl font-bold text-blue-800", children: data.overview.totalPatients })] })] }) }), _jsx("div", { className: "card bg-green-50 border-green-200", children: _jsxs("div", { className: "flex items-center", children: [_jsx("div", { className: "flex-shrink-0 p-2 rounded-lg bg-green-100", children: _jsx(HeartIcon, { className: "h-6 w-6 text-green-600" }) }), _jsxs("div", { className: "ml-4", children: [_jsx("p", { className: "text-sm font-medium text-green-600", children: "Active Visits" }), _jsx("p", { className: "text-2xl font-bold text-green-800", children: data.overview.activeVisits })] })] }) }), _jsx("div", { className: "card bg-orange-50 border-orange-200", children: _jsxs("div", { className: "flex items-center", children: [_jsx("div", { className: "flex-shrink-0 p-2 rounded-lg bg-orange-100", children: _jsx(ClockIcon, { className: "h-6 w-6 text-orange-600" }) }), _jsxs("div", { className: "ml-4", children: [_jsx("p", { className: "text-sm font-medium text-orange-600", children: "Avg Wait Time" }), _jsxs("p", { className: "text-2xl font-bold text-orange-800", children: [data.overview.avgWaitTime, "m"] })] })] }) }), _jsx("div", { className: "card bg-purple-50 border-purple-200", children: _jsxs("div", { className: "flex items-center", children: [_jsx("div", { className: "flex-shrink-0 p-2 rounded-lg bg-purple-100", children: _jsx(TrophyIcon, { className: "h-6 w-6 text-purple-600" }) }), _jsxs("div", { className: "ml-4", children: [_jsx("p", { className: "text-sm font-medium text-purple-600", children: "Tokens Awarded" }), _jsx("p", { className: "text-2xl font-bold text-purple-800", children: data.overview.tokensAwarded })] })] }) })] }), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-6", children: [_jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Daily Throughput" }), _jsx("div", { className: "space-y-3", children: data.throughput.map((day, index) => (_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-sm text-gray-600", children: new Date(day.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }), _jsxs("div", { className: "flex space-x-4 text-sm", children: [_jsxs("span", { className: "text-blue-600", children: [day.registrations, " reg"] }), _jsxs("span", { className: "text-green-600", children: [day.vitals, " vitals"] }), _jsxs("span", { className: "text-purple-600", children: [day.consultations, " consult"] }), _jsxs("span", { className: "text-orange-600", children: [day.dispenses, " dispense"] })] })] }, day.date))) })] }), _jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Current Queue Status" }), _jsx("div", { className: "space-y-4", children: data.queueMetrics.map((stage) => (_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("span", { className: "font-medium text-gray-900 capitalize", children: stage.stage }), _jsxs("span", { className: "text-sm text-gray-600 ml-2", children: ["(Avg: ", stage.avgWaitMinutes, "m)"] })] }), _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx("span", { className: "text-lg font-bold text-primary", children: stage.currentWaiting }), _jsx("span", { className: "text-sm text-gray-600", children: "waiting" })] })] }, stage.stage))) })] })] }), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-6", children: [_jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Top Performers" }), _jsx("div", { className: "space-y-3", children: data.gamification.topPerformers.map((performer, index) => (_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx("div", { className: "w-8 h-8 bg-primary rounded-full flex items-center justify-center text-white font-bold text-sm", children: index + 1 }), _jsxs("div", { children: [_jsx("span", { className: "font-medium text-gray-900", children: performer.name }), _jsxs("span", { className: "text-sm text-gray-600 ml-2", children: [performer.badges, " badges"] })] })] }), _jsx("span", { className: "text-lg font-bold text-primary", children: performer.tokens })] }, index))) })] }), _jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Gamification Overview" }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-gray-700", children: "Total Game Sessions" }), _jsx("span", { className: "text-lg font-bold text-gray-900", children: data.gamification.totalSessions })] }), _jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-gray-700", children: "Pending Approvals" }), _jsxs("div", { className: "flex items-center space-x-2", children: [data.gamification.pendingApprovals > 0 && (_jsx(ExclamationTriangleIcon, { className: "h-4 w-4 text-yellow-600" })), _jsx("span", { className: "text-lg font-bold text-gray-900", children: data.gamification.pendingApprovals })] })] }), _jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-gray-700", children: "Total Tokens Awarded" }), _jsx("span", { className: "text-lg font-bold text-primary", children: data.overview.tokensAwarded })] })] }), data.gamification.pendingApprovals > 0 && (_jsx("div", { className: "mt-4 pt-4 border-t border-gray-200", children: _jsx("button", { className: "btn-primary w-full text-sm", children: "Review Pending Approvals" }) }))] })] }), _jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Data Export" }), _jsxs("div", { className: "grid grid-cols-2 md:grid-cols-4 gap-3", children: [_jsx("button", { className: "btn-secondary text-sm", children: "Export Analytics (CSV)" }), _jsx("button", { className: "btn-secondary text-sm", children: "Export Gamification (CSV)" }), _jsx("button", { className: "btn-secondary text-sm", children: "Export Queue Metrics (CSV)" }), _jsx("button", { className: "btn-secondary text-sm", children: "Generate Report (PDF)" })] })] })] }));
}
