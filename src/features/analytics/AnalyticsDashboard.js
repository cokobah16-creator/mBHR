import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState, useCallback } from "react";
import Dexie from "dexie";
import { useAuthStore } from "@/stores/auth";
import { db } from "@/db";
import { can } from "@/auth/roles";
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, } from "recharts";
import { ChartBarIcon, UsersIcon, ClockIcon, HeartIcon, TrophyIcon, ExclamationTriangleIcon, CalendarIcon, ArrowDownTrayIcon, } from "@heroicons/react/24/outline";
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
const rangeOrAll = (
// eslint-disable-next-line @typescript-eslint/no-explicit-any
table, index, from, to) => {
    if (from || to) {
        const [lo, hi] = makeBoundsISO(from, to);
        return table.where(index).between(lo, hi, true, true);
    }
    return table.orderBy(index);
};
const CHART_COLORS = [
    "#2563eb",
    "#16a34a",
    "#9333ea",
    "#ea580c",
    "#0891b2",
    "#e11d48",
];
function downloadCSV(filename, headers, rows) {
    const csvContent = [
        headers.join(","),
        ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}
export default function AnalyticsDashboard() {
    const { currentUser } = useAuthStore();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [dateRange, setDateRange] = useState({
        from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
            .toISOString()
            .split("T")[0],
        to: new Date().toISOString().split("T")[0],
    });
    const hasAccess = !!currentUser && can(currentUser.role, "export");
    const loadAnalyticsData = useCallback(async () => {
        setLoading(true);
        try {
            const fromDate = dateRange.from
                ? new Date(dateRange.from + "T00:00:00.000Z")
                : null;
            const toDate = dateRange.to
                ? new Date(dateRange.to + "T23:59:59.999Z")
                : null;
            // Calculate days in range
            const startMs = fromDate?.getTime() ?? Date.now() - 7 * 86400000;
            const endMs = toDate?.getTime() ?? Date.now();
            const dayCount = Math.max(1, Math.ceil((endMs - startMs) / 86400000));
            // Overview metrics
            const [totalPatients, todayCount, activeVisits, completedVisits, pendingCount, wallets, totalSessions,] = await Promise.all([
                db.patients.count(),
                rangeOrAll(db.patients, "createdAt", fromDate, toDate).count(),
                db.visits.where("status").equals("open").count(),
                db.visits.where("status").equals("closed").count(),
                db.gameSessions.filter((s) => !s.committed && !!s.finishedAt).count(),
                db.gamificationWallets.orderBy("tokens").reverse().limit(5).toArray(),
                db.gameSessions.count(),
            ]);
            // Calculate real average wait time from queue
            const queueItems = await db.queue
                .where("status")
                .equals("done")
                .toArray();
            let avgWaitTime = 0;
            if (queueItems.length > 0) {
                const totalWait = queueItems.reduce((sum, item) => {
                    if (item.queuedAt &&
                        item.updatedAt) {
                        return (sum +
                            (new Date(item.updatedAt).getTime() -
                                new Date(item
                                    .queuedAt).getTime()));
                    }
                    return sum;
                }, 0);
                avgWaitTime = Math.round(totalWait / queueItems.length / 60000); // minutes
            }
            // Throughput data for each day in range
            const throughputData = [];
            for (let i = dayCount - 1; i >= 0; i--) {
                const date = new Date(endMs - i * 86400000);
                const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
                const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
                const [registrations, vitalsCount, consultations, dispenses] = await Promise.all([
                    rangeOrAll(db.patients, "createdAt", dayStart, dayEnd).count(),
                    rangeOrAll(db.vitals, "takenAt", dayStart, dayEnd).count(),
                    rangeOrAll(db.consultations, "createdAt", dayStart, dayEnd).count(),
                    rangeOrAll(db.dispenses, "dispensedAt", dayStart, dayEnd).count(),
                ]);
                throughputData.push({
                    date: dayStart.toISOString().split("T")[0],
                    label: dayStart.toLocaleDateString("en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                    }),
                    registrations,
                    vitals: vitalsCount,
                    consultations,
                    dispenses,
                });
            }
            // Queue metrics with real wait time calculation
            const queueMetrics = await Promise.all(["registration", "vitals", "consult", "pharmacy"].map(async (stage) => {
                const waiting = await db.queue
                    .where("stage")
                    .equals(stage)
                    .and((q) => q.status === "waiting")
                    .count();
                const doneInStage = await db.queue
                    .where("stage")
                    .equals(stage)
                    .and((q) => q.status === "done")
                    .toArray();
                let stageAvgWait = 0;
                if (doneInStage.length > 0) {
                    const totalWait = doneInStage.reduce((sum, item) => {
                        if (item.queuedAt &&
                            item.updatedAt) {
                            return (sum +
                                (new Date(item.updatedAt).getTime() -
                                    new Date(item
                                        .queuedAt).getTime()));
                        }
                        return sum;
                    }, 0);
                    stageAvgWait = Math.round(totalWait / doneInStage.length / 60000);
                }
                return {
                    stage,
                    avgWaitMinutes: stageAvgWait,
                    throughput: doneInStage.length,
                    currentWaiting: waiting,
                };
            }));
            // Patient demographics by state
            const allPatients = await db.patients.toArray();
            const stateCounts = new Map();
            allPatients.forEach((p) => {
                const state = p.state || "Unknown";
                stateCounts.set(state, (stateCounts.get(state) || 0) + 1);
            });
            const demographics = Array.from(stateCounts.entries())
                .map(([name, value]) => ({ name, value }))
                .sort((a, b) => b.value - a.value)
                .slice(0, 6);
            // Top performers
            const users = await db.users.toArray();
            const userMap = new Map(users.map((u) => [u.id, u.fullName]));
            const topPerformers = wallets.map((wallet) => ({
                name: userMap.get(wallet.volunteerId) || "Unknown",
                tokens: wallet.tokens,
                badges: wallet.badges.length,
            }));
            setData({
                overview: {
                    totalPatients,
                    todayRegistrations: todayCount,
                    activeVisits,
                    completedVisits,
                    avgWaitTime,
                    tokensAwarded: wallets.reduce((sum, w) => sum + w.tokens, 0),
                },
                throughput: throughputData,
                queueMetrics,
                demographics,
                gamification: {
                    totalSessions,
                    pendingApprovals: pendingCount,
                    topPerformers,
                },
            });
        }
        catch (error) {
            console.error("Error loading analytics data:", error);
        }
        finally {
            setLoading(false);
        }
    }, [dateRange]);
    const exportAnalyticsCSV = useCallback(() => {
        if (!data)
            return;
        downloadCSV(`analytics-${dateRange.from}-to-${dateRange.to}.csv`, ["Date", "Registrations", "Vitals", "Consultations", "Dispenses"], data.throughput.map((d) => [
            d.date,
            String(d.registrations),
            String(d.vitals),
            String(d.consultations),
            String(d.dispenses),
        ]));
    }, [data, dateRange]);
    const exportQueueCSV = useCallback(() => {
        if (!data)
            return;
        downloadCSV(`queue-metrics-${dateRange.from}-to-${dateRange.to}.csv`, ["Stage", "Currently Waiting", "Avg Wait (min)", "Total Processed"], data.queueMetrics.map((q) => [
            q.stage,
            String(q.currentWaiting),
            String(q.avgWaitMinutes),
            String(q.throughput),
        ]));
    }, [data, dateRange]);
    const exportGamificationCSV = useCallback(() => {
        if (!data)
            return;
        downloadCSV(`gamification-${dateRange.from}-to-${dateRange.to}.csv`, ["Name", "Tokens", "Badges"], data.gamification.topPerformers.map((p) => [
            p.name,
            String(p.tokens),
            String(p.badges),
        ]));
    }, [data, dateRange]);
    useEffect(() => {
        if (hasAccess) {
            loadAnalyticsData();
        }
    }, [hasAccess, loadAnalyticsData]);
    if (!hasAccess) {
        return (_jsxs("div", { className: "text-center py-12", children: [_jsx(ChartBarIcon, { className: "h-12 w-12 mx-auto text-gray-400 mb-4" }), _jsx("h3", { className: "text-lg font-medium text-gray-900 mb-2", children: "Access Restricted" }), _jsx("p", { className: "text-gray-600", children: "Only administrators can access the analytics dashboard." })] }));
    }
    if (loading) {
        return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(ChartBarIcon, { className: "h-8 w-8 text-primary" }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Analytics Dashboard" }), _jsx("p", { className: "text-gray-600", children: "Loading clinic performance data..." })] })] }), _jsx("div", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6", children: [...Array(8)].map((_, i) => (_jsx("div", { className: "card animate-pulse", children: _jsx("div", { className: "h-20 bg-gray-200 rounded" }) }, i))) })] }));
    }
    if (!data)
        return null;
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(ChartBarIcon, { className: "h-8 w-8 text-primary" }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Analytics Dashboard" }), _jsx("p", { className: "text-gray-600", children: "Clinic performance and insights" })] })] }), _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(CalendarIcon, { className: "h-5 w-5 text-gray-400" }), _jsx("input", { type: "date", value: dateRange.from, onChange: (e) => setDateRange({ ...dateRange, from: e.target.value }), className: "input-field text-sm py-2" }), _jsx("span", { className: "text-gray-500", children: "to" }), _jsx("input", { type: "date", value: dateRange.to, onChange: (e) => setDateRange({ ...dateRange, to: e.target.value }), className: "input-field text-sm py-2" })] })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6", children: [_jsx("div", { className: "card bg-blue-50 border-blue-200", children: _jsxs("div", { className: "flex items-center", children: [_jsx("div", { className: "flex-shrink-0 p-2 rounded-lg bg-blue-100", children: _jsx(UsersIcon, { className: "h-6 w-6 text-blue-600" }) }), _jsxs("div", { className: "ml-4", children: [_jsx("p", { className: "text-sm font-medium text-blue-600", children: "Total Patients" }), _jsx("p", { className: "text-2xl font-bold text-blue-800", children: data.overview.totalPatients })] })] }) }), _jsx("div", { className: "card bg-green-50 border-green-200", children: _jsxs("div", { className: "flex items-center", children: [_jsx("div", { className: "flex-shrink-0 p-2 rounded-lg bg-green-100", children: _jsx(HeartIcon, { className: "h-6 w-6 text-green-600" }) }), _jsxs("div", { className: "ml-4", children: [_jsx("p", { className: "text-sm font-medium text-green-600", children: "Active / Completed Visits" }), _jsxs("p", { className: "text-2xl font-bold text-green-800", children: [data.overview.activeVisits, " / ", data.overview.completedVisits] })] })] }) }), _jsx("div", { className: "card bg-orange-50 border-orange-200", children: _jsxs("div", { className: "flex items-center", children: [_jsx("div", { className: "flex-shrink-0 p-2 rounded-lg bg-orange-100", children: _jsx(ClockIcon, { className: "h-6 w-6 text-orange-600" }) }), _jsxs("div", { className: "ml-4", children: [_jsx("p", { className: "text-sm font-medium text-orange-600", children: "Avg Wait Time" }), _jsx("p", { className: "text-2xl font-bold text-orange-800", children: data.overview.avgWaitTime > 0
                                                ? `${data.overview.avgWaitTime}m`
                                                : "N/A" })] })] }) }), _jsx("div", { className: "card bg-purple-50 border-purple-200", children: _jsxs("div", { className: "flex items-center", children: [_jsx("div", { className: "flex-shrink-0 p-2 rounded-lg bg-purple-100", children: _jsx(TrophyIcon, { className: "h-6 w-6 text-purple-600" }) }), _jsxs("div", { className: "ml-4", children: [_jsx("p", { className: "text-sm font-medium text-purple-600", children: "Tokens Awarded" }), _jsx("p", { className: "text-2xl font-bold text-purple-800", children: data.overview.tokensAwarded })] })] }) })] }), _jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Daily Throughput" }), _jsx(ResponsiveContainer, { width: "100%", height: 300, children: _jsxs(LineChart, { data: data.throughput, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3" }), _jsx(XAxis, { dataKey: "label", tick: { fontSize: 12 } }), _jsx(YAxis, { allowDecimals: false }), _jsx(Tooltip, {}), _jsx(Legend, {}), _jsx(Line, { type: "monotone", dataKey: "registrations", stroke: "#2563eb", strokeWidth: 2, dot: { r: 4 }, name: "Registrations" }), _jsx(Line, { type: "monotone", dataKey: "vitals", stroke: "#16a34a", strokeWidth: 2, dot: { r: 4 }, name: "Vitals" }), _jsx(Line, { type: "monotone", dataKey: "consultations", stroke: "#9333ea", strokeWidth: 2, dot: { r: 4 }, name: "Consultations" }), _jsx(Line, { type: "monotone", dataKey: "dispenses", stroke: "#ea580c", strokeWidth: 2, dot: { r: 4 }, name: "Dispenses" })] }) })] }), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-6", children: [_jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Queue Status" }), _jsx(ResponsiveContainer, { width: "100%", height: 250, children: _jsxs(BarChart, { data: data.queueMetrics, children: [_jsx(CartesianGrid, { strokeDasharray: "3 3" }), _jsx(XAxis, { dataKey: "stage", tick: { fontSize: 12 } }), _jsx(YAxis, { allowDecimals: false }), _jsx(Tooltip, {}), _jsx(Legend, {}), _jsx(Bar, { dataKey: "currentWaiting", fill: "#2563eb", name: "Waiting", radius: [4, 4, 0, 0] }), _jsx(Bar, { dataKey: "throughput", fill: "#16a34a", name: "Processed", radius: [4, 4, 0, 0] })] }) }), _jsx("div", { className: "mt-3 grid grid-cols-2 gap-2 text-sm", children: data.queueMetrics.map((q) => (_jsxs("div", { className: "flex justify-between px-2 py-1 bg-gray-50 rounded", children: [_jsx("span", { className: "capitalize text-gray-700", children: q.stage }), _jsx("span", { className: "text-gray-500", children: q.avgWaitMinutes > 0
                                                ? `~${q.avgWaitMinutes}m wait`
                                                : "No data" })] }, q.stage))) })] }), _jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Patients by State" }), data.demographics.length > 0 ? (_jsxs(_Fragment, { children: [_jsx(ResponsiveContainer, { width: "100%", height: 250, children: _jsxs(PieChart, { children: [_jsx(Pie, { data: data.demographics, cx: "50%", cy: "50%", outerRadius: 90, dataKey: "value", label: ({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`, children: data.demographics.map((_, index) => (_jsx(Cell, { fill: CHART_COLORS[index % CHART_COLORS.length] }, `cell-${index}`))) }), _jsx(Tooltip, {})] }) }), _jsx("div", { className: "mt-2 flex flex-wrap gap-2 justify-center", children: data.demographics.map((d, i) => (_jsxs("span", { className: "text-xs flex items-center gap-1", children: [_jsx("span", { className: "inline-block w-3 h-3 rounded-full", style: {
                                                        backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                                                    } }), d.name, ": ", d.value] }, d.name))) })] })) : (_jsx("p", { className: "text-gray-500 text-center py-12", children: "No patient data yet" }))] })] }), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-6", children: [_jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Top Performers" }), data.gamification.topPerformers.length > 0 ? (_jsx("div", { className: "space-y-3", children: data.gamification.topPerformers.map((performer, index) => (_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx("div", { className: "w-8 h-8 bg-primary rounded-full flex items-center justify-center text-white font-bold text-sm", children: index + 1 }), _jsxs("div", { children: [_jsx("span", { className: "font-medium text-gray-900", children: performer.name }), _jsxs("span", { className: "text-sm text-gray-600 ml-2", children: [performer.badges, " badges"] })] })] }), _jsx("span", { className: "text-lg font-bold text-primary", children: performer.tokens })] }, index))) })) : (_jsx("p", { className: "text-gray-500 text-center py-8", children: "No gamification data yet" }))] }), _jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Gamification Overview" }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-gray-700", children: "Total Game Sessions" }), _jsx("span", { className: "text-lg font-bold text-gray-900", children: data.gamification.totalSessions })] }), _jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-gray-700", children: "Pending Approvals" }), _jsxs("div", { className: "flex items-center space-x-2", children: [data.gamification.pendingApprovals > 0 && (_jsx(ExclamationTriangleIcon, { className: "h-4 w-4 text-yellow-600" })), _jsx("span", { className: "text-lg font-bold text-gray-900", children: data.gamification.pendingApprovals })] })] }), _jsxs("div", { className: "flex items-center justify-between", children: [_jsx("span", { className: "text-gray-700", children: "Total Tokens Awarded" }), _jsx("span", { className: "text-lg font-bold text-primary", children: data.overview.tokensAwarded })] })] }), data.gamification.pendingApprovals > 0 && (_jsx("div", { className: "mt-4 pt-4 border-t border-gray-200", children: _jsx("button", { className: "btn-primary w-full text-sm", children: "Review Pending Approvals" }) }))] })] }), _jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Data Export" }), _jsxs("div", { className: "grid grid-cols-2 md:grid-cols-3 gap-3", children: [_jsxs("button", { onClick: exportAnalyticsCSV, className: "btn-secondary text-sm flex items-center justify-center gap-2", children: [_jsx(ArrowDownTrayIcon, { className: "h-4 w-4" }), "Throughput (CSV)"] }), _jsxs("button", { onClick: exportQueueCSV, className: "btn-secondary text-sm flex items-center justify-center gap-2", children: [_jsx(ArrowDownTrayIcon, { className: "h-4 w-4" }), "Queue Metrics (CSV)"] }), _jsxs("button", { onClick: exportGamificationCSV, className: "btn-secondary text-sm flex items-center justify-center gap-2", children: [_jsx(ArrowDownTrayIcon, { className: "h-4 w-4" }), "Gamification (CSV)"] })] })] })] }));
}
