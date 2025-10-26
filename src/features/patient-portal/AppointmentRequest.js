import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeftIcon, CalendarIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { supabase } from '@/lib/supabase';
import * as logger from '@/lib/logger';
const appointmentTypes = [
    'General Consultation',
    'Follow-up Visit',
    'Chronic Disease Management',
    'Immunization',
    'Health Screening',
    'Prenatal Care',
    'Pediatric Care',
    'Mental Health',
    'Injury Assessment',
    'Other'
];
const timeSlots = [
    'Morning (8am - 12pm)',
    'Afternoon (12pm - 4pm)',
    'Evening (4pm - 7pm)',
    'Any time'
];
const appointmentSchema = z.object({
    appointmentType: z.string().min(1, 'Please select appointment type'),
    preferredDate1: z.string().min(1, 'Please select at least one preferred date'),
    preferredTime1: z.string().optional(),
    preferredDate2: z.string().optional(),
    preferredTime2: z.string().optional(),
    preferredDate3: z.string().optional(),
    preferredTime3: z.string().optional(),
    reason: z.string().min(10, 'Please provide a reason (at least 10 characters)').max(500, 'Reason must be less than 500 characters'),
    notes: z.string().max(1000, 'Notes must be less than 1000 characters').optional()
});
export function AppointmentRequest() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const form = useForm({
        resolver: zodResolver(appointmentSchema),
        defaultValues: {
            appointmentType: '',
            preferredDate1: '',
            preferredTime1: '',
            preferredDate2: '',
            preferredTime2: '',
            preferredDate3: '',
            preferredTime3: '',
            reason: '',
            notes: ''
        }
    });
    const minDate = new Date().toISOString().split('T')[0];
    const handleSubmit = async (data) => {
        setLoading(true);
        setError('');
        try {
            const portalUserStr = localStorage.getItem('patient_portal_user');
            if (!portalUserStr) {
                window.location.href = '/patient/login';
                return;
            }
            const portalUser = JSON.parse(portalUserStr);
            if (!portalUser.patientId) {
                localStorage.removeItem('patient_portal_user');
                localStorage.removeItem('patient_session_token');
                window.location.href = '/patient/login';
                return;
            }
            const { error: insertError } = await supabase
                .from('patient_appointment_requests')
                .insert({
                patient_id: portalUser.patientId,
                appointment_type: data.appointmentType,
                preferred_date_1: data.preferredDate1,
                preferred_time_1: data.preferredTime1 || null,
                preferred_date_2: data.preferredDate2 || null,
                preferred_time_2: data.preferredTime2 || null,
                preferred_date_3: data.preferredDate3 || null,
                preferred_time_3: data.preferredTime3 || null,
                reason: data.reason,
                notes: data.notes || null,
                status: 'pending'
            });
            if (insertError) {
                logger.error('Error creating appointment request:', insertError);
                setError('Failed to submit appointment request. Please try again.');
                return;
            }
            setSuccess(true);
            setTimeout(() => navigate('/patient/appointments'), 2000);
        }
        catch (err) {
            logger.error('Error in appointment request:', err);
            setError('An error occurred. Please try again.');
        }
        finally {
            setLoading(false);
        }
    };
    if (success) {
        return (_jsx("div", { className: "max-w-2xl mx-auto px-4 py-8", children: _jsxs("div", { className: "bg-white rounded-xl shadow-sm p-12 text-center", children: [_jsx("div", { className: "inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-6", children: _jsx(CheckCircleIcon, { className: "w-12 h-12 text-green-600" }) }), _jsx("h1", { className: "text-2xl font-bold text-gray-900 mb-2", children: "Request Submitted!" }), _jsx("p", { className: "text-gray-600 mb-6", children: "Your appointment request has been submitted successfully. Our team will review it and get back to you soon." }), _jsx("div", { className: "flex justify-center", children: _jsx("div", { className: "w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin" }) })] }) }));
    }
    return (_jsxs("div", { className: "max-w-2xl mx-auto px-4 py-8", children: [_jsxs(Link, { to: "/patient/dashboard", className: "inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-6", children: [_jsx(ArrowLeftIcon, { className: "w-4 h-4" }), "Back to Dashboard"] }), _jsx("div", { className: "bg-white rounded-xl shadow-sm p-6 mb-6", children: _jsxs("div", { className: "flex items-center gap-4 mb-4", children: [_jsx("div", { className: "w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center", children: _jsx(CalendarIcon, { className: "w-6 h-6 text-blue-600" }) }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Request an Appointment" }), _jsx("p", { className: "text-gray-600", children: "Tell us when you'd like to visit and we'll schedule it for you" })] })] }) }), error && (_jsx("div", { className: "bg-red-50 border border-red-200 rounded-lg p-4 mb-6", children: _jsx("p", { className: "text-sm text-red-800", children: error }) })), _jsxs("form", { onSubmit: form.handleSubmit(handleSubmit), className: "bg-white rounded-xl shadow-sm p-6 space-y-6", children: [_jsxs("div", { children: [_jsx("label", { htmlFor: "appointmentType", className: "block text-sm font-medium text-gray-700 mb-2", children: "Type of Appointment *" }), _jsxs("select", { ...form.register('appointmentType'), id: "appointmentType", className: "w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent", disabled: loading, children: [_jsx("option", { value: "", children: "Select appointment type" }), appointmentTypes.map(type => (_jsx("option", { value: type, children: type }, type)))] }), form.formState.errors.appointmentType && (_jsx("p", { className: "mt-2 text-sm text-red-600", children: form.formState.errors.appointmentType.message }))] }), _jsxs("div", { className: "border-t border-gray-200 pt-6", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Preferred Dates & Times" }), _jsx("p", { className: "text-sm text-gray-600 mb-4", children: "Please provide up to 3 preferred dates to increase chances of getting an appointment that works for you." }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("label", { htmlFor: "preferredDate1", className: "block text-sm font-medium text-gray-700 mb-2", children: "First Choice Date *" }), _jsx("input", { ...form.register('preferredDate1'), type: "date", id: "preferredDate1", min: minDate, className: "w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent", disabled: loading }), form.formState.errors.preferredDate1 && (_jsx("p", { className: "mt-2 text-sm text-red-600", children: form.formState.errors.preferredDate1.message }))] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "preferredTime1", className: "block text-sm font-medium text-gray-700 mb-2", children: "Preferred Time" }), _jsxs("select", { ...form.register('preferredTime1'), id: "preferredTime1", className: "w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent", disabled: loading, children: [_jsx("option", { value: "", children: "Any time" }), timeSlots.map(slot => (_jsx("option", { value: slot, children: slot }, slot)))] })] })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("label", { htmlFor: "preferredDate2", className: "block text-sm font-medium text-gray-700 mb-2", children: "Second Choice Date (Optional)" }), _jsx("input", { ...form.register('preferredDate2'), type: "date", id: "preferredDate2", min: minDate, className: "w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent", disabled: loading })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "preferredTime2", className: "block text-sm font-medium text-gray-700 mb-2", children: "Preferred Time" }), _jsxs("select", { ...form.register('preferredTime2'), id: "preferredTime2", className: "w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent", disabled: loading, children: [_jsx("option", { value: "", children: "Any time" }), timeSlots.map(slot => (_jsx("option", { value: slot, children: slot }, slot)))] })] })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("label", { htmlFor: "preferredDate3", className: "block text-sm font-medium text-gray-700 mb-2", children: "Third Choice Date (Optional)" }), _jsx("input", { ...form.register('preferredDate3'), type: "date", id: "preferredDate3", min: minDate, className: "w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent", disabled: loading })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "preferredTime3", className: "block text-sm font-medium text-gray-700 mb-2", children: "Preferred Time" }), _jsxs("select", { ...form.register('preferredTime3'), id: "preferredTime3", className: "w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent", disabled: loading, children: [_jsx("option", { value: "", children: "Any time" }), timeSlots.map(slot => (_jsx("option", { value: slot, children: slot }, slot)))] })] })] })] })] }), _jsxs("div", { className: "border-t border-gray-200 pt-6", children: [_jsxs("div", { children: [_jsx("label", { htmlFor: "reason", className: "block text-sm font-medium text-gray-700 mb-2", children: "Reason for Visit *" }), _jsx("textarea", { ...form.register('reason'), id: "reason", rows: 4, placeholder: "Please describe your symptoms or reason for the appointment...", className: "w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none", disabled: loading }), form.formState.errors.reason && (_jsx("p", { className: "mt-2 text-sm text-red-600", children: form.formState.errors.reason.message })), _jsxs("p", { className: "mt-1 text-xs text-gray-500", children: [form.watch('reason')?.length || 0, " / 500 characters"] })] }), _jsxs("div", { className: "mt-4", children: [_jsx("label", { htmlFor: "notes", className: "block text-sm font-medium text-gray-700 mb-2", children: "Additional Notes (Optional)" }), _jsx("textarea", { ...form.register('notes'), id: "notes", rows: 3, placeholder: "Any additional information you'd like us to know...", className: "w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none", disabled: loading }), form.formState.errors.notes && (_jsx("p", { className: "mt-2 text-sm text-red-600", children: form.formState.errors.notes.message }))] })] }), _jsx("div", { className: "bg-blue-50 border border-blue-200 rounded-lg p-4", children: _jsxs("p", { className: "text-sm text-blue-800", children: [_jsx("strong", { children: "Note:" }), " This is a request, not a confirmed appointment. Our staff will review your request and contact you to confirm the appointment time."] }) }), _jsxs("div", { className: "flex gap-4", children: [_jsx("button", { type: "button", onClick: () => navigate('/patient/dashboard'), className: "flex-1 px-6 py-3 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors", disabled: loading, children: "Cancel" }), _jsx("button", { type: "submit", disabled: loading, className: "flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-2", children: loading ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" }), "Submitting..."] })) : ('Submit Request') })] })] })] }));
}
