import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { SMSReminderManager } from '@/features/pharmacy/SMSReminderManager';
export default function SMSReminders() {
    return (_jsxs("main", { className: "p-4 sm:p-6 max-w-7xl mx-auto", children: [_jsx("div", { className: "mb-4", children: _jsxs(Link, { to: "/pharmacy", className: "inline-flex items-center gap-2 text-sm text-gray-700 hover:text-gray-900 focus:outline-none focus:ring", children: [_jsx(ArrowLeftIcon, { className: "h-4 w-4", "aria-hidden": true }), "Back to Pharmacy Menu"] }) }), _jsx("h1", { className: "text-2xl font-bold mb-2", children: "SMS Medication Reminders" }), _jsx("p", { className: "text-gray-600 mb-6", children: "Manage and track medication reminders sent to patients" }), _jsx(SMSReminderManager, {})] }));
}
