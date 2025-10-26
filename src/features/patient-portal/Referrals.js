import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import * as logger from '@/lib/logger';
import { formatNigerianDate } from '@/utils/dateFormat';
import { UserGroupIcon, ClockIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
export function Referrals() {
    const [referrals, setReferrals] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedReferral, setSelectedReferral] = useState(null);
    useEffect(() => {
        loadReferrals();
    }, []);
    const loadReferrals = async () => {
        setLoading(true);
        setError('');
        try {
            const portalUserStr = localStorage.getItem('patient_portal_user');
            if (!portalUserStr) {
                window.location.href = '/patient/login';
                return;
            }
            const portalUser = JSON.parse(portalUserStr);
            const { data, error: referralsError } = await supabase
                .from('patient_referrals')
                .select('*')
                .eq('patient_id', portalUser.patientId)
                .order('referral_date', { ascending: false });
            if (referralsError)
                throw referralsError;
            setReferrals(data || []);
        }
        catch (err) {
            logger.error('Error loading referrals:', err);
            setError('Failed to load referrals');
        }
        finally {
            setLoading(false);
        }
    };
    const getStatusIcon = (status) => {
        switch (status) {
            case 'completed':
                return _jsx(CheckCircleIcon, { className: "h-5 w-5 text-green-600" });
            case 'cancelled':
                return _jsx(XCircleIcon, { className: "h-5 w-5 text-red-600" });
            case 'scheduled':
                return _jsx(CheckCircleIcon, { className: "h-5 w-5 text-blue-600" });
            default:
                return _jsx(ClockIcon, { className: "h-5 w-5 text-yellow-600" });
        }
    };
    const getPriorityColor = (priority) => {
        switch (priority) {
            case 'emergency':
                return 'bg-red-100 text-red-800';
            case 'urgent':
                return 'bg-orange-100 text-orange-800';
            default:
                return 'bg-blue-100 text-blue-800';
        }
    };
    if (loading) {
        return (_jsx("div", { className: "min-h-screen bg-gray-50 px-4 py-8", children: _jsx("div", { className: "max-w-4xl mx-auto", children: _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" }), _jsx("p", { className: "mt-4 text-gray-600", children: "Loading referrals..." })] }) }) }));
    }
    return (_jsx("div", { className: "min-h-screen bg-gray-50 px-4 py-8", children: _jsxs("div", { className: "max-w-4xl mx-auto", children: [_jsxs("div", { className: "mb-6", children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Referrals" }), _jsx("p", { className: "mt-2 text-gray-600", children: "View your specialist referrals and appointments" })] }), error && (_jsx("div", { className: "mb-4 p-4 bg-red-50 border border-red-200 rounded-lg", children: _jsx("p", { className: "text-sm text-red-800", children: error }) })), selectedReferral ? (_jsxs("div", { className: "bg-white rounded-lg shadow-sm border border-gray-200 p-6", children: [_jsx("button", { onClick: () => setSelectedReferral(null), className: "mb-4 text-blue-600 hover:text-blue-800", children: "\u2190 Back to all referrals" }), _jsxs("div", { className: "space-y-6", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-xl font-semibold text-gray-900", children: selectedReferral.specialty }), selectedReferral.specialist_name && (_jsxs("p", { className: "text-gray-600 mt-1", children: ["Dr. ", selectedReferral.specialist_name] }))] }), _jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm text-gray-600", children: "Referring Provider" }), _jsx("p", { className: "font-medium", children: selectedReferral.referring_provider })] }), _jsxs("div", { children: [_jsx("p", { className: "text-sm text-gray-600", children: "Priority" }), _jsx("span", { className: `inline-block px-2 py-1 text-xs font-medium rounded capitalize ${getPriorityColor(selectedReferral.priority)}`, children: selectedReferral.priority })] }), _jsxs("div", { children: [_jsx("p", { className: "text-sm text-gray-600", children: "Referral Date" }), _jsx("p", { className: "font-medium", children: formatNigerianDate(selectedReferral.referral_date) })] }), selectedReferral.appointment_date && (_jsxs("div", { children: [_jsx("p", { className: "text-sm text-gray-600", children: "Appointment Date" }), _jsx("p", { className: "font-medium", children: formatNigerianDate(selectedReferral.appointment_date) })] })), _jsxs("div", { children: [_jsx("p", { className: "text-sm text-gray-600", children: "Status" }), _jsxs("div", { className: "flex items-center gap-2 mt-1", children: [getStatusIcon(selectedReferral.status), _jsx("span", { className: "capitalize", children: selectedReferral.status })] })] })] }), _jsxs("div", { children: [_jsx("p", { className: "text-sm text-gray-600 mb-2", children: "Reason for Referral" }), _jsx("p", { className: "text-gray-900", children: selectedReferral.reason })] }), selectedReferral.notes && (_jsxs("div", { children: [_jsx("p", { className: "text-sm text-gray-600 mb-2", children: "Additional Notes" }), _jsx("p", { className: "text-gray-900", children: selectedReferral.notes })] })), selectedReferral.status === 'pending' && (_jsx("div", { className: "p-4 bg-yellow-50 border border-yellow-200 rounded-lg", children: _jsxs("p", { className: "text-sm text-yellow-800", children: [_jsx("strong", { children: "Action Required:" }), " Please contact the specialist's office to schedule your appointment."] }) })), selectedReferral.priority === 'emergency' && (_jsx("div", { className: "p-4 bg-red-50 border border-red-200 rounded-lg", children: _jsxs("p", { className: "text-sm text-red-800", children: [_jsx("strong", { children: "URGENT:" }), " This is an emergency referral. Please seek immediate attention."] }) }))] })] })) : (_jsx("div", { className: "bg-white rounded-lg shadow-sm border border-gray-200", children: referrals.length === 0 ? (_jsxs("div", { className: "p-12 text-center", children: [_jsx(UserGroupIcon, { className: "h-16 w-16 text-gray-400 mx-auto mb-4" }), _jsx("h3", { className: "text-lg font-medium text-gray-900 mb-2", children: "No referrals" }), _jsx("p", { className: "text-gray-600", children: "Your specialist referrals will appear here" })] })) : (_jsx("div", { className: "divide-y divide-gray-200", children: referrals.map((referral) => (_jsx("button", { onClick: () => setSelectedReferral(referral), className: "w-full p-4 text-left hover:bg-gray-50 transition-colors", children: _jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("h3", { className: "font-medium text-gray-900", children: referral.specialty }), _jsx("span", { className: `px-2 py-0.5 text-xs font-medium rounded capitalize ${getPriorityColor(referral.priority)}`, children: referral.priority })] }), referral.specialist_name && (_jsxs("p", { className: "text-sm text-gray-600 mt-1", children: ["Dr. ", referral.specialist_name] })), _jsxs("p", { className: "text-sm text-gray-600 mt-1", children: ["Referred by: ", referral.referring_provider] }), _jsxs("div", { className: "flex items-center gap-2 mt-2", children: [getStatusIcon(referral.status), _jsx("span", { className: "text-sm text-gray-600 capitalize", children: referral.status })] })] }), _jsxs("div", { className: "text-right ml-4", children: [_jsx("span", { className: "text-xs text-gray-500 whitespace-nowrap", children: formatNigerianDate(referral.referral_date) }), referral.appointment_date && (_jsxs("p", { className: "text-xs text-blue-600 mt-1", children: ["Appt: ", formatNigerianDate(referral.appointment_date)] }))] })] }) }, referral.id))) })) })), _jsx("div", { className: "mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200", children: _jsxs("p", { className: "text-sm text-blue-800", children: [_jsx("strong", { children: "Need help?" }), " Contact your healthcare provider if you have questions about a referral or need assistance scheduling an appointment."] }) })] }) }));
}
