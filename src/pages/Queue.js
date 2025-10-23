import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { db as mbhrDb } from '@/db/mbhr';
import { useQueue } from '@/stores/queue';
import { QueueListIcon, PlayIcon, CheckIcon, ClockIcon, UserGroupIcon, UserIcon, HeartIcon, DocumentTextIcon, BeakerIcon } from '@heroicons/react/24/outline';
const STAGES = ['registration', 'vitals', 'consult', 'pharmacy'];
// Helper functions
const asArray = (v) => (Array.isArray(v) ? v : []);
const shortTicket = (n) => {
    if (!n)
        return '—';
    const parts = String(n).split('-');
    return parts.length > 1 ? parts[1] : n;
};
const stageIcons = {
    registration: UserIcon,
    vitals: HeartIcon,
    consult: DocumentTextIcon,
    pharmacy: BeakerIcon
};
const stageColors = {
    registration: 'bg-blue-50 border-blue-200 text-blue-800',
    vitals: 'bg-green-50 border-green-200 text-green-800',
    consult: 'bg-purple-50 border-purple-200 text-purple-800',
    pharmacy: 'bg-orange-50 border-orange-200 text-orange-800'
};
export function Queue() {
    const { t } = useTranslation();
    const { callNext, completeCurrent, estimateTailMinutes, issueTicket } = useQueue();
    const [metrics, setMetrics] = useState([]);
    const [selectedStage, setSelectedStage] = useState('registration');
    const [etaTail, setEtaTail] = useState(0);
    // Use live queries with defensive defaults
    const allTicketsQ = useLiveQuery(() => mbhrDb.tickets.toArray(), [], []);
    const stageTicketsQ = useLiveQuery(() => mbhrDb.tickets
        .where('currentStage')
        .equals(selectedStage)
        .toArray(), [selectedStage], []);
    // Convert to safe arrays
    const allTickets = asArray(allTicketsQ);
    const stageTickets = asArray(stageTicketsQ);
    useEffect(() => {
        loadMetrics();
        updateETA();
    }, [selectedStage]);
    const loadMetrics = async () => {
        try {
            const metricsData = await mbhrDb.queue_metrics.toArray();
            setMetrics(metricsData);
        }
        catch (error) {
            console.error('Error loading metrics:', error);
        }
    };
    const updateETA = async () => {
        try {
            const eta = await estimateTailMinutes(selectedStage);
            setEtaTail(eta);
        }
        catch (error) {
            console.error('Error updating ETA:', error);
        }
    };
    // Safe filtering
    const waiting = stageTickets.filter(t => t?.state === 'waiting');
    const inProgress = stageTickets.find(t => t?.state === 'in_progress') ?? null;
    const doneToday = stageTickets.filter(t => t?.state === 'done');
    const handleCallNext = async () => {
        const next = await callNext(selectedStage);
        if (next) {
            await updateETA();
        }
    };
    const handleCompleteCurrent = async () => {
        await completeCurrent(selectedStage, 240); // 4 minutes default
        await updateETA();
    };
    // Generate demo tickets if none exist
    const generateDemoTickets = async () => {
        const categories = ['adult', 'child', 'antenatal'];
        const priorities = ['normal', 'urgent'];
        for (let i = 1; i <= 8; i++) {
            await issueTicket({
                siteId: 'demo-site',
                category: categories[i % 3],
                priority: i <= 2 ? 'urgent' : 'normal',
                stage: STAGES[Math.floor(Math.random() * STAGES.length)]
            });
        }
    };
    const metric = metrics.find(m => m?.stage === selectedStage);
    const avgServiceSec = metric?.avgServiceSec ?? 240;
    const getPriorityColor = (priority) => {
        return priority === 'urgent' ? 'text-red-600' : 'text-gray-600';
    };
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(QueueListIcon, { className: "h-8 w-8 text-primary" }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: t('nav.queue') }), _jsx("p", { className: "text-gray-600", children: "Manage patient flow through care stages" })] })] }), _jsxs("div", { className: "card", children: [_jsx("h2", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Queue Overview" }), _jsx("div", { className: "grid grid-cols-2 md:grid-cols-4 gap-4", children: STAGES.map((stageName) => {
                            const stageItems = asArray(useLiveQuery(() => mbhrDb.tickets.where('currentStage').equals(stageName).toArray(), [stageName], [])).filter(item => item?.state !== 'done');
                            const Icon = stageIcons[stageName];
                            return (_jsxs("div", { className: `p-4 rounded-lg border ${stageColors[stageName]}`, children: [_jsxs("div", { className: "flex items-center space-x-2 mb-2", children: [_jsx(Icon, { className: "h-5 w-5" }), _jsx("span", { className: "font-medium capitalize", children: stageName })] }), _jsx("p", { className: "text-2xl font-bold", children: stageItems.length }), _jsxs("p", { className: "text-sm opacity-75", children: [stageItems.filter(item => item?.state === 'in_progress').length, " active"] })] }, stageName));
                        }) })] }), _jsxs("div", { className: "card", children: [_jsx("h2", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Queue Management" }), _jsx("div", { className: "flex space-x-2 overflow-x-auto mb-6", children: STAGES.map(stage => {
                            const stageCount = allTickets.filter(t => t?.currentStage === stage && t?.state !== 'done').length;
                            return (_jsxs("button", { onClick: () => setSelectedStage(stage), className: `px-4 py-2 rounded-lg border font-medium capitalize whitespace-nowrap ${selectedStage === stage
                                    ? stageColors[stage]
                                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`, children: [stage, " (", stageCount, ")"] }, stage));
                        }) }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-4 gap-4 mb-6", children: [_jsxs("div", { className: "bg-blue-50 border border-blue-200 rounded-lg p-4", children: [_jsx("div", { className: "text-sm text-blue-600", children: "Waiting" }), _jsx("div", { className: "text-2xl font-bold text-blue-800", children: waiting.length })] }), _jsxs("div", { className: "bg-yellow-50 border border-yellow-200 rounded-lg p-4", children: [_jsx("div", { className: "text-sm text-yellow-600", children: "In Progress" }), _jsx("div", { className: "text-2xl font-bold text-yellow-800", children: inProgress ? '1' : '0' })] }), _jsxs("div", { className: "bg-green-50 border border-green-200 rounded-lg p-4", children: [_jsx("div", { className: "text-sm text-green-600", children: "Avg Service Time" }), _jsxs("div", { className: "text-2xl font-bold text-green-800", children: [Math.round(avgServiceSec / 60), "m"] })] }), _jsxs("div", { className: "bg-purple-50 border border-purple-200 rounded-lg p-4", children: [_jsx("div", { className: "text-sm text-purple-600", children: "ETA for Last" }), _jsxs("div", { className: "text-2xl font-bold text-purple-800", children: [etaTail, "m"] })] })] }), _jsxs("div", { className: "flex space-x-4 mb-6", children: [_jsxs("button", { className: "btn-primary flex items-center space-x-2", onClick: handleCallNext, disabled: waiting.length === 0 || !!inProgress, children: [_jsx(PlayIcon, { className: "h-5 w-5" }), _jsx("span", { children: "Call Next" })] }), _jsxs("button", { className: "btn-secondary flex items-center space-x-2", onClick: handleCompleteCurrent, disabled: !inProgress, children: [_jsx(CheckIcon, { className: "h-5 w-5" }), _jsx("span", { children: "Complete Current" })] }), allTickets.length === 0 && (_jsxs("button", { className: "btn-secondary flex items-center space-x-2", onClick: generateDemoTickets, children: [_jsx(UserGroupIcon, { className: "h-5 w-5" }), _jsx("span", { children: "Generate Demo Tickets" })] }))] }), _jsxs("div", { className: "mb-6", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Now Serving" }), inProgress ? (_jsxs("div", { className: "flex items-center space-x-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg", children: [_jsx("div", { className: "w-12 h-12 bg-yellow-600 rounded-full flex items-center justify-center text-white font-bold text-lg", children: shortTicket(inProgress?.number) }), _jsxs("div", { children: [_jsx("div", { className: "text-xl font-bold text-gray-900", children: inProgress?.number ?? '—' }), _jsxs("div", { className: "text-sm text-gray-600 capitalize", children: [inProgress?.category ?? '—', " \u2022 ", inProgress?.priority ?? '—', " priority"] })] })] })) : (_jsxs("div", { className: "text-center py-8 text-gray-500", children: [_jsx(ClockIcon, { className: "h-12 w-12 mx-auto mb-4 opacity-50" }), _jsx("p", { children: "No patient currently being served" })] }))] }), _jsxs("div", { children: [_jsxs("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: ["Waiting Queue (", waiting.length, ")"] }), waiting.length === 0 ? (_jsx("div", { className: "text-center py-8 text-gray-500", children: _jsxs("p", { children: ["No patients waiting in ", selectedStage] }) })) : (_jsxs("div", { className: "space-y-2", children: [waiting.slice(0, 10).map((ticket, index) => (_jsxs("div", { className: `flex items-center justify-between p-3 border rounded-lg ${index === 0 ? 'border-green-200 bg-green-50' : 'border-gray-200'}`, children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx("div", { className: "w-8 h-8 bg-gray-600 rounded-full flex items-center justify-center text-white font-bold text-sm", children: index + 1 }), _jsxs("div", { children: [_jsx("div", { className: "font-medium text-gray-900", children: ticket?.number ?? '—' }), _jsxs("div", { className: "text-sm text-gray-600 capitalize", children: [ticket?.category ?? '—', " \u2022", _jsxs("span", { className: getPriorityColor(ticket?.priority ?? ''), children: [ticket?.priority ?? '—', " priority"] })] })] })] }), _jsx("div", { className: "text-sm text-gray-500", children: index === 0 ? 'Next' : `~${(index * avgServiceSec) / 60}m` })] }, ticket?.id))), waiting.length > 10 && (_jsxs("div", { className: "text-center text-sm text-gray-500 py-2", children: ["... and ", waiting.length - 10, " more patients"] }))] }))] })] })] }));
}
