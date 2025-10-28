import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { db } from '@/db';
import { useAuthStore } from '@/stores/auth';
import { doctorService } from '@/services/doctorService';
import { outreachService } from '@/services/outreachService';
import { getFlagColor } from '@/utils/vitals';
import { UserIcon, ClockIcon, FlagIcon, ChartBarIcon, CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
export function DoctorDashboard() {
    const { currentUser } = useAuthStore();
    const [queuePatients, setQueuePatients] = useState([]);
    const [activeEvent, setActiveEvent] = useState(null);
    const [analytics, setAnalytics] = useState(null);
    const [loading, setLoading] = useState(true);
    const [selectedPatient, setSelectedPatient] = useState(null);
    useEffect(() => {
        if (currentUser) {
            loadDashboardData();
            const interval = setInterval(loadDashboardData, 30000);
            return () => clearInterval(interval);
        }
    }, [currentUser]);
    const loadDashboardData = async () => {
        if (!currentUser)
            return;
        try {
            setLoading(true);
            const event = await outreachService.getActiveEventForUser(currentUser.id);
            setActiveEvent(event);
            const queue = await db.queue
                .where('stage')
                .equals('consult')
                .and(item => item.status === 'waiting' || item.status === 'in_progress')
                .toArray();
            const patientsWithData = await Promise.all(queue.map(async (item) => {
                const patient = await db.patients.get(item.patientId);
                const vitals = await db.vitals
                    .where('patientId')
                    .equals(item.patientId)
                    .reverse()
                    .first();
                let flags = [];
                if (event && event.org_id) {
                    flags = await doctorService.getPatientFlags({
                        org_id: event.org_id,
                        event_id: event.id,
                        status: 'open'
                    });
                    flags = flags.filter(f => f.patient_id === item.patientId);
                }
                return {
                    ...item,
                    patient,
                    latestVitals: vitals,
                    flags
                };
            }));
            patientsWithData.sort((a, b) => {
                if (a.flags.length > 0 && b.flags.length === 0)
                    return -1;
                if (a.flags.length === 0 && b.flags.length > 0)
                    return 1;
                const hasUrgentA = a.flags.some(f => f.priority === 'urgent');
                const hasUrgentB = b.flags.some(f => f.priority === 'urgent');
                if (hasUrgentA && !hasUrgentB)
                    return -1;
                if (!hasUrgentA && hasUrgentB)
                    return 1;
                return a.position - b.position;
            });
            setQueuePatients(patientsWithData);
            if (event && event.id) {
                const analyticsData = await doctorService.getDoctorAnalytics(event.id, currentUser.id);
                setAnalytics(analyticsData);
            }
        }
        catch (error) {
            console.error('Error loading doctor dashboard:', error);
        }
        finally {
            setLoading(false);
        }
    };
    const getWaitTime = (updatedAt) => {
        const now = new Date();
        const diff = now.getTime() - new Date(updatedAt).getTime();
        const minutes = Math.floor(diff / 60000);
        if (minutes < 60)
            return `${minutes}m`;
        return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
    };
    const getVitalsFlags = (vitals) => {
        if (!vitals || !vitals.flags || vitals.flags.length === 0) {
            return null;
        }
        return (_jsx("div", { className: "flex flex-wrap gap-1 mt-2", children: vitals.flags.map((flag, idx) => (_jsx("span", { className: `text-xs px-2 py-0.5 rounded-full ${getFlagColor(flag)}`, children: flag }, idx))) }));
    };
    if (loading) {
        return (_jsx("div", { className: "flex items-center justify-center min-h-screen", children: _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" }), _jsx("p", { className: "mt-4 text-gray-600", children: "Loading consultation queue..." })] }) }));
    }
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Doctor Consultation Station" }), _jsx("p", { className: "text-gray-600", children: activeEvent ? `${activeEvent.event_name} - ${activeEvent.site_id}` : 'No active event' })] }), analytics && (_jsxs("div", { className: "flex items-center space-x-4 bg-white rounded-lg shadow-sm p-4", children: [_jsxs("div", { className: "text-center", children: [_jsx("div", { className: "text-2xl font-bold text-blue-600", children: analytics.patients_seen }), _jsx("div", { className: "text-xs text-gray-600", children: "Patients Seen" })] }), _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "text-2xl font-bold text-green-600", children: analytics.consultations_completed }), _jsx("div", { className: "text-xs text-gray-600", children: "Completed" })] }), analytics.avg_consultation_time_minutes && (_jsxs("div", { className: "text-center", children: [_jsxs("div", { className: "text-2xl font-bold text-orange-600", children: [analytics.avg_consultation_time_minutes.toFixed(1), "m"] }), _jsx("div", { className: "text-xs text-gray-600", children: "Avg Time" })] }))] }))] }), queuePatients.length === 0 ? (_jsxs("div", { className: "bg-white rounded-lg shadow-sm p-12 text-center", children: [_jsx(CheckCircleIcon, { className: "h-16 w-16 text-green-500 mx-auto mb-4" }), _jsx("h3", { className: "text-lg font-medium text-gray-900 mb-2", children: "Queue Clear" }), _jsx("p", { className: "text-gray-600", children: "No patients waiting for consultation at this time." })] })) : (_jsx("div", { className: "grid gap-4", children: queuePatients.map((item) => {
                    if (!item.patient)
                        return null;
                    const isActive = selectedPatient === item.patientId;
                    const hasUrgentFlags = item.flags.some(f => f.priority === 'urgent');
                    return (_jsx("div", { className: `bg-white rounded-lg shadow-sm p-6 border-2 transition-all ${isActive
                            ? 'border-blue-500'
                            : hasUrgentFlags
                                ? 'border-red-300'
                                : 'border-transparent hover:border-gray-300'}`, children: _jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { className: "flex items-start space-x-4 flex-1", children: [item.patient.photoUrl ? (_jsx("img", { src: item.patient.photoUrl, alt: `${item.patient.givenName} ${item.patient.familyName}`, className: "w-16 h-16 rounded-full object-cover" })) : (_jsx("div", { className: "w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center", children: _jsx(UserIcon, { className: "h-8 w-8 text-gray-400" }) })), _jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsxs("h3", { className: "text-lg font-semibold text-gray-900", children: [item.patient.givenName, " ", item.patient.familyName] }), _jsxs("span", { className: "text-sm text-gray-500", children: [item.patient.sex, " \u2022 ", item.patient.dob] }), item.flags.length > 0 && (_jsxs("span", { className: "flex items-center text-sm text-red-600", children: [_jsx(ExclamationTriangleIcon, { className: "h-4 w-4 mr-1" }), item.flags.length, " flag", item.flags.length > 1 ? 's' : ''] }))] }), _jsxs("div", { className: "mt-2 text-sm text-gray-600", children: [_jsx("p", { children: item.patient.phone }), _jsx("p", { children: item.patient.address })] }), item.latestVitals && (_jsxs("div", { className: "mt-3 grid grid-cols-4 gap-4 text-sm", children: [_jsxs("div", { children: [_jsx("span", { className: "text-gray-600", children: "BP:" }), _jsxs("span", { className: "ml-1 font-medium", children: [item.latestVitals.systolic, "/", item.latestVitals.diastolic] })] }), _jsxs("div", { children: [_jsx("span", { className: "text-gray-600", children: "Temp:" }), _jsxs("span", { className: "ml-1 font-medium", children: [item.latestVitals.tempC, "\u00B0C"] })] }), _jsxs("div", { children: [_jsx("span", { className: "text-gray-600", children: "Pulse:" }), _jsxs("span", { className: "ml-1 font-medium", children: [item.latestVitals.pulseBpm, " bpm"] })] }), _jsxs("div", { children: [_jsx("span", { className: "text-gray-600", children: "SpO2:" }), _jsxs("span", { className: "ml-1 font-medium", children: [item.latestVitals.spo2, "%"] })] })] })), getVitalsFlags(item.latestVitals), item.flags.length > 0 && (_jsx("div", { className: "mt-3 space-y-2", children: item.flags.map((flag) => (_jsxs("div", { className: "flex items-start space-x-2 text-sm bg-yellow-50 border border-yellow-200 rounded p-2", children: [_jsx(FlagIcon, { className: "h-4 w-4 text-yellow-600 mt-0.5" }), _jsxs("div", { children: [_jsx("div", { className: "font-medium text-yellow-900", children: flag.flag_type.replace(/_/g, ' ') }), _jsx("div", { className: "text-yellow-800", children: flag.message })] })] }, flag.id))) }))] })] }), _jsxs("div", { className: "flex flex-col items-end space-y-2", children: [_jsxs("div", { className: "flex items-center text-sm text-gray-500", children: [_jsx(ClockIcon, { className: "h-4 w-4 mr-1" }), getWaitTime(item.updatedAt)] }), _jsx(Link, { to: `/consult`, state: { patientId: item.patientId }, className: "btn-primary text-sm", onClick: () => setSelectedPatient(item.patientId), children: "Start Consultation" }), _jsx(Link, { to: `/patients/${item.patientId}`, className: "btn-secondary text-sm", children: "View History" })] })] }) }, item.id));
                }) })), _jsxs("div", { className: "bg-white rounded-lg shadow-sm p-6", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Quick Actions" }), _jsxs("div", { className: "grid grid-cols-2 md:grid-cols-4 gap-4", children: [_jsxs(Link, { to: "/labs", className: "btn-secondary flex items-center justify-center", children: [_jsx(ChartBarIcon, { className: "h-5 w-5 mr-2" }), "Lab Orders"] }), _jsx(Link, { to: "/pharmacy", className: "btn-secondary flex items-center justify-center", children: "Pharmacy" }), _jsxs(Link, { to: "/patients", className: "btn-secondary flex items-center justify-center", children: [_jsx(UserIcon, { className: "h-5 w-5 mr-2" }), "All Patients"] }), _jsx("button", { className: "btn-secondary flex items-center justify-center", children: "Protocols" })] })] })] }));
}
