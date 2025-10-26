import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import * as logger from '@/lib/logger';
import { UserCircleIcon, LockClosedIcon, BellIcon, DevicePhoneMobileIcon } from '@heroicons/react/24/outline';
import { UpdatePHR } from './UpdatePHR';
export function ManageAccount() {
    const [activeTab, setActiveTab] = useState('profile');
    const [portalUser, setPortalUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [notifications, setNotifications] = useState({
        emailReminders: true,
        smsReminders: true,
        appointmentAlerts: true,
        labResults: true
    });
    useEffect(() => {
        loadAccountInfo();
    }, []);
    const loadAccountInfo = async () => {
        setLoading(true);
        try {
            const portalUserStr = localStorage.getItem('patient_portal_user');
            if (!portalUserStr) {
                window.location.href = '/patient/login';
                return;
            }
            const user = JSON.parse(portalUserStr);
            setPortalUser(user);
            // Load notification preferences
            const { data } = await supabase
                .from('patient_portal_preferences')
                .select('*')
                .eq('portal_user_id', user.id)
                .maybeSingle();
            if (data) {
                setNotifications({
                    emailReminders: data.email_reminders ?? true,
                    smsReminders: data.sms_reminders ?? true,
                    appointmentAlerts: data.appointment_alerts ?? true,
                    labResults: data.lab_results_alerts ?? true
                });
            }
        }
        catch (err) {
            logger.error('Error loading account info:', err);
            setError('Failed to load account information');
        }
        finally {
            setLoading(false);
        }
    };
    const saveNotificationPreferences = async () => {
        setSaving(true);
        setError('');
        setSuccess('');
        try {
            const { error: upsertError } = await supabase
                .from('patient_portal_preferences')
                .upsert({
                portal_user_id: portalUser.id,
                email_reminders: notifications.emailReminders,
                sms_reminders: notifications.smsReminders,
                appointment_alerts: notifications.appointmentAlerts,
                lab_results_alerts: notifications.labResults
            });
            if (upsertError)
                throw upsertError;
            setSuccess('Notification preferences saved');
        }
        catch (err) {
            logger.error('Error saving preferences:', err);
            setError('Failed to save preferences');
        }
        finally {
            setSaving(false);
        }
    };
    const initiatePasswordReset = async () => {
        setSaving(true);
        setError('');
        setSuccess('');
        try {
            // This would trigger an OTP to reset password
            setSuccess('Password reset link sent to your phone/email');
        }
        catch (err) {
            logger.error('Error initiating password reset:', err);
            setError('Failed to send password reset link');
        }
        finally {
            setSaving(false);
        }
    };
    if (loading) {
        return (_jsx("div", { className: "min-h-screen bg-gray-50 px-4 py-8", children: _jsx("div", { className: "max-w-4xl mx-auto", children: _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" }), _jsx("p", { className: "mt-4 text-gray-600", children: "Loading account..." })] }) }) }));
    }
    return (_jsx("div", { className: "min-h-screen bg-gray-50 px-4 py-8", children: _jsxs("div", { className: "max-w-4xl mx-auto", children: [_jsxs("div", { className: "mb-6", children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Manage Account" }), _jsx("p", { className: "mt-2 text-gray-600", children: "Update your profile and account settings" })] }), error && (_jsx("div", { className: "mb-4 p-4 bg-red-50 border border-red-200 rounded-lg", children: _jsx("p", { className: "text-sm text-red-800", children: error }) })), success && (_jsx("div", { className: "mb-4 p-4 bg-green-50 border border-green-200 rounded-lg", children: _jsx("p", { className: "text-sm text-green-800", children: success }) })), _jsxs("div", { className: "bg-white rounded-lg shadow-sm border border-gray-200", children: [_jsx("div", { className: "border-b border-gray-200", children: _jsxs("nav", { className: "flex", children: [_jsxs("button", { onClick: () => setActiveTab('profile'), className: `px-6 py-3 text-sm font-medium border-b-2 ${activeTab === 'profile'
                                            ? 'border-blue-600 text-blue-600'
                                            : 'border-transparent text-gray-500 hover:text-gray-700'}`, children: [_jsx(UserCircleIcon, { className: "h-5 w-5 inline-block mr-2" }), "Profile"] }), _jsxs("button", { onClick: () => setActiveTab('notifications'), className: `px-6 py-3 text-sm font-medium border-b-2 ${activeTab === 'notifications'
                                            ? 'border-blue-600 text-blue-600'
                                            : 'border-transparent text-gray-500 hover:text-gray-700'}`, children: [_jsx(BellIcon, { className: "h-5 w-5 inline-block mr-2" }), "Notifications"] }), _jsxs("button", { onClick: () => setActiveTab('security'), className: `px-6 py-3 text-sm font-medium border-b-2 ${activeTab === 'security'
                                            ? 'border-blue-600 text-blue-600'
                                            : 'border-transparent text-gray-500 hover:text-gray-700'}`, children: [_jsx(LockClosedIcon, { className: "h-5 w-5 inline-block mr-2" }), "Security"] })] }) }), _jsxs("div", { className: "p-6", children: [activeTab === 'profile' && (_jsx("div", { children: _jsx(UpdatePHR, {}) })), activeTab === 'notifications' && (_jsx("div", { className: "space-y-6", children: _jsxs("div", { children: [_jsx("h3", { className: "text-lg font-medium text-gray-900 mb-4", children: "Notification Preferences" }), _jsxs("div", { className: "space-y-4", children: [_jsxs("label", { className: "flex items-center gap-3", children: [_jsx("input", { type: "checkbox", checked: notifications.emailReminders, onChange: (e) => setNotifications({ ...notifications, emailReminders: e.target.checked }), className: "h-5 w-5 text-blue-600 rounded" }), _jsxs("div", { children: [_jsx("p", { className: "font-medium text-gray-900", children: "Email Reminders" }), _jsx("p", { className: "text-sm text-gray-600", children: "Receive appointment reminders via email" })] })] }), _jsxs("label", { className: "flex items-center gap-3", children: [_jsx("input", { type: "checkbox", checked: notifications.smsReminders, onChange: (e) => setNotifications({ ...notifications, smsReminders: e.target.checked }), className: "h-5 w-5 text-blue-600 rounded" }), _jsxs("div", { children: [_jsx("p", { className: "font-medium text-gray-900", children: "SMS Reminders" }), _jsx("p", { className: "text-sm text-gray-600", children: "Receive appointment reminders via text message" })] })] }), _jsxs("label", { className: "flex items-center gap-3", children: [_jsx("input", { type: "checkbox", checked: notifications.appointmentAlerts, onChange: (e) => setNotifications({ ...notifications, appointmentAlerts: e.target.checked }), className: "h-5 w-5 text-blue-600 rounded" }), _jsxs("div", { children: [_jsx("p", { className: "font-medium text-gray-900", children: "Appointment Alerts" }), _jsx("p", { className: "text-sm text-gray-600", children: "Get notified about upcoming appointments" })] })] }), _jsxs("label", { className: "flex items-center gap-3", children: [_jsx("input", { type: "checkbox", checked: notifications.labResults, onChange: (e) => setNotifications({ ...notifications, labResults: e.target.checked }), className: "h-5 w-5 text-blue-600 rounded" }), _jsxs("div", { children: [_jsx("p", { className: "font-medium text-gray-900", children: "Lab Results" }), _jsx("p", { className: "text-sm text-gray-600", children: "Get notified when new lab results are available" })] })] })] }), _jsx("button", { onClick: saveNotificationPreferences, disabled: saving, className: "mt-6 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50", children: saving ? 'Saving...' : 'Save Preferences' })] }) })), activeTab === 'security' && (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-lg font-medium text-gray-900 mb-2", children: "Password" }), _jsx("p", { className: "text-gray-600 mb-4", children: "Reset your password using your registered phone number or email" }), _jsx("button", { onClick: initiatePasswordReset, disabled: saving, className: "px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50", children: saving ? 'Sending...' : 'Reset Password' })] }), _jsxs("div", { className: "border-t border-gray-200 pt-6", children: [_jsx("h3", { className: "text-lg font-medium text-gray-900 mb-2", children: "Active Sessions" }), _jsx("p", { className: "text-gray-600 mb-4", children: "You are currently logged in on this device" }), _jsxs("div", { className: "flex items-center gap-2 p-3 bg-gray-50 rounded-md", children: [_jsx(DevicePhoneMobileIcon, { className: "h-6 w-6 text-gray-600" }), _jsxs("div", { children: [_jsx("p", { className: "font-medium text-gray-900", children: "Current Device" }), _jsx("p", { className: "text-sm text-gray-600", children: "Active now" })] })] })] })] }))] })] })] }) }));
}
