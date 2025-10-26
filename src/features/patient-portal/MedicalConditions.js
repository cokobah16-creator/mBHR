import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import * as logger from '@/lib/logger';
import { formatNigerianDate } from '@/utils/dateFormat';
import { PlusIcon, HeartIcon } from '@heroicons/react/24/outline';
export function MedicalConditions() {
    const [conditions, setConditions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [showAdd, setShowAdd] = useState(false);
    const [newCondition, setNewCondition] = useState({
        condition_name: '',
        diagnosed_date: '',
        status: 'active',
        notes: ''
    });
    useEffect(() => {
        loadConditions();
    }, []);
    const loadConditions = async () => {
        setLoading(true);
        setError('');
        try {
            const portalUserStr = localStorage.getItem('patient_portal_user');
            if (!portalUserStr) {
                window.location.href = '/patient/login';
                return;
            }
            const portalUser = JSON.parse(portalUserStr);
            const { data, error: conditionsError } = await supabase
                .from('patient_medical_conditions')
                .select('*')
                .eq('patient_id', portalUser.patientId)
                .order('created_at', { ascending: false });
            if (conditionsError)
                throw conditionsError;
            setConditions(data || []);
        }
        catch (err) {
            logger.error('Error loading conditions:', err);
            setError('Failed to load medical conditions');
        }
        finally {
            setLoading(false);
        }
    };
    const addCondition = async () => {
        if (!newCondition.condition_name.trim()) {
            setError('Condition name is required');
            return;
        }
        setSaving(true);
        setError('');
        setSuccess('');
        try {
            const portalUserStr = localStorage.getItem('patient_portal_user');
            if (!portalUserStr) {
                window.location.href = '/patient/login';
                return;
            }
            const portalUser = JSON.parse(portalUserStr);
            const { error: insertError } = await supabase
                .from('patient_medical_conditions')
                .insert({
                patient_id: portalUser.patientId,
                condition_name: newCondition.condition_name,
                diagnosed_date: newCondition.diagnosed_date || null,
                status: newCondition.status,
                notes: newCondition.notes || null
            });
            if (insertError)
                throw insertError;
            setSuccess('Medical condition added successfully');
            setNewCondition({
                condition_name: '',
                diagnosed_date: '',
                status: 'active',
                notes: ''
            });
            setShowAdd(false);
            await loadConditions();
        }
        catch (err) {
            logger.error('Error adding condition:', err);
            setError('Failed to add medical condition');
        }
        finally {
            setSaving(false);
        }
    };
    if (loading) {
        return (_jsx("div", { className: "min-h-screen bg-gray-50 px-4 py-8", children: _jsx("div", { className: "max-w-4xl mx-auto", children: _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" }), _jsx("p", { className: "mt-4 text-gray-600", children: "Loading medical conditions..." })] }) }) }));
    }
    return (_jsx("div", { className: "min-h-screen bg-gray-50 px-4 py-8", children: _jsxs("div", { className: "max-w-4xl mx-auto", children: [_jsxs("div", { className: "mb-6 flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Medical Conditions" }), _jsx("p", { className: "mt-2 text-gray-600", children: "Manage your health conditions and history" })] }), _jsxs("button", { onClick: () => setShowAdd(true), className: "inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700", children: [_jsx(PlusIcon, { className: "h-5 w-5" }), "Add Condition"] })] }), error && (_jsx("div", { className: "mb-4 p-4 bg-red-50 border border-red-200 rounded-lg", children: _jsx("p", { className: "text-sm text-red-800", children: error }) })), success && (_jsx("div", { className: "mb-4 p-4 bg-green-50 border border-green-200 rounded-lg", children: _jsx("p", { className: "text-sm text-green-800", children: success }) })), showAdd && (_jsxs("div", { className: "mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6", children: [_jsx("h2", { className: "text-lg font-semibold mb-4", children: "Add New Condition" }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Condition Name *" }), _jsx("input", { type: "text", value: newCondition.condition_name, onChange: (e) => setNewCondition({ ...newCondition, condition_name: e.target.value }), placeholder: "e.g., Hypertension, Diabetes", className: "w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Diagnosed Date" }), _jsx("input", { type: "date", value: newCondition.diagnosed_date, onChange: (e) => setNewCondition({ ...newCondition, diagnosed_date: e.target.value }), className: "w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Status" }), _jsxs("select", { value: newCondition.status, onChange: (e) => setNewCondition({
                                                ...newCondition,
                                                status: e.target.value
                                            }), className: "w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent", children: [_jsx("option", { value: "active", children: "Active" }), _jsx("option", { value: "managed", children: "Managed" }), _jsx("option", { value: "resolved", children: "Resolved" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Notes" }), _jsx("textarea", { value: newCondition.notes, onChange: (e) => setNewCondition({ ...newCondition, notes: e.target.value }), placeholder: "Additional information about this condition", rows: 3, className: "w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent" })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { onClick: addCondition, disabled: saving, className: "px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50", children: saving ? 'Adding...' : 'Add Condition' }), _jsx("button", { onClick: () => setShowAdd(false), disabled: saving, className: "px-4 py-2 bg-gray-500 text-white rounded-md hover:bg-gray-600 disabled:opacity-50", children: "Cancel" })] })] })] })), _jsx("div", { className: "bg-white rounded-lg shadow-sm border border-gray-200", children: conditions.length === 0 ? (_jsxs("div", { className: "p-12 text-center", children: [_jsx(HeartIcon, { className: "h-16 w-16 text-gray-400 mx-auto mb-4" }), _jsx("h3", { className: "text-lg font-medium text-gray-900 mb-2", children: "No conditions recorded" }), _jsx("p", { className: "text-gray-600", children: "Add your medical conditions to keep your record updated" })] })) : (_jsx("div", { className: "divide-y divide-gray-200", children: conditions.map((condition) => (_jsx("div", { className: "p-4", children: _jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { className: "flex-1", children: [_jsx("h3", { className: "font-medium text-gray-900", children: condition.condition_name }), condition.diagnosed_date && (_jsxs("p", { className: "text-sm text-gray-600 mt-1", children: ["Diagnosed: ", formatNigerianDate(condition.diagnosed_date)] })), condition.notes && (_jsx("p", { className: "text-sm text-gray-600 mt-1", children: condition.notes }))] }), _jsx("span", { className: `px-2 py-1 text-xs font-medium rounded ${condition.status === 'active'
                                            ? 'bg-red-100 text-red-800'
                                            : condition.status === 'managed'
                                                ? 'bg-yellow-100 text-yellow-800'
                                                : 'bg-green-100 text-green-800'}`, children: condition.status })] }) }, condition.id))) })) }), _jsx("div", { className: "mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200", children: _jsxs("p", { className: "text-sm text-blue-800", children: [_jsx("strong", { children: "Note:" }), " This information will be reviewed by your healthcare provider and may be used to update your official medical record."] }) })] }) }));
}
