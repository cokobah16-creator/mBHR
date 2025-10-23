import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { EnvelopeIcon, ClockIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import { getPendingReminders, markReminderSent, markReminderFailed, getPatientReminders } from '@/services/sms';
export function SMSReminderManager({ patientId, dispenseId }) {
    const [reminders, setReminders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all');
    useEffect(() => {
        loadReminders();
    }, [patientId, filter]);
    const loadReminders = async () => {
        try {
            setLoading(true);
            let data;
            if (patientId) {
                data = await getPatientReminders(patientId);
            }
            else if (filter === 'pending') {
                data = await getPendingReminders();
            }
            else {
                data = await getPendingReminders();
            }
            setReminders(data);
        }
        catch (error) {
            console.error('Failed to load reminders:', error);
        }
        finally {
            setLoading(false);
        }
    };
    const handleMarkSent = async (id) => {
        try {
            await markReminderSent(id);
            await loadReminders();
        }
        catch (error) {
            console.error('Failed to mark reminder as sent:', error);
        }
    };
    const handleMarkFailed = async (id, errorMessage) => {
        try {
            await markReminderFailed(id, errorMessage);
            await loadReminders();
        }
        catch (error) {
            console.error('Failed to mark reminder as failed:', error);
        }
    };
    const filteredReminders = reminders.filter(r => {
        if (filter === 'all')
            return true;
        return r.status === filter;
    });
    const getStatusColor = (status) => {
        switch (status) {
            case 'sent':
                return 'text-green-600 bg-green-100';
            case 'failed':
                return 'text-red-600 bg-red-100';
            default:
                return 'text-yellow-600 bg-yellow-100';
        }
    };
    const getStatusIcon = (status) => {
        switch (status) {
            case 'sent':
                return _jsx(CheckCircleIcon, { className: "h-5 w-5" });
            case 'failed':
                return _jsx(XCircleIcon, { className: "h-5 w-5" });
            default:
                return _jsx(ClockIcon, { className: "h-5 w-5" });
        }
    };
    if (loading) {
        return (_jsx("div", { className: "flex items-center justify-center p-8", children: _jsx("div", { className: "animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" }) }));
    }
    return (_jsxs("div", { className: "bg-white rounded-lg shadow", children: [_jsx("div", { className: "px-4 py-5 sm:px-6 border-b border-gray-200", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center", children: [_jsx(EnvelopeIcon, { className: "h-6 w-6 text-gray-400 mr-2" }), _jsx("h3", { className: "text-lg font-medium text-gray-900", children: "SMS Medication Reminders" })] }), _jsxs("div", { className: "flex space-x-2", children: [_jsx("button", { onClick: () => setFilter('all'), className: `px-3 py-1 text-sm font-medium rounded-md ${filter === 'all'
                                        ? 'bg-indigo-100 text-indigo-700'
                                        : 'text-gray-500 hover:text-gray-700'}`, children: "All" }), _jsx("button", { onClick: () => setFilter('pending'), className: `px-3 py-1 text-sm font-medium rounded-md ${filter === 'pending'
                                        ? 'bg-yellow-100 text-yellow-700'
                                        : 'text-gray-500 hover:text-gray-700'}`, children: "Pending" }), _jsx("button", { onClick: () => setFilter('sent'), className: `px-3 py-1 text-sm font-medium rounded-md ${filter === 'sent'
                                        ? 'bg-green-100 text-green-700'
                                        : 'text-gray-500 hover:text-gray-700'}`, children: "Sent" }), _jsx("button", { onClick: () => setFilter('failed'), className: `px-3 py-1 text-sm font-medium rounded-md ${filter === 'failed'
                                        ? 'bg-red-100 text-red-700'
                                        : 'text-gray-500 hover:text-gray-700'}`, children: "Failed" })] })] }) }), _jsx("div", { className: "divide-y divide-gray-200", children: filteredReminders.length === 0 ? (_jsx("div", { className: "px-4 py-8 text-center text-gray-500", children: "No reminders found" })) : (filteredReminders.map((reminder) => (_jsx("div", { className: "px-4 py-4 sm:px-6 hover:bg-gray-50", children: _jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center", children: [_jsxs("span", { className: `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(reminder.status)}`, children: [getStatusIcon(reminder.status), _jsx("span", { className: "ml-1", children: reminder.status })] }), _jsx("span", { className: "ml-3 text-sm font-medium text-gray-900", children: reminder.medication_name })] }), _jsxs("div", { className: "mt-2 flex items-center text-sm text-gray-500", children: [_jsx(ClockIcon, { className: "flex-shrink-0 mr-1.5 h-4 w-4" }), "Scheduled: ", new Date(reminder.scheduled_at).toLocaleString()] }), reminder.sent_at && (_jsxs("div", { className: "mt-1 flex items-center text-sm text-gray-500", children: [_jsx(CheckCircleIcon, { className: "flex-shrink-0 mr-1.5 h-4 w-4" }), "Sent: ", new Date(reminder.sent_at).toLocaleString()] })), reminder.error_message && (_jsxs("div", { className: "mt-1 text-sm text-red-600", children: ["Error: ", reminder.error_message] }))] }), reminder.status === 'pending' && new Date(reminder.scheduled_at) <= new Date() && (_jsxs("div", { className: "flex space-x-2 ml-4", children: [_jsx("button", { onClick: () => handleMarkSent(reminder.id), className: "px-3 py-1 text-xs font-medium text-green-700 bg-green-100 rounded-md hover:bg-green-200", children: "Mark Sent" }), _jsx("button", { onClick: () => {
                                            const error = prompt('Error message:');
                                            if (error)
                                                handleMarkFailed(reminder.id, error);
                                        }, className: "px-3 py-1 text-xs font-medium text-red-700 bg-red-100 rounded-md hover:bg-red-200", children: "Mark Failed" })] }))] }) }, reminder.id)))) }), !patientId && (_jsx("div", { className: "px-4 py-3 bg-gray-50 text-right sm:px-6", children: _jsx("button", { onClick: loadReminders, className: "inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500", children: "Refresh" }) }))] }));
}
