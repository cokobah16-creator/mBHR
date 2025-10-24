import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { createAllergy, updateAllergy, deactivateAllergy, reactivateAllergy, getPatientAllergies } from '../services/allergies';
import { ExclamationTriangleIcon, XMarkIcon, PencilIcon } from '@heroicons/react/24/outline';
const allergySchema = z.object({
    allergen: z.string().min(1, 'Allergen name is required'),
    allergyType: z.enum(['medication', 'food', 'environmental', 'other']),
    reaction: z.string().optional(),
    severity: z.enum(['mild', 'moderate', 'severe', 'life-threatening']),
    onsetDate: z.string().optional(),
    notes: z.string().optional()
});
export function AllergyManager({ patientId, userId, showInactive = false }) {
    const [allergies, setAllergies] = useState([]);
    const [isAdding, setIsAdding] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [loading, setLoading] = useState(true);
    const { register, handleSubmit, reset, formState: { errors } } = useForm({
        resolver: zodResolver(allergySchema)
    });
    useEffect(() => {
        loadAllergies();
    }, [patientId, showInactive]);
    const loadAllergies = async () => {
        setLoading(true);
        const data = await getPatientAllergies(patientId, !showInactive);
        setAllergies(data);
        setLoading(false);
    };
    const onSubmit = async (data) => {
        if (editingId) {
            const updates = {
                allergen: data.allergen,
                allergyType: data.allergyType,
                reaction: data.reaction,
                severity: data.severity,
                onsetDate: data.onsetDate ? new Date(data.onsetDate) : undefined,
                notes: data.notes
            };
            await updateAllergy(editingId, updates);
            setEditingId(null);
        }
        else {
            const input = {
                patientId,
                allergen: data.allergen,
                allergyType: data.allergyType,
                reaction: data.reaction,
                severity: data.severity,
                onsetDate: data.onsetDate ? new Date(data.onsetDate) : undefined,
                notes: data.notes,
                createdBy: userId
            };
            await createAllergy(input);
            setIsAdding(false);
        }
        reset();
        loadAllergies();
    };
    const handleDeactivate = async (allergyId) => {
        if (confirm('Deactivate this allergy?')) {
            await deactivateAllergy(allergyId);
            loadAllergies();
        }
    };
    const handleReactivate = async (allergyId) => {
        await reactivateAllergy(allergyId);
        loadAllergies();
    };
    const handleEdit = (allergy) => {
        setEditingId(allergy.id);
        setIsAdding(true);
        reset({
            allergen: allergy.allergen,
            allergyType: allergy.allergyType,
            reaction: allergy.reaction || undefined,
            severity: allergy.severity,
            onsetDate: allergy.onsetDate ? new Date(allergy.onsetDate).toISOString().split('T')[0] : undefined,
            notes: allergy.notes || undefined
        });
    };
    const handleCancel = () => {
        setIsAdding(false);
        setEditingId(null);
        reset();
    };
    const getSeverityColor = (severity) => {
        switch (severity) {
            case 'life-threatening': return 'bg-red-100 text-red-800 border-red-300';
            case 'severe': return 'bg-orange-100 text-orange-800 border-orange-300';
            case 'moderate': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
            case 'mild': return 'bg-blue-100 text-blue-800 border-blue-300';
            default: return 'bg-gray-100 text-gray-800 border-gray-300';
        }
    };
    if (loading) {
        return _jsx("div", { className: "text-center py-4", children: "Loading allergies..." });
    }
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("h3", { className: "text-lg font-semibold flex items-center gap-2", children: [_jsx(ExclamationTriangleIcon, { className: "h-5 w-5 text-red-600" }), "Allergies"] }), !isAdding && (_jsx("button", { onClick: () => setIsAdding(true), className: "px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm", children: "Add Allergy" }))] }), isAdding && (_jsxs("form", { onSubmit: handleSubmit(onSubmit), className: "bg-gray-50 p-4 rounded-lg border space-y-3", children: [_jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-3", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium mb-1", children: "Allergen *" }), _jsx("input", { ...register('allergen'), className: "w-full px-3 py-2 border rounded", placeholder: "e.g., Penicillin" }), errors.allergen && _jsx("p", { className: "text-red-600 text-sm mt-1", children: errors.allergen.message })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium mb-1", children: "Type *" }), _jsxs("select", { ...register('allergyType'), className: "w-full px-3 py-2 border rounded", children: [_jsx("option", { value: "medication", children: "Medication" }), _jsx("option", { value: "food", children: "Food" }), _jsx("option", { value: "environmental", children: "Environmental" }), _jsx("option", { value: "other", children: "Other" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium mb-1", children: "Severity *" }), _jsxs("select", { ...register('severity'), className: "w-full px-3 py-2 border rounded", children: [_jsx("option", { value: "mild", children: "Mild" }), _jsx("option", { value: "moderate", children: "Moderate" }), _jsx("option", { value: "severe", children: "Severe" }), _jsx("option", { value: "life-threatening", children: "Life-Threatening" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium mb-1", children: "Onset Date" }), _jsx("input", { type: "date", ...register('onsetDate'), className: "w-full px-3 py-2 border rounded" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium mb-1", children: "Reaction" }), _jsx("input", { ...register('reaction'), className: "w-full px-3 py-2 border rounded", placeholder: "Describe the reaction" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium mb-1", children: "Notes" }), _jsx("textarea", { ...register('notes'), className: "w-full px-3 py-2 border rounded", rows: 2, placeholder: "Additional information" })] }), _jsxs("div", { className: "flex gap-2", children: [_jsxs("button", { type: "submit", className: "px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700", children: [editingId ? 'Update' : 'Add', " Allergy"] }), _jsx("button", { type: "button", onClick: handleCancel, className: "px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400", children: "Cancel" })] })] })), allergies.length === 0 ? (_jsx("div", { className: "text-center py-8 text-gray-500 border-2 border-dashed rounded-lg", children: "No allergies recorded" })) : (_jsx("div", { className: "space-y-2", children: allergies.map(allergy => (_jsx("div", { className: `border-2 rounded-lg p-3 ${allergy.isActive ? getSeverityColor(allergy.severity) : 'bg-gray-100 text-gray-500 border-gray-300'}`, children: _jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("h4", { className: "font-semibold text-lg", children: allergy.allergen }), _jsx("span", { className: "px-2 py-0.5 text-xs rounded bg-white bg-opacity-50", children: allergy.allergyType }), _jsx("span", { className: "px-2 py-0.5 text-xs rounded bg-white bg-opacity-50 font-medium", children: allergy.severity.toUpperCase() }), !allergy.isActive && (_jsx("span", { className: "px-2 py-0.5 text-xs rounded bg-gray-400 text-white", children: "INACTIVE" }))] }), allergy.reaction && (_jsxs("p", { className: "text-sm mt-1", children: ["Reaction: ", allergy.reaction] })), allergy.onsetDate && (_jsxs("p", { className: "text-sm mt-1", children: ["Onset: ", new Date(allergy.onsetDate).toLocaleDateString()] })), allergy.notes && (_jsx("p", { className: "text-sm mt-1 italic", children: allergy.notes }))] }), _jsxs("div", { className: "flex gap-1", children: [allergy.isActive && (_jsxs(_Fragment, { children: [_jsx("button", { onClick: () => handleEdit(allergy), className: "p-1 hover:bg-white hover:bg-opacity-50 rounded", title: "Edit", children: _jsx(PencilIcon, { className: "h-4 w-4" }) }), _jsx("button", { onClick: () => handleDeactivate(allergy.id), className: "p-1 hover:bg-white hover:bg-opacity-50 rounded", title: "Deactivate", children: _jsx(XMarkIcon, { className: "h-4 w-4" }) })] })), !allergy.isActive && (_jsx("button", { onClick: () => handleReactivate(allergy.id), className: "px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700", children: "Reactivate" }))] })] }) }, allergy.id))) }))] }));
}
