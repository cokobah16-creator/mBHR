import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { bulkEnrollPatients } from '@/services/unifiedPortalEnrollment';
import { UserPlusIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
export function BulkPortalMigration() {
    const [patients, setPatients] = useState([]);
    const [selectedPatients, setSelectedPatients] = useState(new Set());
    const [loading, setLoading] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [results, setResults] = useState(null);
    useEffect(() => {
        loadEligiblePatients();
    }, []);
    const loadEligiblePatients = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('patients')
                .select('id, given_name, family_name, dob, email, phone, portal_enabled')
                .or('email.not.is.null,phone.not.is.null')
                .eq('portal_enabled', false)
                .order('created_at', { ascending: false })
                .limit(100);
            if (error)
                throw error;
            setPatients(data || []);
        }
        catch (error) {
            console.error('Error loading patients:', error);
            alert('Failed to load patients');
        }
        finally {
            setLoading(false);
        }
    };
    const togglePatient = (patientId) => {
        const newSelected = new Set(selectedPatients);
        if (newSelected.has(patientId)) {
            newSelected.delete(patientId);
        }
        else {
            newSelected.add(patientId);
        }
        setSelectedPatients(newSelected);
    };
    const selectAll = () => {
        setSelectedPatients(new Set(patients.map(p => p.id)));
    };
    const deselectAll = () => {
        setSelectedPatients(new Set());
    };
    const handleBulkEnroll = async () => {
        if (selectedPatients.size === 0) {
            alert('Please select at least one patient');
            return;
        }
        if (!confirm(`Enroll ${selectedPatients.size} patients in the portal?`)) {
            return;
        }
        setProcessing(true);
        try {
            const result = await bulkEnrollPatients(Array.from(selectedPatients));
            setResults(result);
            if (result.success > 0) {
                alert(`Successfully enrolled ${result.success} patients!`);
                loadEligiblePatients();
                setSelectedPatients(new Set());
            }
            if (result.failed > 0) {
                console.error('Enrollment errors:', result.errors);
            }
        }
        catch (error) {
            console.error('Bulk enrollment error:', error);
            alert('Bulk enrollment failed');
        }
        finally {
            setProcessing(false);
        }
    };
    return (_jsxs("div", { className: "max-w-7xl mx-auto px-4 py-8", children: [_jsxs("div", { className: "mb-8", children: [_jsx("h1", { className: "text-3xl font-bold text-gray-900 mb-2", children: "Bulk Portal Migration" }), _jsx("p", { className: "text-gray-600", children: "Enroll existing patients in the patient portal. Patients must have email or phone number." })] }), results && (_jsxs("div", { className: "mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4", children: [_jsx("h3", { className: "font-semibold text-blue-900 mb-2", children: "Enrollment Results" }), _jsxs("div", { className: "space-y-1 text-sm", children: [_jsxs("div", { className: "flex items-center gap-2 text-green-700", children: [_jsx(CheckCircleIcon, { className: "w-5 h-5" }), _jsxs("span", { children: [results.success, " patients successfully enrolled"] })] }), results.failed > 0 && (_jsxs("div", { className: "flex items-center gap-2 text-red-700", children: [_jsx(XCircleIcon, { className: "w-5 h-5" }), _jsxs("span", { children: [results.failed, " patients failed"] })] }))] }), results.errors.length > 0 && (_jsxs("details", { className: "mt-3", children: [_jsx("summary", { className: "cursor-pointer text-sm font-medium text-blue-900", children: "View errors" }), _jsx("ul", { className: "mt-2 space-y-1 text-xs", children: results.errors.map((err, idx) => (_jsxs("li", { className: "text-red-700", children: [err.patientId, ": ", err.error] }, idx))) })] }))] })), _jsxs("div", { className: "bg-white rounded-lg shadow", children: [_jsxs("div", { className: "p-4 border-b border-gray-200 flex items-center justify-between", children: [_jsx("div", { children: _jsxs("p", { className: "text-sm text-gray-600", children: [selectedPatients.size, " of ", patients.length, " patients selected"] }) }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { onClick: selectAll, className: "px-3 py-1 text-sm text-blue-600 hover:text-blue-700 font-medium", disabled: loading || processing, children: "Select All" }), _jsx("button", { onClick: deselectAll, className: "px-3 py-1 text-sm text-gray-600 hover:text-gray-700 font-medium", disabled: loading || processing, children: "Deselect All" }), _jsxs("button", { onClick: handleBulkEnroll, disabled: selectedPatients.size === 0 || processing, className: "flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed", children: [_jsx(UserPlusIcon, { className: "w-5 h-5" }), processing ? 'Enrolling...' : `Enroll ${selectedPatients.size} Patients`] })] })] }), loading ? (_jsxs("div", { className: "p-8 text-center", children: [_jsx("div", { className: "inline-block w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" }), _jsx("p", { className: "mt-4 text-gray-600", children: "Loading eligible patients..." })] })) : patients.length === 0 ? (_jsx("div", { className: "p-8 text-center text-gray-500", children: "No eligible patients found. All patients with contact information are already enrolled." })) : (_jsx("div", { className: "divide-y divide-gray-200", children: patients.map((patient) => (_jsx("div", { className: "p-4 hover:bg-gray-50 cursor-pointer", onClick: () => togglePatient(patient.id), children: _jsxs("div", { className: "flex items-center gap-4", children: [_jsx("input", { type: "checkbox", checked: selectedPatients.has(patient.id), onChange: () => togglePatient(patient.id), className: "w-5 h-5 text-green-600 rounded focus:ring-green-500" }), _jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "font-medium text-gray-900", children: [patient.given_name, " ", patient.family_name] }), _jsxs("div", { className: "text-sm text-gray-600", children: ["DOB: ", patient.dob] }), _jsxs("div", { className: "text-sm text-gray-500 mt-1", children: [patient.email && _jsxs("span", { className: "mr-4", children: ["\uD83D\uDCE7 ", patient.email] }), patient.phone && _jsxs("span", { children: ["\uD83D\uDCF1 ", patient.phone] })] })] })] }) }, patient.id))) }))] }), _jsxs("div", { className: "mt-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4", children: [_jsx("h3", { className: "font-semibold text-yellow-900 mb-2", children: "How it works" }), _jsxs("ul", { className: "text-sm text-yellow-800 space-y-1 list-disc list-inside", children: [_jsx("li", { children: "Select patients who should have portal access" }), _jsx("li", { children: "Portal accounts will be created automatically" }), _jsx("li", { children: "Patients can login using their email/phone and OTP verification" }), _jsx("li", { children: "Only patients with email or phone number can be enrolled" }), _jsx("li", { children: "Duplicate email/phone numbers will be skipped" })] })] })] }));
}
