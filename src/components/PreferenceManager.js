import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { createOrUpdatePreference, getPatientPreference } from '../services/preferences';
import { Cog6ToothIcon } from '@heroicons/react/24/outline';
const preferenceSchema = z.object({
    preferredLanguage: z.string().optional(),
    communicationChannel: z.enum(['sms', 'whatsapp', 'call', 'in-person']).optional().or(z.literal('')),
    bestContactTime: z.string().optional(),
    dietaryRestrictions: z.string().optional(),
    religiousCultural: z.string().optional(),
    appointmentReminders: z.boolean(),
    medicationReminders: z.boolean(),
    notes: z.string().optional()
});
export function PreferenceManager({ patientId }) {
    const [preference, setPreference] = useState(null);
    const [isEditing, setIsEditing] = useState(false);
    const [loading, setLoading] = useState(true);
    const { register, handleSubmit, reset, formState: { errors } } = useForm({
        resolver: zodResolver(preferenceSchema),
        defaultValues: {
            appointmentReminders: true,
            medicationReminders: true
        }
    });
    useEffect(() => {
        loadPreference();
    }, [patientId]);
    const loadPreference = async () => {
        setLoading(true);
        const data = await getPatientPreference(patientId);
        setPreference(data || null);
        if (data) {
            reset({
                preferredLanguage: data.preferredLanguage || undefined,
                communicationChannel: data.communicationChannel || undefined,
                bestContactTime: data.bestContactTime || undefined,
                dietaryRestrictions: data.dietaryRestrictions || undefined,
                religiousCultural: data.religiousCultural || undefined,
                appointmentReminders: data.appointmentReminders === 1,
                medicationReminders: data.medicationReminders === 1,
                notes: data.notes || undefined
            });
        }
        setLoading(false);
    };
    const onSubmit = async (data) => {
        const input = {
            patientId,
            preferredLanguage: data.preferredLanguage,
            communicationChannel: data.communicationChannel || undefined,
            bestContactTime: data.bestContactTime,
            dietaryRestrictions: data.dietaryRestrictions,
            religiousCultural: data.religiousCultural,
            appointmentReminders: data.appointmentReminders ? 1 : 0,
            medicationReminders: data.medicationReminders ? 1 : 0,
            notes: data.notes
        };
        await createOrUpdatePreference(input);
        setIsEditing(false);
        loadPreference();
    };
    if (loading) {
        return _jsx("div", { className: "text-center py-4", children: "Loading preferences..." });
    }
    if (!isEditing && !preference) {
        return (_jsxs("div", { className: "space-y-4", children: [_jsx("div", { className: "flex items-center justify-between", children: _jsxs("h3", { className: "text-lg font-semibold flex items-center gap-2", children: [_jsx(Cog6ToothIcon, { className: "h-5 w-5 text-gray-600" }), "Patient Preferences"] }) }), _jsxs("div", { className: "text-center py-8 text-gray-500 border-2 border-dashed rounded-lg", children: [_jsx("p", { className: "mb-3", children: "No preferences set" }), _jsx("button", { onClick: () => setIsEditing(true), className: "px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700", children: "Set Preferences" })] })] }));
    }
    if (!isEditing && preference) {
        return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("h3", { className: "text-lg font-semibold flex items-center gap-2", children: [_jsx(Cog6ToothIcon, { className: "h-5 w-5 text-gray-600" }), "Patient Preferences"] }), _jsx("button", { onClick: () => setIsEditing(true), className: "px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm", children: "Edit" })] }), _jsxs("div", { className: "bg-gray-50 p-4 rounded-lg border space-y-3", children: [_jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-3", children: [preference.preferredLanguage && (_jsxs("div", { children: [_jsx("span", { className: "text-sm font-medium text-gray-600", children: "Language:" }), _jsx("p", { className: "mt-1", children: preference.preferredLanguage })] })), preference.communicationChannel && (_jsxs("div", { children: [_jsx("span", { className: "text-sm font-medium text-gray-600", children: "Communication:" }), _jsx("p", { className: "mt-1 capitalize", children: preference.communicationChannel })] })), preference.bestContactTime && (_jsxs("div", { children: [_jsx("span", { className: "text-sm font-medium text-gray-600", children: "Best Contact Time:" }), _jsx("p", { className: "mt-1", children: preference.bestContactTime })] })), preference.dietaryRestrictions && (_jsxs("div", { children: [_jsx("span", { className: "text-sm font-medium text-gray-600", children: "Dietary Restrictions:" }), _jsx("p", { className: "mt-1", children: preference.dietaryRestrictions })] })), preference.religiousCultural && (_jsxs("div", { className: "md:col-span-2", children: [_jsx("span", { className: "text-sm font-medium text-gray-600", children: "Religious/Cultural Considerations:" }), _jsx("p", { className: "mt-1", children: preference.religiousCultural })] }))] }), _jsxs("div", { className: "border-t pt-3 space-y-2", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("input", { type: "checkbox", checked: preference.appointmentReminders === 1, disabled: true, className: "h-4 w-4" }), _jsx("span", { className: "text-sm", children: "Appointment reminders enabled" })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("input", { type: "checkbox", checked: preference.medicationReminders === 1, disabled: true, className: "h-4 w-4" }), _jsx("span", { className: "text-sm", children: "Medication reminders enabled" })] })] }), preference.notes && (_jsxs("div", { className: "border-t pt-3", children: [_jsx("span", { className: "text-sm font-medium text-gray-600", children: "Notes:" }), _jsx("p", { className: "mt-1 text-sm italic", children: preference.notes })] }))] })] }));
    }
    return (_jsxs("div", { className: "space-y-4", children: [_jsx("div", { className: "flex items-center justify-between", children: _jsxs("h3", { className: "text-lg font-semibold flex items-center gap-2", children: [_jsx(Cog6ToothIcon, { className: "h-5 w-5 text-gray-600" }), "Patient Preferences"] }) }), _jsxs("form", { onSubmit: handleSubmit(onSubmit), className: "bg-gray-50 p-4 rounded-lg border space-y-4", children: [_jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-3", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium mb-1", children: "Preferred Language" }), _jsx("input", { ...register('preferredLanguage'), className: "w-full px-3 py-2 border rounded", placeholder: "e.g., English, Hausa, Yoruba" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium mb-1", children: "Communication Channel" }), _jsxs("select", { ...register('communicationChannel'), className: "w-full px-3 py-2 border rounded", children: [_jsx("option", { value: "", children: "Not specified" }), _jsx("option", { value: "sms", children: "SMS" }), _jsx("option", { value: "whatsapp", children: "WhatsApp" }), _jsx("option", { value: "call", children: "Phone Call" }), _jsx("option", { value: "in-person", children: "In Person" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium mb-1", children: "Best Contact Time" }), _jsx("input", { ...register('bestContactTime'), className: "w-full px-3 py-2 border rounded", placeholder: "e.g., Morning, Evening" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium mb-1", children: "Dietary Restrictions" }), _jsx("input", { ...register('dietaryRestrictions'), className: "w-full px-3 py-2 border rounded", placeholder: "e.g., Vegetarian, Allergies" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium mb-1", children: "Religious/Cultural Considerations" }), _jsx("input", { ...register('religiousCultural'), className: "w-full px-3 py-2 border rounded", placeholder: "Any special considerations" })] }), _jsxs("div", { className: "space-y-2 border-t pt-3", children: [_jsxs("label", { className: "flex items-center gap-2", children: [_jsx("input", { type: "checkbox", ...register('appointmentReminders'), className: "h-4 w-4" }), _jsx("span", { className: "text-sm", children: "Send appointment reminders" })] }), _jsxs("label", { className: "flex items-center gap-2", children: [_jsx("input", { type: "checkbox", ...register('medicationReminders'), className: "h-4 w-4" }), _jsx("span", { className: "text-sm", children: "Send medication reminders" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium mb-1", children: "Additional Notes" }), _jsx("textarea", { ...register('notes'), className: "w-full px-3 py-2 border rounded", rows: 3, placeholder: "Any other preferences or notes" })] }), _jsxs("div", { className: "flex gap-2", children: [_jsx("button", { type: "submit", className: "px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700", children: "Save Preferences" }), _jsx("button", { type: "button", onClick: () => {
                                    setIsEditing(false);
                                    if (preference) {
                                        reset({
                                            preferredLanguage: preference.preferredLanguage || undefined,
                                            communicationChannel: preference.communicationChannel || undefined,
                                            bestContactTime: preference.bestContactTime || undefined,
                                            dietaryRestrictions: preference.dietaryRestrictions || undefined,
                                            religiousCultural: preference.religiousCultural || undefined,
                                            appointmentReminders: preference.appointmentReminders === 1,
                                            medicationReminders: preference.medicationReminders === 1,
                                            notes: preference.notes || undefined
                                        });
                                    }
                                }, className: "px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400", children: "Cancel" })] })] })] }));
}
