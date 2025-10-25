import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarIcon, ChevronRightIcon, FunnelIcon } from '@heroicons/react/24/outline';
import { getPatientMedicalHistory } from '@/services/patientPortalData';
import * as logger from '@/lib/logger';
export function MedicalHistory() {
    const [records, setRecords] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const pageSize = 10;
    useEffect(() => {
        loadRecords();
    }, [page]);
    const loadRecords = async () => {
        setLoading(true);
        setError('');
        try {
            const portalUser = JSON.parse(localStorage.getItem('patient_portal_user') || '{}');
            if (!portalUser.patientId || !portalUser.id) {
                setError('Session expired. Please login again.');
                return;
            }
            const result = await getPatientMedicalHistory(portalUser.id, portalUser.patientId, pageSize, (page - 1) * pageSize);
            if (result) {
                setRecords(result.records);
                setHasMore(result.total > page * pageSize);
            }
            else {
                setError('Failed to load medical history');
            }
        }
        catch (err) {
            logger.error('Error loading medical history:', err);
            setError('An error occurred loading your medical history');
        }
        finally {
            setLoading(false);
        }
    };
    if (loading && page === 1) {
        return (_jsx("div", { className: "flex items-center justify-center min-h-screen", children: _jsx("div", { className: "w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" }) }));
    }
    return (_jsxs("div", { className: "max-w-4xl mx-auto px-4 py-8", children: [_jsx("div", { className: "bg-white rounded-xl shadow-sm p-6 mb-6", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-3xl font-bold text-gray-900", children: "Medical History" }), _jsx("p", { className: "text-gray-600 mt-2", children: "View your past visits and consultations" })] }), _jsxs("button", { className: "flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors", children: [_jsx(FunnelIcon, { className: "w-5 h-5 text-gray-600" }), _jsx("span", { className: "text-sm font-medium text-gray-700", children: "Filter" })] })] }) }), error && (_jsx("div", { className: "bg-red-50 border border-red-200 rounded-lg p-6 mb-6", children: _jsx("p", { className: "text-red-800", children: error }) })), records.length === 0 && !loading ? (_jsxs("div", { className: "bg-white rounded-xl shadow-sm p-12 text-center", children: [_jsx(CalendarIcon, { className: "w-16 h-16 text-gray-400 mx-auto mb-4" }), _jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-2", children: "No Medical Records" }), _jsx("p", { className: "text-gray-600", children: "Your visit history will appear here once you have appointments." })] })) : (_jsx("div", { className: "space-y-4", children: records.map(record => (_jsx(Link, { to: `/patient/visit/${record.visitId}`, className: "block bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition-shadow", children: _jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center gap-3 mb-3", children: [_jsx("div", { className: "w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center", children: _jsx(CalendarIcon, { className: "w-6 h-6 text-blue-600" }) }), _jsxs("div", { children: [_jsx("p", { className: "font-semibold text-gray-900", children: new Date(record.visitDate).toLocaleDateString('en-US', {
                                                            weekday: 'long',
                                                            year: 'numeric',
                                                            month: 'long',
                                                            day: 'numeric'
                                                        }) }), record.chiefComplaint && (_jsx("p", { className: "text-sm text-gray-600", children: record.chiefComplaint }))] })] }), record.vitals && (_jsxs("div", { className: "flex flex-wrap gap-4 mb-3 pl-15", children: [record.vitals.systolic && record.vitals.diastolic && (_jsxs("div", { className: "text-sm", children: [_jsx("span", { className: "text-gray-600", children: "BP:" }), ' ', _jsxs("span", { className: "font-medium text-gray-900", children: [record.vitals.systolic, "/", record.vitals.diastolic] })] })), record.vitals.pulseBpm && (_jsxs("div", { className: "text-sm", children: [_jsx("span", { className: "text-gray-600", children: "HR:" }), ' ', _jsxs("span", { className: "font-medium text-gray-900", children: [record.vitals.pulseBpm, " bpm"] })] })), record.vitals.tempC && (_jsxs("div", { className: "text-sm", children: [_jsx("span", { className: "text-gray-600", children: "Temp:" }), ' ', _jsxs("span", { className: "font-medium text-gray-900", children: [record.vitals.tempC, "\u00B0C"] })] }))] })), record.consultation && (_jsxs("div", { className: "pl-15", children: [record.consultation.diagnoses.length > 0 && (_jsxs("div", { className: "mb-2", children: [_jsx("span", { className: "text-sm text-gray-600", children: "Diagnosis: " }), _jsx("span", { className: "text-sm font-medium text-gray-900", children: record.consultation.diagnoses.join(', ') })] })), record.consultation.providerName && (_jsxs("div", { className: "text-sm text-gray-600", children: ["Provider: ", record.consultation.providerName] }))] })), record.prescriptions && record.prescriptions.length > 0 && (_jsxs("div", { className: "mt-3 pl-15", children: [_jsx("p", { className: "text-sm text-gray-600 mb-1", children: "Medications prescribed:" }), _jsx("div", { className: "flex flex-wrap gap-2", children: record.prescriptions.map((rx, idx) => (_jsx("span", { className: "inline-flex items-center px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium", children: rx.medicationName }, idx))) })] }))] }), _jsx(ChevronRightIcon, { className: "w-5 h-5 text-gray-400 flex-shrink-0 ml-4" })] }) }, record.visitId))) })), hasMore && records.length > 0 && (_jsx("div", { className: "mt-6 text-center", children: _jsx("button", { onClick: () => setPage(p => p + 1), disabled: loading, className: "px-6 py-3 bg-white border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors disabled:bg-gray-100 disabled:cursor-not-allowed", children: loading ? 'Loading...' : 'Load More' }) }))] }));
}
