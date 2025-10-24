import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState, useCallback } from 'react';
import { useT } from '@/hooks/useT';
import { getMessageService } from '@/services/messaging';
import { MessageQueue } from '@/db/outbox';
import { useAuthStore } from '@/stores/auth';
import { can } from '@/auth/roles';
import { ChatBubbleLeftRightIcon, PaperAirplaneIcon, ExclamationTriangleIcon, CheckCircleIcon, ClockIcon, XCircleIcon } from '@heroicons/react/24/outline';
import * as logger from '@/lib/logger';
export function MessageOutbox() {
    const { t } = useT();
    const { currentUser } = useAuthStore();
    const [stats, setStats] = useState({ queued: 0, sent: 0, failed: 0, delivered: 0 });
    const [processing, setProcessing] = useState(false);
    const [lastSync, setLastSync] = useState(null);
    const loadStats = useCallback(async () => {
        try {
            const messageStats = await MessageQueue.getStats();
            setStats(messageStats);
        }
        catch (error) {
            logger.error('Error loading message stats:', error);
        }
    }, []);
    useEffect(() => {
        loadStats();
        const interval = setInterval(loadStats, 30000); // Refresh every 30 seconds
        return () => clearInterval(interval);
    }, [loadStats]);
    const processMessages = useCallback(async () => {
        setProcessing(true);
        try {
            const messageService = getMessageService();
            const result = await messageService.processOutbox();
            setLastSync(new Date());
            await loadStats();
            if (result.sent > 0 || result.failed > 0) {
                alert(t('messaging.processComplete', {
                    sent: result.sent.toString(),
                    failed: result.failed.toString()
                }));
            }
            else {
                alert(t('messaging.noMessages'));
            }
        }
        catch (error) {
            logger.error('Error processing outbox:', error);
            alert(t('messaging.processError'));
        }
        finally {
            setProcessing(false);
        }
    }, [t, loadStats]);
    // Only admins and nurses can manage messaging
    if (!currentUser || !can(currentUser.role, 'export')) {
        return null;
    }
    const getStatusIcon = (status) => {
        switch (status) {
            case 'queued':
                return ClockIcon;
            case 'sent':
                return CheckCircleIcon;
            case 'delivered':
                return CheckCircleIcon;
            case 'failed':
                return XCircleIcon;
            default:
                return ClockIcon;
        }
    };
    const getStatusColor = (status) => {
        switch (status) {
            case 'queued':
                return 'text-yellow-600 bg-yellow-50';
            case 'sent':
                return 'text-blue-600 bg-blue-50';
            case 'delivered':
                return 'text-green-600 bg-green-50';
            case 'failed':
                return 'text-red-600 bg-red-50';
            default:
                return 'text-gray-600 bg-gray-50';
        }
    };
    return (_jsxs("div", { className: "card", children: [_jsxs("div", { className: "flex items-center justify-between mb-6", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(ChatBubbleLeftRightIcon, { className: "h-6 w-6 text-primary" }), _jsx("h3", { className: "text-lg font-semibold text-gray-900", children: t('messaging.outbox') })] }), _jsxs("button", { onClick: processMessages, disabled: processing || stats.queued === 0, className: "btn-primary inline-flex items-center space-x-2 disabled:opacity-50", children: [_jsx(PaperAirplaneIcon, { className: "h-4 w-4" }), _jsx("span", { children: processing ? t('messaging.sending') : t('messaging.sendQueued') })] })] }), _jsxs("div", { className: "grid grid-cols-2 md:grid-cols-4 gap-4 mb-6", children: [_jsxs("div", { className: "text-center p-4 bg-yellow-50 rounded-lg", children: [_jsx("div", { className: "text-2xl font-bold text-yellow-800", children: stats.queued }), _jsx("div", { className: "text-sm text-yellow-600", children: t('messaging.queued') })] }), _jsxs("div", { className: "text-center p-4 bg-blue-50 rounded-lg", children: [_jsx("div", { className: "text-2xl font-bold text-blue-800", children: stats.sent }), _jsx("div", { className: "text-sm text-blue-600", children: t('messaging.sent') })] }), _jsxs("div", { className: "text-center p-4 bg-green-50 rounded-lg", children: [_jsx("div", { className: "text-2xl font-bold text-green-800", children: stats.delivered }), _jsx("div", { className: "text-sm text-green-600", children: t('messaging.delivered') })] }), _jsxs("div", { className: "text-center p-4 bg-red-50 rounded-lg", children: [_jsx("div", { className: "text-2xl font-bold text-red-800", children: stats.failed }), _jsx("div", { className: "text-sm text-red-600", children: t('messaging.failed') })] })] }), _jsxs("div", { className: "flex items-center justify-between text-sm text-gray-600", children: [_jsx("div", { children: lastSync ? (_jsxs("span", { children: [t('messaging.lastSync'), ": ", lastSync.toLocaleTimeString()] })) : (_jsx("span", { children: t('messaging.neverSynced') })) }), _jsx("div", { className: "flex items-center space-x-2", children: navigator.onLine ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "w-2 h-2 bg-green-500 rounded-full" }), _jsx("span", { children: t('status.online') })] })) : (_jsxs(_Fragment, { children: [_jsx("div", { className: "w-2 h-2 bg-red-500 rounded-full" }), _jsx("span", { children: t('status.offline') })] })) })] }), stats.queued > 0 && !navigator.onLine && (_jsx("div", { className: "mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3", children: _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(ExclamationTriangleIcon, { className: "h-5 w-5 text-yellow-600" }), _jsx("span", { className: "text-sm text-yellow-800", children: t('messaging.offlineQueue', { count: stats.queued.toString() }) })] }) }))] }));
}
