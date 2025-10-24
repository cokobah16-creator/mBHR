import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { enhancedSync } from '@/services/enhancedSync';
import { ArrowPathIcon, CheckCircleIcon, ExclamationTriangleIcon, ClockIcon } from '@heroicons/react/24/outline';
import { useT } from '@/hooks/useT';
export function SyncDashboard() {
    const { t } = useT();
    const [stats, setStats] = useState({
        pending: 0,
        lastSync: {},
        syncing: false
    });
    const [syncResult, setSyncResult] = useState(null);
    useEffect(() => {
        loadStats();
        const interval = setInterval(loadStats, 30000); // Refresh every 30s
        return () => clearInterval(interval);
    }, []);
    const loadStats = async () => {
        if (!enhancedSync.isInitialized())
            return;
        const pending = await enhancedSync.getPendingChangesCount();
        const syncing = enhancedSync.isSyncing();
        const tables = [
            'patients', 'visits', 'vitals', 'consultations', 'dispenses',
            'inventory', 'queue', 'gameSessions', 'gamificationWallets',
            'stockBatches', 'careTasks', 'triageRecords',
            'patientAllergies', 'patientPreferences'
        ];
        const lastSync = {};
        tables.forEach(table => {
            lastSync[table] = enhancedSync.getLastSyncTime(table);
        });
        setStats({ pending, lastSync, syncing });
    };
    const handleSync = async () => {
        if (stats.syncing)
            return;
        setStats(prev => ({ ...prev, syncing: true }));
        const result = await enhancedSync.syncAll();
        if (result.success) {
            setSyncResult({
                pushed: result.pushed,
                pulled: result.pulled,
                conflicts: result.conflicts
            });
            setTimeout(() => setSyncResult(null), 5000);
        }
        await loadStats();
    };
    const formatLastSync = (date) => {
        if (!date)
            return 'Never';
        const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
        if (seconds < 60)
            return 'Just now';
        if (seconds < 3600)
            return `${Math.floor(seconds / 60)} min ago`;
        if (seconds < 86400)
            return `${Math.floor(seconds / 3600)} hours ago`;
        return `${Math.floor(seconds / 86400)} days ago`;
    };
    if (!enhancedSync.isInitialized()) {
        return (_jsx("div", { className: "bg-gray-50 p-4 rounded-lg", children: _jsx("p", { className: "text-sm text-gray-600", children: "Sync not configured" }) }));
    }
    return (_jsxs("div", { className: "bg-white shadow rounded-lg p-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-6", children: [_jsx("h2", { className: "text-lg font-medium text-gray-900", children: "Data Sync" }), _jsxs("button", { onClick: handleSync, disabled: stats.syncing, className: "inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed", children: [_jsx(ArrowPathIcon, { className: `-ml-1 mr-2 h-5 w-5 ${stats.syncing ? 'animate-spin' : ''}` }), stats.syncing ? 'Syncing...' : 'Sync Now'] })] }), syncResult && (_jsx("div", { className: "mb-6 bg-green-50 border border-green-200 rounded-md p-4", children: _jsxs("div", { className: "flex", children: [_jsx(CheckCircleIcon, { className: "h-5 w-5 text-green-400" }), _jsxs("div", { className: "ml-3", children: [_jsx("p", { className: "text-sm font-medium text-green-800", children: "Sync Completed" }), _jsxs("p", { className: "text-sm text-green-700 mt-1", children: ["Pushed: ", syncResult.pushed, " | Pulled: ", syncResult.pulled, syncResult.conflicts > 0 && ` | Conflicts: ${syncResult.conflicts}`] })] })] }) })), _jsxs("div", { className: "grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6", children: [_jsx("div", { className: "bg-blue-50 overflow-hidden rounded-lg px-4 py-5", children: _jsxs("div", { className: "flex items-center", children: [_jsx("div", { className: "flex-shrink-0", children: _jsx(ClockIcon, { className: "h-6 w-6 text-blue-600" }) }), _jsx("div", { className: "ml-5 w-0 flex-1", children: _jsxs("dl", { children: [_jsx("dt", { className: "text-sm font-medium text-blue-900 truncate", children: "Pending Changes" }), _jsx("dd", { className: "text-3xl font-semibold text-blue-900", children: stats.pending })] }) })] }) }), _jsx("div", { className: "bg-green-50 overflow-hidden rounded-lg px-4 py-5", children: _jsxs("div", { className: "flex items-center", children: [_jsx("div", { className: "flex-shrink-0", children: _jsx(CheckCircleIcon, { className: "h-6 w-6 text-green-600" }) }), _jsx("div", { className: "ml-5 w-0 flex-1", children: _jsxs("dl", { children: [_jsx("dt", { className: "text-sm font-medium text-green-900 truncate", children: "Status" }), _jsx("dd", { className: "text-sm font-semibold text-green-900", children: stats.syncing ? 'Active' : 'Idle' })] }) })] }) }), _jsx("div", { className: "bg-gray-50 overflow-hidden rounded-lg px-4 py-5", children: _jsxs("div", { className: "flex items-center", children: [_jsx("div", { className: "flex-shrink-0", children: _jsx(ArrowPathIcon, { className: "h-6 w-6 text-gray-600" }) }), _jsx("div", { className: "ml-5 w-0 flex-1", children: _jsxs("dl", { children: [_jsx("dt", { className: "text-sm font-medium text-gray-900 truncate", children: "Last Full Sync" }), _jsx("dd", { className: "text-sm font-semibold text-gray-900", children: formatLastSync(stats.lastSync.patients) })] }) })] }) })] }), _jsxs("div", { className: "border-t border-gray-200 pt-4", children: [_jsx("h3", { className: "text-sm font-medium text-gray-900 mb-3", children: "Table Status" }), _jsx("div", { className: "space-y-2", children: Object.entries(stats.lastSync).map(([table, date]) => (_jsxs("div", { className: "flex items-center justify-between text-sm", children: [_jsx("span", { className: "text-gray-600 capitalize", children: table }), _jsx("span", { className: `${date ? 'text-gray-900' : 'text-gray-400'}`, children: formatLastSync(date) })] }, table))) })] }), stats.pending > 0 && (_jsx("div", { className: "mt-4 bg-yellow-50 border border-yellow-200 rounded-md p-4", children: _jsxs("div", { className: "flex", children: [_jsx(ExclamationTriangleIcon, { className: "h-5 w-5 text-yellow-400" }), _jsx("div", { className: "ml-3", children: _jsxs("p", { className: "text-sm font-medium text-yellow-800", children: [stats.pending, " changes waiting to sync"] }) })] }) }))] }));
}
