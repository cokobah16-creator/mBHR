import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import * as logger from '@/lib/logger';
import { PencilIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
export function UpdatePHR() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [editingField, setEditingField] = useState(null);
    const [fields, setFields] = useState([]);
    const [editValues, setEditValues] = useState({});
    useEffect(() => {
        loadPHR();
    }, []);
    const loadPHR = async () => {
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
                window.location.href = '/patient/login';
                return;
            }
            const { data: patient, error: patientError } = await supabase
                .from('patients')
                .select('*')
                .eq('id', portalUser.patientId)
                .maybeSingle();
            if (patientError)
                throw patientError;
            if (!patient) {
                setError('Patient record not found');
                return;
            }
            const phrFields = [
                { label: 'Full Name', key: 'name', value: patient.name || '', editable: true, type: 'text' },
                { label: 'Date of Birth', key: 'dob', value: patient.dob || '', editable: false, type: 'date' },
                { label: 'Phone Number', key: 'phone', value: patient.phone || '', editable: true, type: 'text' },
                { label: 'Email', key: 'email', value: patient.email || '', editable: true, type: 'text' },
                { label: 'Address', key: 'address', value: patient.address || '', editable: true, type: 'textarea' },
                { label: 'Emergency Contact', key: 'emergency_contact', value: patient.emergency_contact || '', editable: true, type: 'text' },
                { label: 'Blood Type', key: 'blood_type', value: patient.blood_type || '', editable: true, type: 'text' },
                { label: 'Medical Notes', key: 'notes', value: patient.notes || '', editable: true, type: 'textarea' }
            ];
            setFields(phrFields);
        }
        catch (err) {
            logger.error('Error loading PHR:', err);
            setError('Failed to load health record');
        }
        finally {
            setLoading(false);
        }
    };
    const startEdit = (key, currentValue) => {
        setEditingField(key);
        setEditValues({ ...editValues, [key]: currentValue });
        setSuccess('');
        setError('');
    };
    const cancelEdit = () => {
        setEditingField(null);
        setEditValues({});
    };
    const saveField = async (key) => {
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
            const { error: updateError } = await supabase
                .from('patients')
                .update({ [key]: editValues[key] })
                .eq('id', portalUser.patientId);
            if (updateError)
                throw updateError;
            setSuccess('Updated successfully');
            setEditingField(null);
            await loadPHR();
        }
        catch (err) {
            logger.error('Error updating PHR:', err);
            setError('Failed to update field');
        }
        finally {
            setSaving(false);
        }
    };
    if (loading) {
        return (_jsx("div", { className: "min-h-screen bg-gray-50 px-4 py-8", children: _jsx("div", { className: "max-w-3xl mx-auto", children: _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" }), _jsx("p", { className: "mt-4 text-gray-600", children: "Loading health record..." })] }) }) }));
    }
    return (_jsx("div", { className: "min-h-screen bg-gray-50 px-4 py-8", children: _jsxs("div", { className: "max-w-3xl mx-auto", children: [_jsxs("div", { className: "mb-6", children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Update Personal Health Record" }), _jsx("p", { className: "mt-2 text-gray-600", children: "Keep your health information up to date. Changes are saved immediately." })] }), error && (_jsx("div", { className: "mb-4 p-4 bg-red-50 border border-red-200 rounded-lg", children: _jsx("p", { className: "text-sm text-red-800", children: error }) })), success && (_jsx("div", { className: "mb-4 p-4 bg-green-50 border border-green-200 rounded-lg", children: _jsx("p", { className: "text-sm text-green-800", children: success }) })), _jsx("div", { className: "bg-white rounded-lg shadow-sm border border-gray-200", children: fields.map((field, index) => (_jsx("div", { className: `p-4 ${index !== fields.length - 1 ? 'border-b border-gray-200' : ''}`, children: _jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { className: "flex-1", children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: field.label }), editingField === field.key ? (_jsxs("div", { className: "space-y-2", children: [field.type === 'textarea' ? (_jsx("textarea", { value: editValues[field.key] || '', onChange: (e) => setEditValues({ ...editValues, [field.key]: e.target.value }), rows: 3, className: "w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent" })) : (_jsx("input", { type: field.type, value: editValues[field.key] || '', onChange: (e) => setEditValues({ ...editValues, [field.key]: e.target.value }), className: "w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent" })), _jsxs("div", { className: "flex gap-2", children: [_jsxs("button", { onClick: () => saveField(field.key), disabled: saving, className: "inline-flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 text-sm", children: [_jsx(CheckIcon, { className: "h-4 w-4" }), "Save"] }), _jsxs("button", { onClick: cancelEdit, disabled: saving, className: "inline-flex items-center gap-1 px-3 py-1.5 bg-gray-500 text-white rounded-md hover:bg-gray-600 disabled:opacity-50 text-sm", children: [_jsx(XMarkIcon, { className: "h-4 w-4" }), "Cancel"] })] })] })) : (_jsx("p", { className: "text-gray-900", children: field.value || 'Not provided' }))] }), field.editable && editingField !== field.key && (_jsx("button", { onClick: () => startEdit(field.key, field.value), className: "ml-4 p-2 text-blue-600 hover:bg-blue-50 rounded-md", children: _jsx(PencilIcon, { className: "h-5 w-5" }) }))] }) }, field.key))) }), _jsx("div", { className: "mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200", children: _jsxs("p", { className: "text-sm text-blue-800", children: [_jsx("strong", { children: "Note:" }), " Some fields like Date of Birth cannot be changed here. Please contact clinic staff if you need to update protected information."] }) })] }) }));
}
