import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { doctorService } from '@/services/doctorService';
import { useAuthStore } from '@/stores/auth';
import { UserGroupIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
export function ReferralForm({ org_id, site_id, event_id, patient_id, visit_id, onSuccess, onCancel }) {
    const { currentUser } = useAuthStore();
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [formData, setFormData] = useState({
        org_id,
        site_id,
        event_id,
        patient_id,
        visit_id,
        referral_type: 'specialist',
        urgency: 'routine',
        reason: '',
        clinical_summary: '',
        diagnosis: '',
        facility_name: '',
        specialty: ''
    });
    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        if (!currentUser) {
            setError('User not authenticated');
            return;
        }
        if (!formData.reason || !formData.clinical_summary) {
            setError('Please provide reason and clinical summary');
            return;
        }
        setSubmitting(true);
        try {
            const referral = await doctorService.createReferral({
                ...formData,
                referring_doctor_id: currentUser.id,
                status: 'pending'
            });
            if (referral) {
                onSuccess?.();
            }
            else {
                setError('Failed to create referral');
            }
        }
        catch (err) {
            console.error('Error creating referral:', err);
            setError('An error occurred while creating the referral');
        }
        finally {
            setSubmitting(false);
        }
    };
    return (_jsxs("div", { className: "bg-white rounded-lg shadow-sm p-6", children: [_jsxs("div", { className: "flex items-center space-x-3 mb-6", children: [_jsx(UserGroupIcon, { className: "h-6 w-6 text-blue-600" }), _jsx("h2", { className: "text-xl font-semibold text-gray-900", children: "Create Referral" })] }), error && (_jsxs("div", { className: "mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-2", children: [_jsx(ExclamationTriangleIcon, { className: "h-5 w-5 text-red-600 mt-0.5" }), _jsx("p", { className: "text-sm text-red-800", children: error })] })), _jsxs("form", { onSubmit: handleSubmit, className: "space-y-4", children: [_jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsxs("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: ["Referral Type ", _jsx("span", { className: "text-red-500", children: "*" })] }), _jsxs("select", { value: formData.referral_type, onChange: (e) => setFormData({ ...formData, referral_type: e.target.value }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500", required: true, children: [_jsx("option", { value: "specialist", children: "Specialist" }), _jsx("option", { value: "hospital", children: "Hospital" }), _jsx("option", { value: "lab", children: "Laboratory" }), _jsx("option", { value: "imaging", children: "Imaging" }), _jsx("option", { value: "follow_up", children: "Follow-up" })] })] }), _jsxs("div", { children: [_jsxs("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: ["Urgency ", _jsx("span", { className: "text-red-500", children: "*" })] }), _jsxs("select", { value: formData.urgency, onChange: (e) => setFormData({ ...formData, urgency: e.target.value }), className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500", required: true, children: [_jsx("option", { value: "routine", children: "Routine" }), _jsx("option", { value: "urgent", children: "Urgent" }), _jsx("option", { value: "emergency", children: "Emergency" })] })] })] }), formData.referral_type === 'specialist' && (_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Specialty" }), _jsx("input", { type: "text", value: formData.specialty || '', onChange: (e) => setFormData({ ...formData, specialty: e.target.value }), placeholder: "e.g., Cardiology, Orthopedics", className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" })] })), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Facility Name" }), _jsx("input", { type: "text", value: formData.facility_name || '', onChange: (e) => setFormData({ ...formData, facility_name: e.target.value }), placeholder: "Name of hospital, clinic, or facility", className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" })] }), _jsxs("div", { children: [_jsxs("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: ["Reason for Referral ", _jsx("span", { className: "text-red-500", children: "*" })] }), _jsx("textarea", { value: formData.reason || '', onChange: (e) => setFormData({ ...formData, reason: e.target.value }), placeholder: "Brief reason for referring this patient", className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500", rows: 2, required: true })] }), _jsxs("div", { children: [_jsxs("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: ["Clinical Summary ", _jsx("span", { className: "text-red-500", children: "*" })] }), _jsx("textarea", { value: formData.clinical_summary || '', onChange: (e) => setFormData({ ...formData, clinical_summary: e.target.value }), placeholder: "Relevant patient history, symptoms, findings", className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500", rows: 4, required: true })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Working Diagnosis" }), _jsx("input", { type: "text", value: formData.diagnosis || '', onChange: (e) => setFormData({ ...formData, diagnosis: e.target.value }), placeholder: "Provisional or confirmed diagnosis", className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Additional Notes" }), _jsx("textarea", { value: formData.notes || '', onChange: (e) => setFormData({ ...formData, notes: e.target.value }), placeholder: "Any additional information for the receiving facility", className: "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500", rows: 2 })] }), _jsxs("div", { className: "flex justify-end space-x-3 pt-4", children: [onCancel && (_jsx("button", { type: "button", onClick: onCancel, className: "btn-secondary", disabled: submitting, children: "Cancel" })), _jsx("button", { type: "submit", className: "btn-primary", disabled: submitting, children: submitting ? 'Creating Referral...' : 'Create Referral' })] })] })] }));
}
