import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import * as logger from '@/lib/logger';
import { formatNigerianDate } from '@/utils/dateFormat';
import { BeakerIcon, CheckCircleIcon, ClockIcon } from '@heroicons/react/24/outline';
export function LabResults() {
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedResult, setSelectedResult] = useState(null);
    useEffect(() => {
        loadLabResults();
    }, []);
    const loadLabResults = async () => {
        setLoading(true);
        setError('');
        try {
            const portalUserStr = localStorage.getItem('patient_portal_user');
            if (!portalUserStr) {
                window.location.href = '/patient/login';
                return;
            }
            const portalUser = JSON.parse(portalUserStr);
            const { data, error: resultsError } = await supabase
                .from('patient_lab_results')
                .select('*')
                .eq('patient_id', portalUser.patientId)
                .order('ordered_date', { ascending: false });
            if (resultsError)
                throw resultsError;
            setResults(data || []);
        }
        catch (err) {
            logger.error('Error loading lab results:', err);
            setError('Failed to load lab results');
        }
        finally {
            setLoading(false);
        }
    };
    if (loading) {
        return (_jsx("div", { className: "min-h-screen bg-gray-50 px-4 py-8", children: _jsx("div", { className: "max-w-4xl mx-auto", children: _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" }), _jsx("p", { className: "mt-4 text-gray-600", children: "Loading lab results..." })] }) }) }));
    }
    return (_jsx("div", { className: "min-h-screen bg-gray-50 px-4 py-8", children: _jsxs("div", { className: "max-w-4xl mx-auto", children: [_jsxs("div", { className: "mb-6", children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Lab Results" }), _jsx("p", { className: "mt-2 text-gray-600", children: "View your test results and lab reports" })] }), error && (_jsx("div", { className: "mb-4 p-4 bg-red-50 border border-red-200 rounded-lg", children: _jsx("p", { className: "text-sm text-red-800", children: error }) })), selectedResult ? (_jsxs("div", { className: "bg-white rounded-lg shadow-sm border border-gray-200 p-6", children: [_jsx("button", { onClick: () => setSelectedResult(null), className: "mb-4 text-blue-600 hover:text-blue-800", children: "\u2190 Back to all results" }), _jsxs("div", { className: "space-y-6", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-xl font-semibold text-gray-900", children: selectedResult.test_name }), _jsx("p", { className: "text-gray-600", children: selectedResult.test_type })] }), _jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm text-gray-600", children: "Status" }), _jsx("p", { className: "font-medium capitalize", children: selectedResult.status })] }), _jsxs("div", { children: [_jsx("p", { className: "text-sm text-gray-600", children: "Ordered Date" }), _jsx("p", { className: "font-medium", children: formatNigerianDate(selectedResult.ordered_date) })] }), selectedResult.result_date && (_jsxs("div", { children: [_jsx("p", { className: "text-sm text-gray-600", children: "Result Date" }), _jsx("p", { className: "font-medium", children: formatNigerianDate(selectedResult.result_date) })] }))] }), selectedResult.status === 'completed' && (_jsx("div", { className: `p-4 rounded-lg ${selectedResult.abnormal ? 'bg-yellow-50 border border-yellow-200' : 'bg-green-50 border border-green-200'}`, children: _jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm text-gray-600", children: "Result" }), _jsxs("p", { className: "text-2xl font-bold text-gray-900", children: [selectedResult.result_value, " ", selectedResult.unit] }), _jsxs("p", { className: "text-sm text-gray-600 mt-1", children: ["Reference Range: ", selectedResult.reference_range] })] }), selectedResult.abnormal && (_jsx("span", { className: "px-2 py-1 bg-yellow-200 text-yellow-800 text-xs font-medium rounded", children: "Abnormal" }))] }) })), selectedResult.notes && (_jsxs("div", { children: [_jsx("p", { className: "text-sm text-gray-600 mb-2", children: "Notes" }), _jsx("p", { className: "text-gray-900", children: selectedResult.notes })] })), selectedResult.abnormal && (_jsx("div", { className: "p-4 bg-blue-50 border border-blue-200 rounded-lg", children: _jsxs("p", { className: "text-sm text-blue-800", children: [_jsx("strong", { children: "Important:" }), " This result is outside the normal range. Please contact your healthcare provider to discuss these results."] }) }))] })] })) : (_jsx("div", { className: "bg-white rounded-lg shadow-sm border border-gray-200", children: results.length === 0 ? (_jsxs("div", { className: "p-12 text-center", children: [_jsx(BeakerIcon, { className: "h-16 w-16 text-gray-400 mx-auto mb-4" }), _jsx("h3", { className: "text-lg font-medium text-gray-900 mb-2", children: "No lab results" }), _jsx("p", { className: "text-gray-600", children: "Your lab results will appear here once available" })] })) : (_jsx("div", { className: "divide-y divide-gray-200", children: results.map((result) => (_jsx("button", { onClick: () => setSelectedResult(result), className: "w-full p-4 text-left hover:bg-gray-50 transition-colors", children: _jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { className: "flex-1", children: [_jsx("h3", { className: "font-medium text-gray-900", children: result.test_name }), _jsx("p", { className: "text-sm text-gray-600 mt-1", children: result.test_type }), _jsxs("div", { className: "flex items-center gap-4 mt-2", children: [_jsxs("span", { className: "inline-flex items-center gap-1 text-sm text-gray-600", children: [result.status === 'completed' ? (_jsx(CheckCircleIcon, { className: "h-4 w-4 text-green-600" })) : (_jsx(ClockIcon, { className: "h-4 w-4 text-yellow-600" })), result.status] }), result.abnormal && (_jsx("span", { className: "px-2 py-0.5 bg-yellow-200 text-yellow-800 text-xs font-medium rounded", children: "Abnormal" }))] })] }), _jsx("span", { className: "text-xs text-gray-500 ml-4 whitespace-nowrap", children: formatNigerianDate(result.ordered_date) })] }) }, result.id))) })) }))] }) }));
}
