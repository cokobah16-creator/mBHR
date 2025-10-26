import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { formatNigerianDate } from '@/utils/dateFormat';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeftIcon, CalendarIcon, HeartIcon, ClipboardDocumentListIcon } from '@heroicons/react/24/outline';
import { getVisitDetails } from '@/services/patientPortalData';
import * as logger from '@/lib/logger';
export function VisitDetail() {
    const { visitId } = useParams();
    const [visit, setVisit] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    useEffect(() => {
        if (visitId) {
            loadVisitDetails(visitId);
        }
    }, [visitId]);
    const loadVisitDetails = async (id) => {
        setLoading(true);
        setError('');
        try {
            const portalUserStr = localStorage.getItem('patient_portal_user');
            if (!portalUserStr) {
                window.location.href = '/patient/login';
                return;
            }
            const portalUser = JSON.parse(portalUserStr);
            if (!portalUser.patientId || !portalUser.id) {
                localStorage.removeItem('patient_portal_user');
                localStorage.removeItem('patient_session_token');
                window.location.href = '/patient/login';
                return;
            }
            const visitData = await getVisitDetails(portalUser.id, portalUser.patientId, id);
            if (visitData) {
                setVisit(visitData);
            }
            else {
                setError('Visit not found');
            }
        }
        catch (err) {
            logger.error('Error loading visit details:', err);
            setError('An error occurred loading visit details');
        }
        finally {
            setLoading(false);
        }
    };
    if (loading) {
        return (_jsx("div", { className: "flex items-center justify-center min-h-screen", children: _jsx("div", { className: "w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" }) }));
    }
    if (error || !visit) {
        return (_jsxs("div", { className: "max-w-4xl mx-auto px-4 py-8", children: [_jsx("div", { className: "bg-red-50 border border-red-200 rounded-lg p-6", children: _jsx("p", { className: "text-red-800", children: error || 'Visit not found' }) }), _jsxs(Link, { to: "/patient/medical-history", className: "inline-flex items-center gap-2 mt-4 text-blue-600 hover:text-blue-700", children: [_jsx(ArrowLeftIcon, { className: "w-4 h-4" }), "Back to Medical History"] })] }));
    }
    return (_jsxs("div", { className: "max-w-4xl mx-auto px-4 py-8", children: [_jsxs(Link, { to: "/patient/medical-history", className: "inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-6", children: [_jsx(ArrowLeftIcon, { className: "w-4 h-4" }), "Back to Medical History"] }), _jsx("div", { className: "bg-white rounded-xl shadow-sm p-6 mb-6", children: _jsxs("div", { className: "flex items-center gap-4 mb-4", children: [_jsx("div", { className: "w-16 h-16 bg-blue-100 rounded-xl flex items-center justify-center", children: _jsx(CalendarIcon, { className: "w-8 h-8 text-blue-600" }) }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: new Date(visit.visitDate).toLocaleDateString('en-US', {
                                        weekday: 'long',
                                        year: 'numeric',
                                        month: 'long',
                                        day: 'numeric'
                                    }) }), visit.chiefComplaint && (_jsx("p", { className: "text-gray-600 mt-1", children: visit.chiefComplaint }))] })] }) }), visit.vitals && (_jsxs("div", { className: "bg-white rounded-xl shadow-sm p-6 mb-6", children: [_jsxs("h2", { className: "text-xl font-bold text-gray-900 mb-4 flex items-center gap-2", children: [_jsx(HeartIcon, { className: "w-6 h-6 text-blue-600" }), "Vital Signs"] }), _jsxs("div", { className: "grid grid-cols-2 md:grid-cols-4 gap-4", children: [visit.vitals.systolic && visit.vitals.diastolic && (_jsxs("div", { className: "bg-gray-50 rounded-lg p-4", children: [_jsx("p", { className: "text-sm text-gray-600 mb-1", children: "Blood Pressure" }), _jsxs("p", { className: "text-2xl font-bold text-gray-900", children: [visit.vitals.systolic, "/", visit.vitals.diastolic] }), _jsx("p", { className: "text-xs text-gray-500", children: "mmHg" })] })), visit.vitals.pulseBpm && (_jsxs("div", { className: "bg-gray-50 rounded-lg p-4", children: [_jsx("p", { className: "text-sm text-gray-600 mb-1", children: "Heart Rate" }), _jsx("p", { className: "text-2xl font-bold text-gray-900", children: visit.vitals.pulseBpm }), _jsx("p", { className: "text-xs text-gray-500", children: "bpm" })] })), visit.vitals.tempC && (_jsxs("div", { className: "bg-gray-50 rounded-lg p-4", children: [_jsx("p", { className: "text-sm text-gray-600 mb-1", children: "Temperature" }), _jsxs("p", { className: "text-2xl font-bold text-gray-900", children: [visit.vitals.tempC, "\u00B0C"] }), _jsx("p", { className: "text-xs text-gray-500", children: "celsius" })] })), visit.vitals.spo2 && (_jsxs("div", { className: "bg-gray-50 rounded-lg p-4", children: [_jsx("p", { className: "text-sm text-gray-600 mb-1", children: "O2 Saturation" }), _jsxs("p", { className: "text-2xl font-bold text-gray-900", children: [visit.vitals.spo2, "%"] }), _jsx("p", { className: "text-xs text-gray-500", children: "SpO2" })] })), visit.vitals.heightCm && (_jsxs("div", { className: "bg-gray-50 rounded-lg p-4", children: [_jsx("p", { className: "text-sm text-gray-600 mb-1", children: "Height" }), _jsx("p", { className: "text-2xl font-bold text-gray-900", children: visit.vitals.heightCm }), _jsx("p", { className: "text-xs text-gray-500", children: "cm" })] })), visit.vitals.weightKg && (_jsxs("div", { className: "bg-gray-50 rounded-lg p-4", children: [_jsx("p", { className: "text-sm text-gray-600 mb-1", children: "Weight" }), _jsx("p", { className: "text-2xl font-bold text-gray-900", children: visit.vitals.weightKg }), _jsx("p", { className: "text-xs text-gray-500", children: "kg" })] })), visit.vitals.bmi && (_jsxs("div", { className: "bg-gray-50 rounded-lg p-4", children: [_jsx("p", { className: "text-sm text-gray-600 mb-1", children: "BMI" }), _jsx("p", { className: "text-2xl font-bold text-gray-900", children: visit.vitals.bmi.toFixed(1) }), _jsx("p", { className: "text-xs text-gray-500", children: "kg/m\u00B2" })] }))] })] })), visit.consultation && (_jsxs("div", { className: "bg-white rounded-xl shadow-sm p-6 mb-6", children: [_jsxs("h2", { className: "text-xl font-bold text-gray-900 mb-4 flex items-center gap-2", children: [_jsx(ClipboardDocumentListIcon, { className: "w-6 h-6 text-blue-600" }), "Consultation Notes"] }), visit.consultation.diagnoses.length > 0 && (_jsxs("div", { className: "mb-6", children: [_jsx("h3", { className: "text-sm font-semibold text-gray-700 mb-2", children: "Diagnosis" }), _jsx("div", { className: "flex flex-wrap gap-2", children: visit.consultation.diagnoses.map((diagnosis, idx) => (_jsx("span", { className: "inline-flex items-center px-4 py-2 bg-blue-100 text-blue-800 rounded-lg text-sm font-medium", children: diagnosis }, idx))) })] })), _jsxs("div", { className: "space-y-4", children: [visit.consultation.subjective && (_jsxs("div", { children: [_jsx("h3", { className: "text-sm font-semibold text-gray-700 mb-2", children: "Symptoms (Subjective)" }), _jsx("p", { className: "text-gray-900 bg-gray-50 rounded-lg p-4", children: visit.consultation.subjective })] })), visit.consultation.objective && (_jsxs("div", { children: [_jsx("h3", { className: "text-sm font-semibold text-gray-700 mb-2", children: "Examination (Objective)" }), _jsx("p", { className: "text-gray-900 bg-gray-50 rounded-lg p-4", children: visit.consultation.objective })] })), visit.consultation.assessment && (_jsxs("div", { children: [_jsx("h3", { className: "text-sm font-semibold text-gray-700 mb-2", children: "Assessment" }), _jsx("p", { className: "text-gray-900 bg-gray-50 rounded-lg p-4", children: visit.consultation.assessment })] })), visit.consultation.plan && (_jsxs("div", { children: [_jsx("h3", { className: "text-sm font-semibold text-gray-700 mb-2", children: "Treatment Plan" }), _jsx("p", { className: "text-gray-900 bg-gray-50 rounded-lg p-4", children: visit.consultation.plan })] }))] }), visit.consultation.providerName && (_jsx("div", { className: "mt-6 pt-6 border-t border-gray-200", children: _jsxs("p", { className: "text-sm text-gray-600", children: [_jsx("span", { className: "font-medium", children: "Provider:" }), " ", visit.consultation.providerName] }) }))] })), visit.prescriptions && visit.prescriptions.length > 0 && (_jsxs("div", { className: "bg-white rounded-xl shadow-sm p-6", children: [_jsx("h2", { className: "text-xl font-bold text-gray-900 mb-4", children: "Medications Prescribed" }), _jsx("div", { className: "space-y-3", children: visit.prescriptions.map((rx, idx) => (_jsxs("div", { className: "flex items-start gap-4 p-4 bg-gray-50 rounded-lg", children: [_jsx("div", { className: "w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0", children: _jsx(HeartIcon, { className: "w-6 h-6 text-blue-600" }) }), _jsxs("div", { className: "flex-1", children: [_jsx("h3", { className: "font-semibold text-gray-900", children: rx.medicationName }), _jsx("p", { className: "text-sm text-gray-600 mt-1", children: rx.dosage }), _jsx("p", { className: "text-sm text-gray-600 mt-1", children: rx.directions }), _jsxs("p", { className: "text-xs text-gray-500 mt-2", children: ["Dispensed: ", formatNigerianDate(rx.dispensedAt)] })] })] }, idx))) })] }))] }));
}
