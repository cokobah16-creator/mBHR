import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { formatNigerianDate } from '@/utils/dateFormat';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { db, generateId, createAuditLog } from '@/db';
import { useAuthStore } from '@/stores/auth';
import { DocumentTextIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
const soapSchema = z.object({
    soapSubjective: z.string().min(1, 'Subjective findings required'),
    soapObjective: z.string().min(1, 'Objective findings required'),
    soapAssessment: z.string().min(1, 'Assessment required'),
    soapPlan: z.string().min(1, 'Plan required')
});
export function SoapForm({ patientId, visitId, onSuccess, onCancel }) {
    const { t } = useTranslation();
    const { currentUser } = useAuthStore();
    const [loading, setLoading] = useState(false);
    const [diagnoses, setDiagnoses] = useState(['']);
    const { register, handleSubmit, formState: { errors } } = useForm({
        resolver: zodResolver(soapSchema)
    });
    const addDiagnosis = () => {
        setDiagnoses([...diagnoses, '']);
    };
    const removeDiagnosis = (index) => {
        if (diagnoses.length > 1) {
            setDiagnoses(diagnoses.filter((_, i) => i !== index));
        }
    };
    const updateDiagnosis = (index, value) => {
        const updated = [...diagnoses];
        updated[index] = value;
        setDiagnoses(updated);
    };
    const onSubmit = async (data) => {
        setLoading(true);
        try {
            const consultation = {
                id: generateId(),
                patientId,
                visitId,
                providerName: currentUser?.fullName || 'Unknown Provider',
                soapSubjective: data.soapSubjective || '',
                soapObjective: data.soapObjective || '',
                soapAssessment: data.soapAssessment || '',
                soapPlan: data.soapPlan || '',
                provisionalDx: diagnoses.filter(dx => dx.trim()),
                createdAt: new Date()
            };
            await db.consultations.add(consultation);
            await createAuditLog(currentUser?.role || 'unknown', 'create', 'consultation', consultation.id);
            onSuccess?.();
        }
        catch (error) {
            console.error('Error saving consultation:', error);
        }
        finally {
            setLoading(false);
        }
    };
    return (_jsx("div", { className: "max-w-4xl mx-auto", children: _jsxs("div", { className: "card", children: [_jsxs("div", { className: "flex items-center space-x-3 mb-6", children: [_jsx(DocumentTextIcon, { className: "h-8 w-8 text-primary" }), _jsx("h2", { className: "text-2xl font-bold text-gray-900", children: "Consultation Notes" })] }), _jsxs("form", { onSubmit: handleSubmit(onSubmit), className: "space-y-6", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Subjective (Patient's History) *" }), _jsx("textarea", { ...register('soapSubjective'), className: "input-field", rows: 4, placeholder: "Patient reports... Chief complaint, history of present illness, review of systems..." }), errors.soapSubjective && (_jsx("p", { className: "text-red-600 text-sm mt-1", children: errors.soapSubjective.message }))] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Objective (Physical Examination) *" }), _jsx("textarea", { ...register('soapObjective'), className: "input-field", rows: 4, placeholder: "Physical examination findings, vital signs, laboratory results..." }), errors.soapObjective && (_jsx("p", { className: "text-red-600 text-sm mt-1", children: errors.soapObjective.message }))] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Assessment (Clinical Impression) *" }), _jsx("textarea", { ...register('soapAssessment'), className: "input-field", rows: 3, placeholder: "Clinical reasoning, differential diagnosis, problem list..." }), errors.soapAssessment && (_jsx("p", { className: "text-red-600 text-sm mt-1", children: errors.soapAssessment.message }))] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Plan (Treatment Plan) *" }), _jsx("textarea", { ...register('soapPlan'), className: "input-field", rows: 4, placeholder: "Treatment plan, medications, follow-up instructions, patient education..." }), errors.soapPlan && (_jsx("p", { className: "text-red-600 text-sm mt-1", children: errors.soapPlan.message }))] }), _jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between mb-3", children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "Provisional Diagnoses" }), _jsxs("button", { type: "button", onClick: addDiagnosis, className: "flex items-center space-x-1 text-primary hover:text-primary/80 text-sm font-medium", children: [_jsx(PlusIcon, { className: "h-4 w-4" }), _jsx("span", { children: "Add Diagnosis" })] })] }), _jsx("div", { className: "space-y-3", children: diagnoses.map((diagnosis, index) => (_jsxs("div", { className: "flex items-center space-x-2", children: [_jsxs("span", { className: "text-sm font-medium text-gray-500 w-8", children: [index + 1, "."] }), _jsx("input", { type: "text", value: diagnosis, onChange: (e) => updateDiagnosis(index, e.target.value), className: "input-field flex-1", placeholder: "Enter diagnosis (e.g., Hypertension, Type 2 Diabetes)" }), diagnoses.length > 1 && (_jsx("button", { type: "button", onClick: () => removeDiagnosis(index), className: "text-red-600 hover:text-red-800 p-1 touch-target", children: _jsx(XMarkIcon, { className: "h-5 w-5" }) }))] }, index))) })] }), _jsxs("div", { className: "bg-gray-50 p-4 rounded-lg", children: [_jsxs("p", { className: "text-sm text-gray-600", children: [_jsx("strong", { children: "Provider:" }), " ", currentUser?.fullName || 'Unknown'] }), _jsxs("p", { className: "text-sm text-gray-600", children: [_jsx("strong", { children: "Date:" }), " ", formatNigerianDate(new Date())] })] }), _jsxs("div", { className: "flex space-x-4 pt-6", children: [_jsx("button", { type: "submit", disabled: loading, className: "btn-primary flex-1", children: loading ? 'Saving...' : 'Save Consultation' }), onCancel && (_jsx("button", { type: "button", onClick: onCancel, className: "btn-secondary flex-1", children: "Cancel" }))] })] })] }) }));
}
