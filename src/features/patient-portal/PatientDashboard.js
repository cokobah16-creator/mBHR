import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { formatNigerianDate } from '@/utils/dateFormat';
import { Link } from 'react-router-dom';
import { CalendarIcon, HeartIcon, BeakerIcon, EnvelopeIcon, BellIcon, ClipboardDocumentListIcon, PlusIcon } from '@heroicons/react/24/outline';
import { getPatientDashboard } from '@/services/patientPortalData';
import * as logger from '@/lib/logger';
export function PatientDashboard() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    useEffect(() => {
        loadDashboard();
    }, []);
    const loadDashboard = async () => {
        setLoading(true);
        setError('');
        try {
            const portalUserStr = localStorage.getItem('patient_portal_user');
            if (!portalUserStr) {
                logger.info('No portal user found in localStorage - redirecting to login');
                window.location.href = '/patient/login';
                return;
            }
            const portalUser = JSON.parse(portalUserStr);
            if (!portalUser.patientId || !portalUser.id) {
                logger.warn('Invalid portal user data - redirecting to login');
                localStorage.removeItem('patient_portal_user');
                localStorage.removeItem('patient_session_token');
                window.location.href = '/patient/login';
                return;
            }
            const dashboardData = await getPatientDashboard(portalUser.id, portalUser.patientId);
            if (dashboardData) {
                setData(dashboardData);
            }
            else {
                setError('Failed to load dashboard data');
            }
        }
        catch (err) {
            logger.error('Error loading dashboard:', err);
            setError('An error occurred loading your information');
        }
        finally {
            setLoading(false);
        }
    };
    if (loading) {
        return (_jsx("div", { className: "flex items-center justify-center min-h-screen", children: _jsx("div", { className: "w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" }) }));
    }
    if (error) {
        return (_jsx("div", { className: "max-w-7xl mx-auto px-4 py-8", children: _jsx("div", { className: "bg-red-50 border border-red-200 rounded-lg p-6", children: _jsx("p", { className: "text-red-800", children: error }) }) }));
    }
    if (!data) {
        return null;
    }
    const { patient, upcomingAppointments, recentVitals, activeMedications, unreadMessages, unreadNotifications, recentLabResults } = data;
    return (_jsxs("div", { className: "max-w-7xl mx-auto px-4 py-8 space-y-6", children: [_jsxs("div", { className: "bg-white rounded-xl shadow-sm p-6", children: [_jsxs("h1", { className: "text-3xl font-bold text-gray-900", children: ["Welcome back, ", patient.givenName, "!"] }), _jsx("p", { className: "text-gray-600 mt-2", children: "Here's an overview of your health information" })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6", children: [_jsxs(Link, { to: "/patient/appointments", className: "bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition-shadow", children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsx("div", { className: "w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center", children: _jsx(CalendarIcon, { className: "w-6 h-6 text-blue-600" }) }), _jsxs("div", { className: "flex-1", children: [_jsx("p", { className: "text-sm text-gray-600", children: "Upcoming Appointments" }), _jsx("p", { className: "text-2xl font-bold text-gray-900", children: upcomingAppointments.length })] })] }), upcomingAppointments.length > 0 && (_jsxs("div", { className: "mt-4 pt-4 border-t border-gray-100", children: [_jsxs("p", { className: "text-sm text-gray-700 font-medium", children: ["Next: ", formatNigerianDate(upcomingAppointments[0].scheduledAt)] }), _jsx("p", { className: "text-xs text-gray-500", children: upcomingAppointments[0].appointmentType })] }))] }), _jsxs(Link, { to: "/patient/messages", className: "bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition-shadow relative", children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsx("div", { className: "w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center", children: _jsx(EnvelopeIcon, { className: "w-6 h-6 text-green-600" }) }), _jsxs("div", { className: "flex-1", children: [_jsx("p", { className: "text-sm text-gray-600", children: "Messages" }), _jsx("p", { className: "text-2xl font-bold text-gray-900", children: unreadMessages }), _jsx("p", { className: "text-xs text-gray-500", children: "unread" })] })] }), unreadMessages > 0 && (_jsx("div", { className: "absolute top-4 right-4 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center", children: _jsx("span", { className: "text-xs text-white font-bold", children: unreadMessages }) }))] }), _jsxs(Link, { to: "/patient/notifications", className: "bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition-shadow relative", children: [_jsxs("div", { className: "flex items-center gap-4", children: [_jsx("div", { className: "w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center", children: _jsx(BellIcon, { className: "w-6 h-6 text-yellow-600" }) }), _jsxs("div", { className: "flex-1", children: [_jsx("p", { className: "text-sm text-gray-600", children: "Notifications" }), _jsx("p", { className: "text-2xl font-bold text-gray-900", children: unreadNotifications }), _jsx("p", { className: "text-xs text-gray-500", children: "unread" })] })] }), unreadNotifications > 0 && (_jsx("div", { className: "absolute top-4 right-4 w-6 h-6 bg-yellow-500 rounded-full flex items-center justify-center", children: _jsx("span", { className: "text-xs text-white font-bold", children: unreadNotifications }) }))] })] }), recentVitals && (_jsxs("div", { className: "bg-white rounded-xl shadow-sm p-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsx("h2", { className: "text-xl font-bold text-gray-900", children: "Recent Vitals" }), _jsx(Link, { to: "/patient/medical-history", className: "text-sm text-blue-600 hover:text-blue-700 font-medium", children: "View History \u2192" })] }), _jsxs("div", { className: "grid grid-cols-2 md:grid-cols-4 gap-4", children: [recentVitals.systolic && recentVitals.diastolic && (_jsxs("div", { className: "bg-gray-50 rounded-lg p-4", children: [_jsx("p", { className: "text-sm text-gray-600 mb-1", children: "Blood Pressure" }), _jsxs("p", { className: "text-xl font-bold text-gray-900", children: [recentVitals.systolic, "/", recentVitals.diastolic] }), _jsx("p", { className: "text-xs text-gray-500", children: "mmHg" })] })), recentVitals.pulseBpm && (_jsxs("div", { className: "bg-gray-50 rounded-lg p-4", children: [_jsx("p", { className: "text-sm text-gray-600 mb-1", children: "Heart Rate" }), _jsx("p", { className: "text-xl font-bold text-gray-900", children: recentVitals.pulseBpm }), _jsx("p", { className: "text-xs text-gray-500", children: "bpm" })] })), recentVitals.tempC && (_jsxs("div", { className: "bg-gray-50 rounded-lg p-4", children: [_jsx("p", { className: "text-sm text-gray-600 mb-1", children: "Temperature" }), _jsxs("p", { className: "text-xl font-bold text-gray-900", children: [recentVitals.tempC, "\u00B0C"] }), _jsx("p", { className: "text-xs text-gray-500", children: "celsius" })] })), recentVitals.spo2 && (_jsxs("div", { className: "bg-gray-50 rounded-lg p-4", children: [_jsx("p", { className: "text-sm text-gray-600 mb-1", children: "O2 Saturation" }), _jsxs("p", { className: "text-xl font-bold text-gray-900", children: [recentVitals.spo2, "%"] }), _jsx("p", { className: "text-xs text-gray-500", children: "SpO2" })] }))] }), recentVitals.takenAt && (_jsxs("p", { className: "text-xs text-gray-500 mt-4", children: ["Last recorded: ", formatNigerianDate(recentVitals.takenAt)] }))] })), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-6", children: [_jsxs("div", { className: "bg-white rounded-xl shadow-sm p-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsx("h2", { className: "text-xl font-bold text-gray-900", children: "Active Medications" }), _jsx(Link, { to: "/patient/medications", className: "text-sm text-blue-600 hover:text-blue-700 font-medium", children: "View All \u2192" })] }), activeMedications.length > 0 ? (_jsx("div", { className: "space-y-3", children: activeMedications.slice(0, 3).map((med, idx) => (_jsxs("div", { className: "flex items-start gap-3 p-3 bg-gray-50 rounded-lg", children: [_jsx("div", { className: "w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0", children: _jsx(HeartIcon, { className: "w-5 h-5 text-blue-600" }) }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsx("p", { className: "font-medium text-gray-900", children: med.medicationName }), _jsx("p", { className: "text-sm text-gray-600", children: med.dosage }), _jsx("p", { className: "text-xs text-gray-500", children: med.directions })] })] }, idx))) })) : (_jsx("p", { className: "text-gray-500 text-center py-8", children: "No active medications" }))] }), _jsxs("div", { className: "bg-white rounded-xl shadow-sm p-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsx("h2", { className: "text-xl font-bold text-gray-900", children: "Recent Lab Results" }), _jsx(Link, { to: "/patient/labs", className: "text-sm text-blue-600 hover:text-blue-700 font-medium", children: "View All \u2192" })] }), recentLabResults.length > 0 ? (_jsx("div", { className: "space-y-3", children: recentLabResults.map((result, idx) => (_jsxs("div", { className: "flex items-center justify-between p-3 bg-gray-50 rounded-lg", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center", children: _jsx(BeakerIcon, { className: "w-5 h-5 text-purple-600" }) }), _jsxs("div", { children: [_jsx("p", { className: "font-medium text-gray-900", children: result.testName }), _jsx("p", { className: "text-xs text-gray-500", children: formatNigerianDate(result.resultDate) })] })] }), _jsx("span", { className: `px-3 py-1 rounded-full text-xs font-medium ${result.interpretation === 'normal'
                                                ? 'bg-green-100 text-green-800'
                                                : result.interpretation === 'abnormal'
                                                    ? 'bg-yellow-100 text-yellow-800'
                                                    : 'bg-red-100 text-red-800'}`, children: result.interpretation })] }, idx))) })) : (_jsx("p", { className: "text-gray-500 text-center py-8", children: "No recent lab results" }))] })] }), _jsxs("div", { className: "bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl shadow-sm p-6 text-white", children: [_jsx("h2", { className: "text-xl font-bold mb-4", children: "Quick Actions" }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-3 gap-4", children: [_jsxs(Link, { to: "/patient/appointments/request", className: "flex items-center gap-3 bg-white/10 hover:bg-white/20 rounded-lg p-4 transition-colors", children: [_jsx(PlusIcon, { className: "w-6 h-6" }), _jsx("span", { className: "font-medium", children: "Request Appointment" })] }), _jsxs(Link, { to: "/patient/messages/compose", className: "flex items-center gap-3 bg-white/10 hover:bg-white/20 rounded-lg p-4 transition-colors", children: [_jsx(EnvelopeIcon, { className: "w-6 h-6" }), _jsx("span", { className: "font-medium", children: "Message Care Team" })] }), _jsxs(Link, { to: "/patient/medical-history", className: "flex items-center gap-3 bg-white/10 hover:bg-white/20 rounded-lg p-4 transition-colors", children: [_jsx(ClipboardDocumentListIcon, { className: "w-6 h-6" }), _jsx("span", { className: "font-medium", children: "View Medical History" })] })] })] })] }));
}
