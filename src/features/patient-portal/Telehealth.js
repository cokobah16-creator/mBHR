import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { formatNigerianDate, formatTime } from '@/utils/dateFormat';
import { VideoCameraIcon, CalendarIcon, ClockIcon, UserIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import * as logger from '@/lib/logger';
export function Telehealth() {
    const [appointments, setAppointments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showRequestModal, setShowRequestModal] = useState(false);
    const [requestReason, setRequestReason] = useState('');
    const [preferredDate, setPreferredDate] = useState('');
    const [preferredTime, setPreferredTime] = useState('');
    useEffect(() => {
        loadAppointments();
    }, []);
    const loadAppointments = async () => {
        setLoading(true);
        try {
            const portalUser = JSON.parse(localStorage.getItem('patient_portal_user') || '{}');
            if (!portalUser.patientId) {
                logger.error('No patient ID found');
                return;
            }
            // Mock data - replace with actual API calls
            const mockAppointments = [
                {
                    id: 'tele-1',
                    providerId: 'doc-1',
                    providerName: 'Dr. Adeyemi',
                    providerSpecialty: 'General Practice',
                    scheduledAt: new Date('2025-11-02T10:00:00'),
                    duration: 30,
                    status: 'scheduled',
                    meetingLink: 'https://meet.example.com/tele-1',
                    reason: 'Follow-up consultation',
                    notes: 'Please have your blood pressure readings ready'
                },
                {
                    id: 'tele-2',
                    providerId: 'doc-2',
                    providerName: 'Dr. Okafor',
                    providerSpecialty: 'Cardiology',
                    scheduledAt: new Date('2025-10-20T14:00:00'),
                    duration: 30,
                    status: 'completed',
                    reason: 'Hypertension check-up'
                }
            ];
            setAppointments(mockAppointments);
        }
        catch (err) {
            logger.error('Error loading telehealth appointments:', err);
        }
        finally {
            setLoading(false);
        }
    };
    const handleJoinCall = (appointment) => {
        if (appointment.meetingLink) {
            // In production, this would open the video conferencing platform
            alert(`Joining video call with ${appointment.providerName}...\n\nIn production, this would launch the video conferencing interface.`);
            window.open(appointment.meetingLink, '_blank');
        }
    };
    const handleRequestAppointment = async (e) => {
        e.preventDefault();
        try {
            // Mock submission - replace with actual API call
            await new Promise(resolve => setTimeout(resolve, 1500));
            alert('Telehealth appointment request submitted! We will contact you within 24 hours to confirm.');
            setShowRequestModal(false);
            setRequestReason('');
            setPreferredDate('');
            setPreferredTime('');
        }
        catch (err) {
            logger.error('Request error:', err);
            alert('Failed to submit request. Please try again.');
        }
    };
    const canJoinCall = (appointment) => {
        if (appointment.status !== 'scheduled')
            return false;
        const now = new Date();
        const appointmentTime = new Date(appointment.scheduledAt);
        const timeDiff = appointmentTime.getTime() - now.getTime();
        const minutesUntil = timeDiff / (1000 * 60);
        // Allow joining 10 minutes before scheduled time
        return minutesUntil <= 10 && minutesUntil >= -30;
    };
    const getStatusColor = (status) => {
        switch (status) {
            case 'scheduled':
                return 'bg-blue-100 text-blue-800';
            case 'in_progress':
                return 'bg-green-100 text-green-800';
            case 'completed':
                return 'bg-gray-100 text-gray-800';
            case 'cancelled':
                return 'bg-red-100 text-red-800';
        }
    };
    const upcomingAppointments = appointments.filter(a => a.status === 'scheduled' && new Date(a.scheduledAt) >= new Date());
    const pastAppointments = appointments.filter(a => a.status === 'completed' || new Date(a.scheduledAt) < new Date());
    if (loading) {
        return (_jsx("div", { className: "flex items-center justify-center min-h-screen", children: _jsx("div", { className: "w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" }) }));
    }
    return (_jsxs("div", { className: "max-w-7xl mx-auto px-4 py-8 space-y-6", children: [_jsx("div", { className: "bg-white rounded-xl shadow-sm p-6", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-3xl font-bold text-gray-900", children: "Telehealth" }), _jsx("p", { className: "text-gray-600 mt-2", children: "Virtual video consultations with your healthcare providers" })] }), _jsxs("button", { onClick: () => setShowRequestModal(true), className: "px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center gap-2", children: [_jsx(CalendarIcon, { className: "w-5 h-5" }), "Request Appointment"] })] }) }), _jsx("div", { className: "bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl shadow-sm p-6 border border-blue-100", children: _jsxs("div", { className: "flex items-start gap-4", children: [_jsx("div", { className: "w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0", children: _jsx(VideoCameraIcon, { className: "w-6 h-6 text-white" }) }), _jsxs("div", { children: [_jsx("h3", { className: "font-semibold text-gray-900 text-lg", children: "Benefits of Telehealth" }), _jsxs("ul", { className: "mt-2 space-y-2 text-sm text-gray-700", children: [_jsxs("li", { className: "flex items-center gap-2", children: [_jsx(CheckCircleIcon, { className: "w-4 h-4 text-green-600" }), "Consult with doctors from the comfort of your home"] }), _jsxs("li", { className: "flex items-center gap-2", children: [_jsx(CheckCircleIcon, { className: "w-4 h-4 text-green-600" }), "No travel time or waiting rooms"] }), _jsxs("li", { className: "flex items-center gap-2", children: [_jsx(CheckCircleIcon, { className: "w-4 h-4 text-green-600" }), "Convenient for follow-up appointments"] }), _jsxs("li", { className: "flex items-center gap-2", children: [_jsx(CheckCircleIcon, { className: "w-4 h-4 text-green-600" }), "Secure, HIPAA-compliant video calls"] })] })] })] }) }), upcomingAppointments.length > 0 && (_jsxs("div", { className: "bg-white rounded-xl shadow-sm overflow-hidden", children: [_jsx("div", { className: "px-6 py-4 border-b border-gray-200 bg-blue-50", children: _jsxs("h2", { className: "text-xl font-bold text-gray-900 flex items-center gap-2", children: [_jsx(CalendarIcon, { className: "w-6 h-6 text-blue-600" }), "Upcoming Appointments"] }) }), _jsx("div", { className: "divide-y divide-gray-200", children: upcomingAppointments.map((appointment) => {
                            const canJoin = canJoinCall(appointment);
                            return (_jsx("div", { className: "p-6 hover:bg-gray-50 transition-colors", children: _jsx("div", { className: "flex items-start justify-between", children: _jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center", children: _jsx(UserIcon, { className: "w-6 h-6 text-blue-600" }) }), _jsxs("div", { children: [_jsx("h3", { className: "font-semibold text-gray-900 text-lg", children: appointment.providerName }), _jsx("p", { className: "text-gray-600 text-sm", children: appointment.providerSpecialty })] }), _jsx("span", { className: `px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(appointment.status)}`, children: appointment.status.charAt(0).toUpperCase() + appointment.status.slice(1).replace('_', ' ') })] }), _jsxs("div", { className: "mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm", children: [_jsxs("div", { className: "flex items-center gap-2 text-gray-700", children: [_jsx(CalendarIcon, { className: "w-4 h-4 text-gray-400" }), _jsx("span", { children: formatNigerianDate(appointment.scheduledAt) })] }), _jsxs("div", { className: "flex items-center gap-2 text-gray-700", children: [_jsx(ClockIcon, { className: "w-4 h-4 text-gray-400" }), _jsxs("span", { children: [formatTime(appointment.scheduledAt), " (", appointment.duration, " min)"] })] }), _jsxs("div", { className: "flex items-center gap-2 text-gray-700", children: [_jsx(VideoCameraIcon, { className: "w-4 h-4 text-gray-400" }), _jsx("span", { children: "Video Call" })] })] }), _jsxs("div", { className: "mt-3", children: [_jsxs("p", { className: "text-sm font-medium text-gray-700", children: ["Reason: ", appointment.reason] }), appointment.notes && (_jsx("p", { className: "text-sm text-gray-600 mt-1", children: appointment.notes }))] }), canJoin && (_jsx("div", { className: "mt-4 bg-green-50 border border-green-200 rounded-lg p-4", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("p", { className: "font-semibold text-green-900", children: "Your appointment is ready!" }), _jsx("p", { className: "text-sm text-green-700", children: "Click below to join the video call" })] }), _jsxs("button", { onClick: () => handleJoinCall(appointment), className: "px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium flex items-center gap-2", children: [_jsx(VideoCameraIcon, { className: "w-5 h-5" }), "Join Call"] })] }) })), !canJoin && appointment.status === 'scheduled' && (_jsx("div", { className: "mt-4", children: _jsxs("button", { disabled: true, className: "px-6 py-3 bg-gray-200 text-gray-500 rounded-lg font-medium flex items-center gap-2 cursor-not-allowed", children: [_jsx(ClockIcon, { className: "w-5 h-5" }), "Join Call (Available 10 min before)"] }) }))] }) }) }, appointment.id));
                        }) })] })), pastAppointments.length > 0 && (_jsxs("div", { className: "bg-white rounded-xl shadow-sm overflow-hidden", children: [_jsx("div", { className: "px-6 py-4 border-b border-gray-200", children: _jsx("h2", { className: "text-xl font-bold text-gray-900", children: "Past Appointments" }) }), _jsx("div", { className: "divide-y divide-gray-200", children: pastAppointments.map((appointment) => (_jsx("div", { className: "p-6 hover:bg-gray-50 transition-colors", children: _jsx("div", { className: "flex items-start justify-between", children: _jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center", children: _jsx(UserIcon, { className: "w-6 h-6 text-gray-600" }) }), _jsxs("div", { children: [_jsx("h3", { className: "font-semibold text-gray-900", children: appointment.providerName }), _jsx("p", { className: "text-gray-600 text-sm", children: appointment.providerSpecialty })] }), _jsx("span", { className: `px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(appointment.status)}`, children: appointment.status.charAt(0).toUpperCase() + appointment.status.slice(1) })] }), _jsxs("div", { className: "mt-3 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-600", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx(CalendarIcon, { className: "w-4 h-4 text-gray-400" }), _jsx("span", { children: formatNigerianDate(appointment.scheduledAt) })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx(ClockIcon, { className: "w-4 h-4 text-gray-400" }), _jsx("span", { children: formatTime(appointment.scheduledAt) })] }), _jsxs("div", { children: [_jsx("span", { className: "font-medium", children: "Reason:" }), " ", appointment.reason] })] })] }) }) }, appointment.id))) })] })), upcomingAppointments.length === 0 && pastAppointments.length === 0 && (_jsxs("div", { className: "bg-white rounded-xl shadow-sm p-12 text-center", children: [_jsx(VideoCameraIcon, { className: "w-16 h-16 text-gray-300 mx-auto mb-4" }), _jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-2", children: "No Telehealth Appointments" }), _jsx("p", { className: "text-gray-600 mb-6", children: "Request your first virtual consultation with a healthcare provider" }), _jsxs("button", { onClick: () => setShowRequestModal(true), className: "px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium inline-flex items-center gap-2", children: [_jsx(CalendarIcon, { className: "w-5 h-5" }), "Request Appointment"] })] })), showRequestModal && (_jsx("div", { className: "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50", children: _jsxs("div", { className: "bg-white rounded-xl max-w-md w-full p-6", children: [_jsx("h2", { className: "text-2xl font-bold text-gray-900 mb-4", children: "Request Telehealth Appointment" }), _jsxs("form", { onSubmit: handleRequestAppointment, className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Reason for Consultation *" }), _jsx("textarea", { value: requestReason, onChange: (e) => setRequestReason(e.target.value), required: true, rows: 3, className: "w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent", placeholder: "Brief description of your health concern" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Preferred Date *" }), _jsx("input", { type: "date", value: preferredDate, onChange: (e) => setPreferredDate(e.target.value), required: true, min: new Date().toISOString().split('T')[0], className: "w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Preferred Time *" }), _jsxs("select", { value: preferredTime, onChange: (e) => setPreferredTime(e.target.value), required: true, className: "w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent", children: [_jsx("option", { value: "", children: "Select time" }), _jsx("option", { value: "morning", children: "Morning (8:00 AM - 12:00 PM)" }), _jsx("option", { value: "afternoon", children: "Afternoon (12:00 PM - 5:00 PM)" }), _jsx("option", { value: "evening", children: "Evening (5:00 PM - 8:00 PM)" })] })] }), _jsx("div", { className: "bg-blue-50 border border-blue-200 rounded-lg p-4", children: _jsx("p", { className: "text-sm text-blue-800", children: "We will review your request and contact you within 24 hours to confirm your appointment time." }) }), _jsxs("div", { className: "flex gap-3 pt-4", children: [_jsx("button", { type: "button", onClick: () => setShowRequestModal(false), className: "flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors", children: "Cancel" }), _jsxs("button", { type: "submit", className: "flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2", children: [_jsx(CalendarIcon, { className: "w-5 h-5" }), "Submit Request"] })] })] })] }) }))] }));
}
