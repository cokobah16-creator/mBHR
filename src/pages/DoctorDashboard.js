import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { db } from '@/db';
import { useAuthStore } from '@/stores/auth';
import { queueManagement } from '@/services/queueManagement';
import { getFlagColor } from '@/utils/vitals';
import { palaverRoom } from '@/services/palaverRoom';
import { PalaverRoom } from '@/features/doctor/PalaverRoom';
import { UserIcon, ClockIcon, ChartBarIcon, CheckCircleIcon, HeartIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';
export function DoctorDashboard() {
    const { currentUser } = useAuthStore();
    const [queuePatients, setQueuePatients] = useState([]);
    const [stats, setStats] = useState({ waiting: 0, inProgress: 0, completed: 0 });
    const [loading, setLoading] = useState(true);
    const [showPalaverRoom, setShowPalaverRoom] = useState(false);
    const [unreadMessages, setUnreadMessages] = useState(0);
    const userId = currentUser?.id;
    const loadUnreadCount = useCallback(async () => {
        if (!userId)
            return;
        try {
            const count = await palaverRoom.getUnreadCount(userId);
            setUnreadMessages(count);
        }
        catch (err) {
            console.error('Failed to load unread count:', err);
        }
    }, [userId]);
    useEffect(() => {
        if (userId) {
            loadDashboardData();
            loadUnreadCount();
            const interval = setInterval(loadDashboardData, 10000);
            const messageInterval = setInterval(loadUnreadCount, 30000);
            return () => {
                clearInterval(interval);
                clearInterval(messageInterval);
            };
        }
    }, [userId, loadUnreadCount]);
    const loadDashboardData = async () => {
        if (!currentUser)
            return;
        try {
            setLoading(true);
            // Get all consult stage patients
            const queue = await db.queue
                .where('stage')
                .equals('consult')
                .and(item => item.status !== 'done')
                .toArray();
            // Get stats for today
            const allConsultItems = await db.queue
                .where('stage')
                .equals('consult')
                .toArray();
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayItems = allConsultItems.filter(item => {
                const itemDate = new Date(item.updatedAt);
                itemDate.setHours(0, 0, 0, 0);
                return itemDate.getTime() === today.getTime();
            });
            setStats({
                waiting: queue.filter(i => i.status === 'waiting').length,
                inProgress: queue.filter(i => i.status === 'in_progress').length,
                completed: todayItems.filter(i => i.status === 'done').length
            });
            // Load patient data
            const patientsWithData = await Promise.all(queue.map(async (item) => {
                const patient = await db.patients.get(item.patientId);
                const vitals = await db.vitals
                    .where('patientId')
                    .equals(item.patientId)
                    .reverse()
                    .first();
                const openVisit = await db.visits
                    .where('patientId')
                    .equals(item.patientId)
                    .and(v => v.status === 'open')
                    .first();
                return {
                    ...item,
                    patient,
                    latestVitals: vitals,
                    openVisit
                };
            }));
            // Sort by position
            patientsWithData.sort((a, b) => a.position - b.position);
            setQueuePatients(patientsWithData);
        }
        catch (error) {
            console.error('Error loading doctor dashboard:', error);
        }
        finally {
            setLoading(false);
        }
    };
    const handleStartConsultation = async (item) => {
        try {
            await queueManagement.startService(item.id);
            await loadDashboardData();
        }
        catch (error) {
            console.error('Error starting consultation:', error);
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
    const waiting = queuePatients.filter(item => item.status === 'waiting');
    const inProgress = queuePatients.find(item => item.status === 'in_progress');
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Doctor Consultation Station" }), _jsxs("p", { className: "text-gray-600", children: [currentUser?.fullName || 'Doctor', " - Consultation Queue"] })] }), _jsxs("div", { className: "flex items-center gap-4", children: [_jsxs("button", { onClick: () => setShowPalaverRoom(true), className: "relative flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors shadow-sm", children: [_jsx(ChatBubbleLeftRightIcon, { className: "h-5 w-5" }), _jsx("span", { className: "font-medium", children: "Palaver Room" }), unreadMessages > 0 && (_jsx("span", { className: "absolute -top-2 -right-2 px-2 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] text-center", children: unreadMessages }))] }), _jsxs("div", { className: "flex items-center space-x-4 bg-white rounded-lg shadow-sm p-4", children: [_jsxs("div", { className: "text-center", children: [_jsx("div", { className: "text-2xl font-bold text-blue-600", children: stats.waiting }), _jsx("div", { className: "text-xs text-gray-600", children: "Waiting" })] }), _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "text-2xl font-bold text-yellow-600", children: stats.inProgress }), _jsx("div", { className: "text-xs text-gray-600", children: "In Progress" })] }), _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "text-2xl font-bold text-green-600", children: stats.completed }), _jsx("div", { className: "text-xs text-gray-600", children: "Completed Today" })] })] })] })] }), showPalaverRoom && (_jsxs(_Fragment, { children: [_jsx("div", { className: "fixed inset-0 bg-black bg-opacity-50 z-40", onClick: () => setShowPalaverRoom(false) }), _jsx("div", { className: "fixed right-0 top-0 bottom-0 w-full max-w-md z-50 shadow-2xl", children: _jsx(PalaverRoom, { onClose: () => {
                                setShowPalaverRoom(false);
                                loadUnreadCount();
                            }, isPanel: true }) })] })), inProgress && (_jsxs("div", { className: "bg-yellow-50 border-2 border-yellow-300 rounded-lg p-6", children: [_jsx("h3", { className: "text-sm font-semibold text-yellow-800 mb-3 uppercase", children: "Currently Consulting" }), _jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { className: "flex items-start space-x-4 flex-1", children: [inProgress.patient?.photoUrl ? (_jsx("img", { src: inProgress.patient.photoUrl, alt: `${inProgress.patient.givenName} ${inProgress.patient.familyName}`, className: "w-16 h-16 rounded-full object-cover" })) : (_jsx("div", { className: "w-16 h-16 rounded-full bg-yellow-200 flex items-center justify-center", children: _jsx(UserIcon, { className: "h-8 w-8 text-yellow-700" }) })), _jsxs("div", { className: "flex-1", children: [_jsxs("h3", { className: "text-xl font-semibold text-gray-900", children: [inProgress.patient?.givenName, " ", inProgress.patient?.familyName] }), _jsxs("p", { className: "text-gray-600 mt-1", children: [inProgress.patient?.sex, " \u2022 ", inProgress.patient?.dob] }), _jsx("p", { className: "text-gray-600", children: inProgress.patient?.phone }), inProgress.latestVitals && (_jsxs("div", { className: "mt-3 grid grid-cols-4 gap-4 text-sm", children: [_jsxs("div", { children: [_jsx("span", { className: "text-gray-600", children: "BP:" }), _jsxs("span", { className: "ml-1 font-medium", children: [inProgress.latestVitals.systolic, "/", inProgress.latestVitals.diastolic] })] }), _jsxs("div", { children: [_jsx("span", { className: "text-gray-600", children: "Temp:" }), _jsxs("span", { className: "ml-1 font-medium", children: [inProgress.latestVitals.tempC, "\u00B0C"] })] }), _jsxs("div", { children: [_jsx("span", { className: "text-gray-600", children: "Pulse:" }), _jsxs("span", { className: "ml-1 font-medium", children: [inProgress.latestVitals.pulseBpm, " bpm"] })] }), _jsxs("div", { children: [_jsx("span", { className: "text-gray-600", children: "SpO2:" }), _jsxs("span", { className: "ml-1 font-medium", children: [inProgress.latestVitals.spo2, "%"] })] })] })), getVitalsFlags(inProgress.latestVitals)] })] }), _jsxs("div", { className: "flex flex-col space-y-2", children: [_jsx(Link, { to: `/consult`, state: { patientId: inProgress.patientId, visitId: inProgress.openVisit?.id }, className: "btn-primary text-sm", children: "Continue Consultation" }), _jsx(Link, { to: `/patients/${inProgress.patientId}`, className: "btn-secondary text-sm text-center", children: "View History" })] })] })] })), _jsxs("div", { className: "bg-white rounded-lg shadow-sm p-6", children: [_jsxs("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: ["Waiting Queue (", waiting.length, ")"] }), waiting.length === 0 && !inProgress ? (_jsxs("div", { className: "text-center py-12", children: [_jsx(CheckCircleIcon, { className: "h-16 w-16 text-green-500 mx-auto mb-4" }), _jsx("h3", { className: "text-lg font-medium text-gray-900 mb-2", children: "Queue Clear" }), _jsx("p", { className: "text-gray-600", children: "No patients waiting for consultation at this time." })] })) : waiting.length === 0 ? (_jsx("div", { className: "text-center py-8 text-gray-500", children: _jsx("p", { children: "No additional patients waiting. Current patient in progress." }) })) : (_jsx("div", { className: "grid gap-4", children: waiting.map((item) => {
                            if (!item.patient)
                                return null;
                            const isNext = item.position === 1;
                            return (_jsx("div", { className: `border-2 rounded-lg p-4 transition-all ${isNext
                                    ? 'border-green-300 bg-green-50'
                                    : 'border-gray-200 bg-white hover:border-gray-300'}`, children: _jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { className: "flex items-start space-x-4 flex-1", children: [_jsx("div", { className: `w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg ${isNext ? 'bg-green-600' : 'bg-gray-500'}`, children: item.position }), _jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsxs("h3", { className: "text-lg font-semibold text-gray-900", children: [item.patient.givenName, " ", item.patient.familyName] }), _jsxs("span", { className: "text-sm text-gray-500", children: [item.patient.sex, " \u2022 ", item.patient.dob] })] }), _jsx("div", { className: "mt-1 text-sm text-gray-600", children: _jsx("p", { children: item.patient.phone }) }), item.latestVitals && (_jsxs("div", { className: "mt-2 grid grid-cols-4 gap-3 text-sm", children: [_jsxs("div", { children: [_jsx("span", { className: "text-gray-600", children: "BP:" }), _jsxs("span", { className: "ml-1 font-medium", children: [item.latestVitals.systolic, "/", item.latestVitals.diastolic] })] }), _jsxs("div", { children: [_jsx("span", { className: "text-gray-600", children: "Temp:" }), _jsxs("span", { className: "ml-1 font-medium", children: [item.latestVitals.tempC, "\u00B0C"] })] }), _jsxs("div", { children: [_jsx("span", { className: "text-gray-600", children: "Pulse:" }), _jsxs("span", { className: "ml-1 font-medium", children: [item.latestVitals.pulseBpm, " bpm"] })] }), _jsxs("div", { children: [_jsx("span", { className: "text-gray-600", children: "SpO2:" }), _jsxs("span", { className: "ml-1 font-medium", children: [item.latestVitals.spo2, "%"] })] })] })), getVitalsFlags(item.latestVitals)] })] }), _jsxs("div", { className: "flex flex-col items-end space-y-2", children: [_jsxs("div", { className: "flex items-center text-sm text-gray-500", children: [_jsx(ClockIcon, { className: "h-4 w-4 mr-1" }), getWaitTime(item.updatedAt)] }), isNext && !inProgress && (_jsx("button", { onClick: () => handleStartConsultation(item), className: "btn-primary text-sm", children: "Start Consultation" })), _jsx(Link, { to: `/patients/${item.patientId}`, className: "btn-secondary text-sm", children: "View History" })] })] }) }, item.id));
                        }) }))] }), _jsxs("div", { className: "bg-white rounded-lg shadow-sm p-6", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Quick Actions" }), _jsxs("div", { className: "grid grid-cols-2 md:grid-cols-5 gap-4", children: [_jsxs("button", { onClick: () => setShowPalaverRoom(true), className: "relative btn-secondary flex flex-col items-center justify-center p-4 h-24 bg-emerald-50 border-emerald-200 hover:bg-emerald-100", children: [_jsx(ChatBubbleLeftRightIcon, { className: "h-6 w-6 mb-2 text-emerald-600" }), _jsx("span", { className: "text-sm text-emerald-800", children: "Palaver Room" }), unreadMessages > 0 && (_jsx("span", { className: "absolute top-2 right-2 px-1.5 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full", children: unreadMessages }))] }), _jsxs(Link, { to: "/queue", className: "btn-secondary flex flex-col items-center justify-center p-4 h-24", children: [_jsx(ChartBarIcon, { className: "h-6 w-6 mb-2" }), _jsx("span", { className: "text-sm", children: "View All Queues" })] }), _jsxs(Link, { to: "/patients", className: "btn-secondary flex flex-col items-center justify-center p-4 h-24", children: [_jsx(UserIcon, { className: "h-6 w-6 mb-2" }), _jsx("span", { className: "text-sm", children: "All Patients" })] }), _jsxs(Link, { to: "/vitals", className: "btn-secondary flex flex-col items-center justify-center p-4 h-24", children: [_jsx(HeartIcon, { className: "h-6 w-6 mb-2" }), _jsx("span", { className: "text-sm", children: "Record Vitals" })] }), _jsxs(Link, { to: "/pharmacy", className: "btn-secondary flex flex-col items-center justify-center p-4 h-24", children: [_jsx("span", { className: "text-lg mb-2", children: "Rx" }), _jsx("span", { className: "text-sm", children: "Pharmacy" })] })] })] })] }));
}
