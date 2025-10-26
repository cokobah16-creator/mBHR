import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Portal Status Card Component
 *
 * Displays patient portal enrollment status with:
 * - Enable/disable toggle
 * - Verification status
 * - Last login date
 * - Invitation history
 * - Send/resend invitation button with rate limiting
 */
import { useState, useEffect } from 'react';
import { ShieldCheckIcon, EnvelopeIcon, PhoneIcon, ClockIcon, CheckCircleIcon, ArrowPathIcon, ExclamationCircleIcon, GlobeAltIcon } from '@heroicons/react/24/outline';
import { getPortalStatus, sendPortalInvitation, enablePortalAccess, disablePortalAccess } from '@/services/portalEnrollment';
import { formatNigerianDate } from '@/utils/dateFormat';
import { useToast } from '@/stores/toast';
export function PortalStatusCard({ patientId, patientName, onStatusChange }) {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [toggling, setToggling] = useState(false);
    const [countdown, setCountdown] = useState(0);
    const { push: pushToast } = useToast();
    useEffect(() => {
        loadStatus();
    }, [patientId]);
    // Countdown timer for rate limiting
    useEffect(() => {
        if (countdown > 0) {
            const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
            return () => clearTimeout(timer);
        }
    }, [countdown]);
    const loadStatus = async () => {
        setLoading(true);
        try {
            const portalStatus = await getPortalStatus(patientId);
            setStatus(portalStatus);
            // Set countdown if rate limited
            if (portalStatus && portalStatus.nextResendTime) {
                const secondsUntil = Math.max(0, Math.floor((portalStatus.nextResendTime.getTime() - Date.now()) / 1000));
                setCountdown(secondsUntil);
            }
        }
        catch (error) {
            console.error('Error loading portal status:', error);
        }
        finally {
            setLoading(false);
        }
    };
    const handleTogglePortal = async () => {
        if (!status)
            return;
        setToggling(true);
        try {
            const result = status.enabled
                ? await disablePortalAccess(patientId)
                : await enablePortalAccess(patientId, { termsAccepted: true });
            if (result.success) {
                pushToast({
                    id: crypto.randomUUID(),
                    title: 'Success',
                    body: `Portal access ${status.enabled ? 'disabled' : 'enabled'} successfully`
                });
                await loadStatus();
                onStatusChange?.();
            }
            else {
                pushToast({
                    id: crypto.randomUUID(),
                    title: 'Error',
                    body: result.error || 'Failed to update portal access'
                });
            }
        }
        catch (error) {
            pushToast({
                id: crypto.randomUUID(),
                title: 'Error',
                body: error.message || 'An error occurred'
            });
        }
        finally {
            setToggling(false);
        }
    };
    const handleSendInvitation = async () => {
        setSending(true);
        try {
            const result = await sendPortalInvitation(patientId);
            if (result.success) {
                pushToast({
                    id: crypto.randomUUID(),
                    title: 'Success',
                    body: result.demoOTP
                        ? `Portal invitation prepared. ${result.demoOTP}`
                        : 'Portal invitation sent successfully'
                });
                await loadStatus();
                onStatusChange?.();
            }
            else {
                pushToast({
                    id: crypto.randomUUID(),
                    title: 'Error',
                    body: result.error || 'Failed to send invitation'
                });
            }
        }
        catch (error) {
            pushToast({
                id: crypto.randomUUID(),
                title: 'Error',
                body: error.message || 'Failed to send invitation'
            });
        }
        finally {
            setSending(false);
        }
    };
    const formatCountdown = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };
    if (loading) {
        return (_jsx("div", { className: "card", children: _jsx("div", { className: "flex items-center justify-center py-8", children: _jsx("div", { className: "animate-spin rounded-full h-8 w-8 border-b-2 border-primary" }) }) }));
    }
    if (!status) {
        return (_jsx("div", { className: "card bg-gray-50", children: _jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(ExclamationCircleIcon, { className: "h-6 w-6 text-gray-400" }), _jsx("p", { className: "text-gray-600", children: "Portal status unavailable" })] }) }));
    }
    const getStatusBadge = () => {
        if (!status.enabled) {
            return (_jsx("span", { className: "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800", children: "Disabled" }));
        }
        if (status.verified) {
            return (_jsxs("span", { className: "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800", children: [_jsx(CheckCircleIcon, { className: "h-3.5 w-3.5 mr-1" }), "Verified"] }));
        }
        return (_jsxs("span", { className: "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800", children: [_jsx(ClockIcon, { className: "h-3.5 w-3.5 mr-1" }), "Pending Verification"] }));
    };
    const getInviteStatusBadge = () => {
        if (!status.inviteStatus)
            return null;
        const statusConfig = {
            queued: { color: 'bg-blue-100 text-blue-800', label: 'Queued' },
            sent: { color: 'bg-indigo-100 text-indigo-800', label: 'Sent' },
            delivered: { color: 'bg-green-100 text-green-800', label: 'Delivered' },
            failed: { color: 'bg-red-100 text-red-800', label: 'Failed' }
        };
        const config = statusConfig[status.inviteStatus];
        return (_jsx("span", { className: `inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${config.color}`, children: config.label }));
    };
    return (_jsxs("div", { className: "card", children: [_jsxs("div", { className: "flex items-start justify-between mb-4", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx("div", { className: "p-2 bg-blue-100 rounded-lg", children: _jsx(GlobeAltIcon, { className: "h-6 w-6 text-blue-600" }) }), _jsxs("div", { children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900", children: "Patient Portal Access" }), _jsx("p", { className: "text-sm text-gray-600", children: "Online medical records and appointments" })] })] }), getStatusBadge()] }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: [_jsxs("div", { className: "flex items-center justify-between p-3 bg-gray-50 rounded-lg", children: [_jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(ShieldCheckIcon, { className: "h-5 w-5 text-gray-500" }), _jsx("span", { className: "text-sm font-medium text-gray-700", children: "Portal Access" })] }), _jsxs("label", { className: "relative inline-flex items-center cursor-pointer", children: [_jsx("input", { type: "checkbox", checked: status.enabled, onChange: handleTogglePortal, disabled: toggling, className: "sr-only peer" }), _jsx("div", { className: "w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600" })] })] }), status.contactMethod && (_jsxs("div", { className: "flex items-center space-x-2 p-3 bg-gray-50 rounded-lg", children: [status.contactMethod === 'email' ? (_jsx(EnvelopeIcon, { className: "h-5 w-5 text-gray-500" })) : (_jsx(PhoneIcon, { className: "h-5 w-5 text-gray-500" })), _jsxs("div", { children: [_jsx("p", { className: "text-sm font-medium text-gray-700", children: status.contactMethod === 'email' ? 'Email' : 'SMS' }), _jsx("p", { className: "text-xs text-gray-600", children: "Contact method" })] })] })), status.lastLogin && (_jsxs("div", { className: "flex items-center space-x-2 p-3 bg-gray-50 rounded-lg", children: [_jsx(ClockIcon, { className: "h-5 w-5 text-gray-500" }), _jsxs("div", { children: [_jsx("p", { className: "text-sm font-medium text-gray-700", children: formatNigerianDate(status.lastLogin) }), _jsx("p", { className: "text-xs text-gray-600", children: "Last login" })] })] })), status.inviteCount > 0 && (_jsxs("div", { className: "flex items-center space-x-2 p-3 bg-gray-50 rounded-lg", children: [_jsx(EnvelopeIcon, { className: "h-5 w-5 text-gray-500" }), _jsxs("div", { children: [_jsxs("p", { className: "text-sm font-medium text-gray-700", children: [status.inviteCount, " ", status.inviteCount === 1 ? 'invitation' : 'invitations'] }), _jsx("p", { className: "text-xs text-gray-600", children: "Sent" })] })] }))] }), status.enabled && status.lastInviteSent && (_jsxs("div", { className: "border-t pt-4", children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx("span", { className: "text-sm font-medium text-gray-700", children: "Last Invitation" }), getInviteStatusBadge()] }), _jsxs("p", { className: "text-sm text-gray-600", children: ["Sent ", formatNigerianDate(status.lastInviteSent)] })] })), status.enabled && (_jsxs("div", { className: "border-t pt-4", children: [_jsx("button", { onClick: handleSendInvitation, disabled: !status.canResend || sending || countdown > 0, className: `w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-lg font-medium transition-colors ${status.canResend && countdown === 0
                                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                    : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`, children: sending ? (_jsxs(_Fragment, { children: [_jsx(ArrowPathIcon, { className: "h-5 w-5 animate-spin" }), _jsx("span", { children: "Sending..." })] })) : countdown > 0 ? (_jsxs(_Fragment, { children: [_jsx(ClockIcon, { className: "h-5 w-5" }), _jsxs("span", { children: ["Resend available in ", formatCountdown(countdown)] })] })) : (_jsxs(_Fragment, { children: [_jsx(EnvelopeIcon, { className: "h-5 w-5" }), _jsxs("span", { children: [status.inviteCount > 0 ? 'Resend' : 'Send', " Portal Invitation"] })] })) }), !status.canResend && countdown === 0 && (_jsx("p", { className: "text-xs text-gray-500 mt-2 text-center", children: "Add email or phone to send invitations" }))] })), !status.enabled && (_jsx("div", { className: "bg-blue-50 border border-blue-200 rounded-lg p-4", children: _jsxs("p", { className: "text-sm text-blue-800", children: ["Enable portal access to allow ", patientName.split(' ')[0], " to view medical records, schedule appointments, and communicate securely online."] }) }))] })] }));
}
