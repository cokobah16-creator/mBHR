import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect, memo } from 'react';
import { supabaseSync } from '@/services/supabaseSync';
import { ArrowPathIcon, CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
export const SyncButton = memo(() => {
    const [syncing, setSyncing] = useState(false);
    const [status, setStatus] = useState(supabaseSync.getStatus());
    useEffect(() => {
        return supabaseSync.onStatusChange(setStatus);
    }, []);
    if (!supabaseSync.isInitialized())
        return null;
    const handleSync = async () => {
        setSyncing(true);
        try {
            const result = await supabaseSync.syncAll();
            if (!result.success) {
                console.error('Sync failed:', result.error);
            }
        }
        catch (error) {
            console.error('Manual sync failed:', error);
        }
        finally {
            setSyncing(false);
        }
    };
    const showStatus = status.lastSync || status.errorMessage;
    return (_jsxs("div", { className: "flex items-center gap-2", children: [showStatus && (_jsxs("div", { className: "flex items-center gap-1 text-xs", children: [status.errorMessage ? (_jsxs(_Fragment, { children: [_jsx(ExclamationCircleIcon, { className: "h-4 w-4 text-red-500" }), _jsx("span", { className: "text-red-600", children: "Sync error" })] })) : status.lastSync ? (_jsxs(_Fragment, { children: [_jsx(CheckCircleIcon, { className: "h-4 w-4 text-green-500" }), _jsx("span", { className: "text-gray-600", children: new Date(status.lastSync).toLocaleTimeString() })] })) : null, status.pendingChanges > 0 && (_jsx("span", { className: "ml-1 px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs", children: status.pendingChanges }))] })), _jsx("button", { onClick: handleSync, disabled: syncing || status.status === 'syncing', className: "p-2 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50", title: syncing ? 'Syncing...' : 'Sync with cloud', children: _jsx(ArrowPathIcon, { className: `h-5 w-5 ${syncing || status.status === 'syncing' ? 'animate-spin' : ''}` }) })] }));
});
SyncButton.displayName = 'SyncButton';
