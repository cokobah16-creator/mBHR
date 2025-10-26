import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Session Warning Dialog
 *
 * Displays a warning when user session is about to expire
 * Provides options to extend the session or logout
 */
import { useEffect, useState } from 'react';
import { ExclamationTriangleIcon, ClockIcon } from '@heroicons/react/24/outline';
import { formatTimeRemaining } from '@/utils/sessionManager';
export function SessionWarning({ isOpen, timeRemaining, userType, onExtend, onLogout }) {
    const [countdown, setCountdown] = useState(timeRemaining);
    useEffect(() => {
        setCountdown(timeRemaining);
    }, [timeRemaining]);
    useEffect(() => {
        if (!isOpen || countdown <= 0)
            return;
        const timer = setInterval(() => {
            setCountdown(prev => {
                if (prev <= 1) {
                    clearInterval(timer);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, [isOpen, countdown]);
    if (!isOpen)
        return null;
    const isUrgent = countdown < 60; // Less than 1 minute
    return (_jsx("div", { className: "fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50 backdrop-blur-sm", children: _jsxs("div", { className: "bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200", children: [_jsxs("div", { className: "flex items-start gap-4 mb-4", children: [_jsx("div", { className: `flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${isUrgent ? 'bg-red-100' : 'bg-yellow-100'}`, children: isUrgent ? (_jsx(ExclamationTriangleIcon, { className: "w-6 h-6 text-red-600" })) : (_jsx(ClockIcon, { className: "w-6 h-6 text-yellow-600" })) }), _jsxs("div", { className: "flex-1", children: [_jsx("h3", { className: `text-lg font-bold mb-1 ${isUrgent ? 'text-red-900' : 'text-yellow-900'}`, children: isUrgent ? 'Session Expiring Soon' : 'Session About to Expire' }), _jsx("p", { className: "text-sm text-gray-600", children: userType === 'staff'
                                        ? 'Your staff session will expire due to inactivity.'
                                        : 'Your patient portal session will expire due to inactivity.' })] })] }), _jsxs("div", { className: `p-4 rounded-xl mb-4 text-center ${isUrgent ? 'bg-red-50 border-2 border-red-200' : 'bg-yellow-50 border-2 border-yellow-200'}`, children: [_jsx("div", { className: "text-sm text-gray-600 mb-2", children: "Time remaining" }), _jsx("div", { className: `text-3xl font-bold ${isUrgent ? 'text-red-600' : 'text-yellow-600'}`, children: formatTimeRemaining(countdown) })] }), _jsxs("div", { className: "space-y-2 mb-4", children: [_jsxs("div", { className: "flex items-start gap-2 text-sm text-gray-600", children: [_jsx("span", { className: "text-gray-400 mt-0.5", children: "\u2022" }), _jsx("p", { children: "Click \"Stay Logged In\" to extend your session" })] }), _jsxs("div", { className: "flex items-start gap-2 text-sm text-gray-600", children: [_jsx("span", { className: "text-gray-400 mt-0.5", children: "\u2022" }), _jsx("p", { children: "Your data will be saved automatically" })] }), _jsxs("div", { className: "flex items-start gap-2 text-sm text-gray-600", children: [_jsx("span", { className: "text-gray-400 mt-0.5", children: "\u2022" }), _jsx("p", { children: "This helps protect your privacy and security" })] })] }), _jsxs("div", { className: "flex gap-3", children: [_jsx("button", { onClick: onExtend, className: `flex-1 py-3 px-4 rounded-lg font-medium text-white transition-colors ${isUrgent
                                ? 'bg-red-600 hover:bg-red-700'
                                : 'bg-blue-600 hover:bg-blue-700'}`, children: "Stay Logged In" }), _jsx("button", { onClick: onLogout, className: "px-4 py-3 rounded-lg font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors", children: "Logout" })] }), userType === 'patient' && (_jsx("p", { className: "text-xs text-gray-500 text-center mt-4", children: "For your security, sessions automatically expire after periods of inactivity" }))] }) }));
}
export function SessionStatus({ timeRemaining, userType }) {
    const hours = Math.floor(timeRemaining / 3600);
    const minutes = Math.floor((timeRemaining % 3600) / 60);
    const isWarning = timeRemaining < 600; // Less than 10 minutes
    const isUrgent = timeRemaining < 300; // Less than 5 minutes
    if (timeRemaining < 0)
        return null;
    return (_jsxs("div", { className: `flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm ${isUrgent
            ? 'bg-red-100 text-red-800'
            : isWarning
                ? 'bg-yellow-100 text-yellow-800'
                : 'bg-gray-100 text-gray-700'}`, children: [_jsx(ClockIcon, { className: "w-4 h-4" }), _jsx("span", { className: "font-medium", children: hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m` })] }));
}
