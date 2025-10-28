import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { doctorService } from '@/services/doctorService';
import { useAuthStore } from '@/stores/auth';
import { FlagIcon, CheckCircleIcon, XMarkIcon, ClockIcon, UserIcon } from '@heroicons/react/24/outline';
export function PatientFlagsPanel({ org_id, site_id, event_id, station }) {
    const { currentUser } = useAuthStore();
    const [flags, setFlags] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedFlag, setSelectedFlag] = useState(null);
    const [resolutionNote, setResolutionNote] = useState('');
    useEffect(() => {
        loadFlags();
        const interval = setInterval(loadFlags, 15000);
        return () => clearInterval(interval);
    }, [org_id, site_id, event_id, station]);
    const loadFlags = async () => {
        try {
            const openFlags = await doctorService.getPatientFlags({
                org_id,
                site_id,
                event_id,
                to_station: station,
                status: 'open'
            });
            openFlags.sort((a, b) => {
                const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
                return priorityOrder[a.priority] - priorityOrder[b.priority];
            });
            setFlags(openFlags);
        }
        catch (error) {
            console.error('Error loading patient flags:', error);
        }
        finally {
            setLoading(false);
        }
    };
    const handleResolveFlag = async (flag) => {
        if (!currentUser)
            return;
        const success = await doctorService.resolvePatientFlag(flag.id, currentUser.id, resolutionNote || undefined);
        if (success) {
            setFlags(flags.filter(f => f.id !== flag.id));
            setSelectedFlag(null);
            setResolutionNote('');
        }
    };
    const handleAcknowledgeFlag = async (flag) => {
        if (!currentUser)
            return;
        const success = await doctorService.resolvePatientFlag(flag.id, currentUser.id, 'Acknowledged - will handle');
        if (success) {
            setFlags(flags.filter(f => f.id !== flag.id));
        }
    };
    const getPriorityColor = (priority) => {
        switch (priority) {
            case 'urgent':
                return 'bg-red-100 border-red-300 text-red-900';
            case 'high':
                return 'bg-orange-100 border-orange-300 text-orange-900';
            case 'normal':
                return 'bg-blue-100 border-blue-300 text-blue-900';
            case 'low':
                return 'bg-gray-100 border-gray-300 text-gray-900';
            default:
                return 'bg-gray-100 border-gray-300 text-gray-900';
        }
    };
    const getTimeAgo = (timestamp) => {
        const now = new Date();
        const flagTime = new Date(timestamp);
        const diffMs = now.getTime() - flagTime.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 1)
            return 'Just now';
        if (diffMins < 60)
            return `${diffMins}m ago`;
        return `${Math.floor(diffMins / 60)}h ${diffMins % 60}m ago`;
    };
    if (loading) {
        return (_jsx("div", { className: "bg-white rounded-lg shadow-sm p-4", children: _jsxs("div", { className: "animate-pulse space-y-3", children: [_jsx("div", { className: "h-4 bg-gray-200 rounded w-1/4" }), _jsx("div", { className: "h-20 bg-gray-200 rounded" })] }) }));
    }
    if (flags.length === 0) {
        return (_jsxs("div", { className: "bg-white rounded-lg shadow-sm p-4", children: [_jsxs("div", { className: "flex items-center space-x-2 mb-3", children: [_jsx(FlagIcon, { className: "h-5 w-5 text-gray-400" }), _jsx("h3", { className: "font-semibold text-gray-900", children: "Station Alerts" })] }), _jsx("p", { className: "text-sm text-gray-500", children: "No pending flags for your station" })] }));
    }
    return (_jsxs("div", { className: "bg-white rounded-lg shadow-sm p-4", children: [_jsx("div", { className: "flex items-center justify-between mb-4", children: _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(FlagIcon, { className: "h-5 w-5 text-orange-600" }), _jsx("h3", { className: "font-semibold text-gray-900", children: "Station Alerts" }), _jsx("span", { className: "bg-orange-100 text-orange-800 text-xs font-medium px-2 py-0.5 rounded-full", children: flags.length })] }) }), _jsx("div", { className: "space-y-3", children: flags.map((flag) => (_jsx("div", { className: `border-2 rounded-lg p-3 ${getPriorityColor(flag.priority)}`, children: _jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center space-x-2 mb-1", children: [_jsx("span", { className: "text-xs font-semibold uppercase tracking-wide", children: flag.flag_type.replace(/_/g, ' ') }), flag.priority === 'urgent' && (_jsx("span", { className: "text-xs bg-red-600 text-white px-2 py-0.5 rounded-full", children: "URGENT" }))] }), _jsx("p", { className: "text-sm font-medium mb-2", children: flag.message }), _jsxs("div", { className: "flex items-center space-x-4 text-xs", children: [_jsxs("div", { className: "flex items-center space-x-1", children: [_jsx(UserIcon, { className: "h-3 w-3" }), _jsxs("span", { children: ["From: ", flag.from_station] })] }), _jsxs("div", { className: "flex items-center space-x-1", children: [_jsx(ClockIcon, { className: "h-3 w-3" }), _jsx("span", { children: getTimeAgo(flag.created_at) })] })] }), flag.context && Object.keys(flag.context).length > 0 && (_jsx("div", { className: "mt-2 text-xs", children: _jsxs("details", { className: "cursor-pointer", children: [_jsx("summary", { className: "font-medium", children: "Additional Context" }), _jsx("pre", { className: "mt-1 bg-white bg-opacity-50 p-2 rounded text-xs overflow-auto", children: JSON.stringify(flag.context, null, 2) })] }) }))] }), _jsxs("div", { className: "flex space-x-2 ml-4", children: [_jsx("button", { onClick: () => handleAcknowledgeFlag(flag), className: "p-1 hover:bg-white hover:bg-opacity-50 rounded", title: "Acknowledge", children: _jsx(CheckCircleIcon, { className: "h-5 w-5" }) }), _jsx("button", { onClick: () => setSelectedFlag(flag), className: "p-1 hover:bg-white hover:bg-opacity-50 rounded", title: "Resolve with note", children: _jsx(XMarkIcon, { className: "h-5 w-5" }) })] })] }) }, flag.id))) }), selectedFlag && (_jsx("div", { className: "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50", children: _jsxs("div", { className: "bg-white rounded-lg p-6 max-w-md w-full mx-4", children: [_jsx("h3", { className: "text-lg font-semibold mb-4", children: "Resolve Flag" }), _jsxs("div", { className: "mb-4", children: [_jsxs("p", { className: "text-sm text-gray-600 mb-2", children: [_jsx("strong", { children: "Flag:" }), " ", selectedFlag.flag_type.replace(/_/g, ' ')] }), _jsxs("p", { className: "text-sm text-gray-600", children: [_jsx("strong", { children: "Message:" }), " ", selectedFlag.message] })] }), _jsxs("div", { className: "mb-4", children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Resolution Note (Optional)" }), _jsx("textarea", { value: resolutionNote, onChange: (e) => setResolutionNote(e.target.value), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500", rows: 3, placeholder: "Add any notes about how this was resolved..." })] }), _jsxs("div", { className: "flex justify-end space-x-3", children: [_jsx("button", { onClick: () => {
                                        setSelectedFlag(null);
                                        setResolutionNote('');
                                    }, className: "btn-secondary", children: "Cancel" }), _jsx("button", { onClick: () => handleResolveFlag(selectedFlag), className: "btn-primary", children: "Resolve" })] })] }) }))] }));
}
