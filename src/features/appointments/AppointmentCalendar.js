import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CalendarIcon, ClockIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { createAppointment, getUpcomingAppointments, getTodayAppointments, checkAvailability, updateAppointmentStatus, } from '@/services/appointments';
import { useToast } from '@/stores/toast';
const appointmentSchema = z.object({
    patientId: z.string().min(1, 'Patient is required'),
    providerId: z.string().min(1, 'Provider is required'),
    appointmentType: z.string().min(1, 'Appointment type is required'),
    scheduledAt: z.string().min(1, 'Date and time are required'),
    durationMinutes: z.number().min(15).max(240),
    reason: z.string().optional(),
});
const appointmentTypes = [
    'Initial Consultation',
    'Follow-up',
    'Vaccination',
    'Health Screening',
    'Lab Results Review',
    'Wound Care',
    'Chronic Disease Management',
    'Prenatal Care',
    'Postnatal Care',
    'Child Wellness Visit',
];
export function AppointmentCalendar({ providerId, patientId, createdBy }) {
    const [appointments, setAppointments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
    const [viewMode, setViewMode] = useState('today');
    const toast = useToast();
    const { register, handleSubmit, formState: { errors }, reset, watch, } = useForm({
        resolver: zodResolver(appointmentSchema),
        defaultValues: {
            providerId: providerId || '',
            patientId: patientId || '',
            durationMinutes: 30,
        },
    });
    useEffect(() => {
        loadAppointments();
    }, [viewMode, selectedDate]);
    const loadAppointments = async () => {
        try {
            setLoading(true);
            let data;
            if (viewMode === 'today') {
                data = await getTodayAppointments();
            }
            else {
                data = await getUpcomingAppointments();
            }
            setAppointments(data);
        }
        catch (error) {
            console.error('Failed to load appointments:', error);
        }
        finally {
            setLoading(false);
        }
    };
    const onSubmit = async (data) => {
        try {
            const isAvailable = await checkAvailability(data.providerId, new Date(data.scheduledAt), data.durationMinutes);
            if (!isAvailable) {
                toast.push({
                    id: Date.now().toString(),
                    title: 'Time slot not available',
                    body: 'Please choose a different time',
                });
                return;
            }
            await createAppointment({
                patientId: data.patientId,
                providerId: data.providerId,
                appointmentType: data.appointmentType,
                scheduledAt: new Date(data.scheduledAt),
                durationMinutes: data.durationMinutes,
                status: 'scheduled',
                reason: data.reason,
                createdBy,
            });
            toast.push({ id: Date.now().toString(), title: 'Appointment scheduled successfully' });
            setShowForm(false);
            reset();
            await loadAppointments();
        }
        catch (error) {
            console.error('Failed to create appointment:', error);
            toast.push({ id: Date.now().toString(), title: 'Failed to schedule appointment' });
        }
    };
    const handleStatusChange = async (appointmentId, newStatus) => {
        try {
            await updateAppointmentStatus(appointmentId, newStatus);
            toast.push({ id: Date.now().toString(), title: `Appointment ${newStatus}` });
            await loadAppointments();
        }
        catch (error) {
            console.error('Failed to update appointment:', error);
            toast.push({ id: Date.now().toString(), title: 'Failed to update appointment' });
        }
    };
    const getStatusColor = (status) => {
        switch (status) {
            case 'scheduled':
                return 'bg-blue-100 text-blue-800';
            case 'confirmed':
                return 'bg-green-100 text-green-800';
            case 'arrived':
                return 'bg-purple-100 text-purple-800';
            case 'in-progress':
                return 'bg-yellow-100 text-yellow-800';
            case 'completed':
                return 'bg-gray-100 text-gray-800';
            case 'no-show':
                return 'bg-red-100 text-red-800';
            case 'cancelled':
                return 'bg-orange-100 text-orange-800';
            default:
                return 'bg-gray-100 text-gray-800';
        }
    };
    const formatTime = (dateString) => {
        const date = new Date(dateString);
        return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    };
    if (loading) {
        return (_jsx("div", { className: "flex items-center justify-center p-8", children: _jsx("div", { className: "animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" }) }));
    }
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "bg-white rounded-lg shadow", children: [_jsx("div", { className: "px-4 py-5 sm:px-6 border-b border-gray-200", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center", children: [_jsx(CalendarIcon, { className: "h-6 w-6 text-gray-400 mr-2" }), _jsx("h3", { className: "text-lg font-medium text-gray-900", children: "Appointment Schedule" })] }), _jsxs("div", { className: "flex items-center space-x-2", children: [_jsxs("div", { className: "flex rounded-md shadow-sm", children: [_jsx("button", { onClick: () => setViewMode('today'), className: `px-3 py-2 text-sm font-medium rounded-l-md ${viewMode === 'today'
                                                        ? 'bg-indigo-600 text-white'
                                                        : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'}`, children: "Today" }), _jsx("button", { onClick: () => setViewMode('week'), className: `px-3 py-2 text-sm font-medium ${viewMode === 'week'
                                                        ? 'bg-indigo-600 text-white'
                                                        : 'bg-white text-gray-700 hover:bg-gray-50 border-t border-b border-gray-300'}`, children: "Week" }), _jsx("button", { onClick: () => setViewMode('month'), className: `px-3 py-2 text-sm font-medium rounded-r-md ${viewMode === 'month'
                                                        ? 'bg-indigo-600 text-white'
                                                        : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'}`, children: "Month" })] }), _jsx("button", { onClick: () => setShowForm(true), className: "inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700", children: "Schedule Appointment" })] })] }) }), _jsx("div", { className: "p-4", children: appointments.length === 0 ? (_jsx("div", { className: "text-center py-8 text-gray-500", children: "No appointments scheduled" })) : (_jsx("div", { className: "space-y-3", children: appointments.map((appointment) => (_jsx("div", { className: "border border-gray-200 rounded-lg p-4 hover:bg-gray-50", children: _jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center", children: [_jsx("span", { className: `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(appointment.status)}`, children: appointment.status }), _jsx("span", { className: "ml-3 text-sm font-medium text-gray-900", children: appointment.appointment_type })] }), _jsxs("div", { className: "mt-2 flex items-center text-sm text-gray-500", children: [_jsx(ClockIcon, { className: "flex-shrink-0 mr-1.5 h-4 w-4" }), formatTime(appointment.scheduled_at), " (", appointment.duration_minutes, " min)"] }), appointment.reason && (_jsx("div", { className: "mt-1 text-sm text-gray-600", children: appointment.reason }))] }), appointment.status === 'scheduled' && (_jsxs("div", { className: "flex space-x-2 ml-4", children: [_jsx("button", { onClick: () => handleStatusChange(appointment.id, 'confirmed'), className: "px-3 py-1 text-xs font-medium text-green-700 bg-green-100 rounded-md hover:bg-green-200", children: "Confirm" }), _jsx("button", { onClick: () => handleStatusChange(appointment.id, 'cancelled'), className: "px-3 py-1 text-xs font-medium text-red-700 bg-red-100 rounded-md hover:bg-red-200", children: "Cancel" })] })), appointment.status === 'confirmed' && (_jsx("button", { onClick: () => handleStatusChange(appointment.id, 'arrived'), className: "px-3 py-1 text-xs font-medium text-purple-700 bg-purple-100 rounded-md hover:bg-purple-200", children: "Mark Arrived" })), appointment.status === 'arrived' && (_jsx("button", { onClick: () => handleStatusChange(appointment.id, 'in-progress'), className: "px-3 py-1 text-xs font-medium text-yellow-700 bg-yellow-100 rounded-md hover:bg-yellow-200", children: "Start" }))] }) }, appointment.id))) })) })] }), showForm && (_jsx("div", { className: "fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50", children: _jsxs("div", { className: "bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto", children: [_jsxs("div", { className: "px-4 py-5 sm:px-6 border-b border-gray-200 flex items-center justify-between", children: [_jsx("h3", { className: "text-lg font-medium text-gray-900", children: "Schedule Appointment" }), _jsx("button", { onClick: () => setShowForm(false), className: "text-gray-400 hover:text-gray-500", children: _jsx(XMarkIcon, { className: "h-6 w-6" }) })] }), _jsxs("form", { onSubmit: handleSubmit(onSubmit), className: "px-4 py-5 sm:p-6 space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "Patient ID *" }), _jsx("input", { ...register('patientId'), type: "text", className: "mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm", placeholder: "Enter patient ID" }), errors.patientId && (_jsx("p", { className: "mt-1 text-sm text-red-600", children: errors.patientId.message }))] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "Provider ID *" }), _jsx("input", { ...register('providerId'), type: "text", className: "mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm", placeholder: "Enter provider ID" }), errors.providerId && (_jsx("p", { className: "mt-1 text-sm text-red-600", children: errors.providerId.message }))] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "Appointment Type *" }), _jsxs("select", { ...register('appointmentType'), className: "mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm", children: [_jsx("option", { value: "", children: "Select type..." }), appointmentTypes.map((type) => (_jsx("option", { value: type, children: type }, type)))] }), errors.appointmentType && (_jsx("p", { className: "mt-1 text-sm text-red-600", children: errors.appointmentType.message }))] }), _jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "Date & Time *" }), _jsx("input", { ...register('scheduledAt'), type: "datetime-local", className: "mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" }), errors.scheduledAt && (_jsx("p", { className: "mt-1 text-sm text-red-600", children: errors.scheduledAt.message }))] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "Duration (minutes) *" }), _jsxs("select", { ...register('durationMinutes', { valueAsNumber: true }), className: "mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm", children: [_jsx("option", { value: 15, children: "15 minutes" }), _jsx("option", { value: 30, children: "30 minutes" }), _jsx("option", { value: 45, children: "45 minutes" }), _jsx("option", { value: 60, children: "1 hour" }), _jsx("option", { value: 90, children: "1.5 hours" }), _jsx("option", { value: 120, children: "2 hours" })] })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "Reason for Visit" }), _jsx("textarea", { ...register('reason'), rows: 3, className: "mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm", placeholder: "Brief description of the visit reason..." })] }), _jsxs("div", { className: "flex justify-end space-x-3 pt-4 border-t", children: [_jsx("button", { type: "button", onClick: () => setShowForm(false), className: "px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50", children: "Cancel" }), _jsx("button", { type: "submit", className: "px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700", children: "Schedule" })] })] })] }) }))] }));
}
