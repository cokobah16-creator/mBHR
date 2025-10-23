import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { useSyncStore, getRetryDelay } from '@/stores/syncStore';
import { CloudIcon, CloudArrowUpIcon, ExclamationCircleIcon, CheckCircleIcon, WifiIcon, SignalSlashIcon, } from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
export function SyncIndicator() {
    const { t } = useTranslation();
    const [showPanel, setShowPanel] = useState(false);
    const { status, pendingCount, lastSuccessAt, lastErrorAt, retries, errorMessage, isOnline, } = useSyncStore();
    const getStatusIcon = () => {
        if (!isOnline) {
            return _jsx(SignalSlashIcon, { className: "h-5 w-5 text-gray-500" });
        }
        switch (status) {
            case 'syncing':
                return (_jsx(CloudArrowUpIcon, { className: "h-5 w-5 text-blue-500 animate-pulse" }));
            case 'error':
                return _jsx(ExclamationCircleIcon, { className: "h-5 w-5 text-red-500" });
            case 'ok':
                return _jsx(CheckCircleIcon, { className: "h-5 w-5 text-green-500" });
            default:
                return _jsx(CloudIcon, { className: "h-5 w-5 text-gray-400" });
        }
    };
    const getStatusColor = () => {
        if (!isOnline)
            return 'bg-gray-100 border-gray-300';
        switch (status) {
            case 'syncing':
                return 'bg-blue-50 border-blue-300';
            case 'error':
                return 'bg-red-50 border-red-300';
            case 'ok':
                return 'bg-green-50 border-green-300';
            default:
                return 'bg-gray-50 border-gray-300';
        }
    };
    const formatTimestamp = (timestamp) => {
        if (!timestamp)
            return t('messaging.neverSynced') || 'Never';
        const now = Date.now();
        const diff = now - timestamp;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        if (seconds < 60)
            return `${seconds}s ago`;
        if (minutes < 60)
            return `${minutes}m ago`;
        if (hours < 24)
            return `${hours}h ago`;
        return `${days}d ago`;
    };
    const nextRetryDelay = retries > 0 ? getRetryDelay(retries) / 1000 : 0;
    return (_jsxs(_Fragment, { children: [_jsxs("button", { onClick: () => setShowPanel(!showPanel), className: `
          flex items-center gap-2 px-3 py-1.5 rounded-full border
          ${getStatusColor()}
          transition-all hover:shadow-md
          focus:outline-none focus:ring-2 focus:ring-primary
        `, title: isOnline ? t('status.online') : t('status.offline'), children: [getStatusIcon(), !isOnline && (_jsx("span", { className: "text-xs font-medium text-gray-600", children: t('status.offline') })), isOnline && status === 'syncing' && (_jsx("span", { className: "text-xs font-medium text-blue-600", children: t('status.syncing') })), pendingCount > 0 && (_jsx("span", { className: "flex items-center justify-center h-5 min-w-[20px] px-1.5 text-xs font-bold text-white bg-orange-500 rounded-full", children: pendingCount }))] }), showPanel && (_jsxs(_Fragment, { children: [_jsx("div", { className: "fixed inset-0 bg-black bg-opacity-25 z-40", onClick: () => setShowPanel(false) }), _jsxs("div", { className: "absolute top-full right-0 mt-2 w-80 bg-white rounded-lg shadow-xl border z-50 overflow-hidden", children: [_jsx("div", { className: "p-4 bg-gray-50 border-b", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h3", { className: "font-semibold text-gray-900", children: "Sync Status" }), _jsx("button", { onClick: () => setShowPanel(false), className: "text-gray-500 hover:text-gray-700", children: "\u2715" })] }) }), _jsxs("div", { className: "p-4 space-y-3", children: [_jsxs("div", { className: "flex items-center gap-2", children: [isOnline ? (_jsx(WifiIcon, { className: "h-5 w-5 text-green-500" })) : (_jsx(SignalSlashIcon, { className: "h-5 w-5 text-gray-500" })), _jsx("span", { className: "text-sm", children: isOnline ? t('status.online') : t('status.offline') })] }), _jsxs("div", { className: "flex items-center gap-2", children: [getStatusIcon(), _jsx("span", { className: "text-sm capitalize", children: status })] }), pendingCount > 0 && (_jsxs("div", { className: "p-3 bg-orange-50 border border-orange-200 rounded-lg", children: [_jsxs("p", { className: "text-sm text-orange-900", children: [_jsx("strong", { children: pendingCount }), ' ', pendingCount === 1 ? 'operation' : 'operations', " pending"] }), !isOnline && (_jsx("p", { className: "text-xs text-orange-700 mt-1", children: "Will sync automatically when online" }))] })), lastSuccessAt > 0 && (_jsxs("div", { className: "text-sm text-gray-600", children: [_jsx("span", { className: "font-medium", children: "Last sync:" }), ' ', formatTimestamp(lastSuccessAt)] })), status === 'error' && (_jsxs("div", { className: "p-3 bg-red-50 border border-red-200 rounded-lg", children: [_jsx("p", { className: "text-sm font-medium text-red-900", children: "Sync Error" }), errorMessage && (_jsx("p", { className: "text-xs text-red-700 mt-1", children: errorMessage })), retries > 0 && (_jsxs("p", { className: "text-xs text-red-600 mt-2", children: ["Retrying in ", nextRetryDelay, "s... (attempt ", retries, ")"] }))] })), status === 'ok' && pendingCount === 0 && (_jsx("div", { className: "p-3 bg-green-50 border border-green-200 rounded-lg", children: _jsx("p", { className: "text-sm text-green-900", children: "\u2713 All data synchronized" }) }))] })] })] }))] }));
}
