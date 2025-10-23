import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { db, generateId, createAuditLog, bumpDailyCount, epochDay } from '@/db';
import { calculateBMI, flagVitals, getFlagColor, getFlagLabel } from '@/utils/vitals';
import { useAuthStore } from '@/stores/auth';
import { EnhancedVitalsInput } from '@/components/EnhancedVitalsInput';
import { AudioButton } from '@/components/AudioButton';
import { HeartIcon } from '@heroicons/react/24/outline';
const vitalsSchema = z.object({
    heightCm: z.number().min(30).max(250).optional(),
    weightKg: z.number().min(1).max(300).optional(),
    tempC: z.number().min(30).max(45).optional(),
    pulseBpm: z.number().min(30).max(200).optional(),
    systolic: z.number().min(60).max(250).optional(),
    diastolic: z.number().min(30).max(150).optional(),
    spo2: z.number().min(70).max(100).optional()
});
export function VitalsForm({ patientId, visitId, onSuccess, onCancel }) {
    const { t } = useTranslation();
    const { currentUser } = useAuthStore();
    const [loading, setLoading] = useState(false);
    const [bmi, setBmi] = useState(null);
    const [flags, setFlags] = useState([]);
    const [patient, setPatient] = useState(null);
    const { register, handleSubmit, watch, control, formState: { errors } } = useForm({
        resolver: zodResolver(vitalsSchema)
    });
    const watchedValues = watch();
    useEffect(() => {
        // Load patient data for age/sex context
        db.patients.get(patientId).then(setPatient);
    }, [patientId]);
    // Calculate BMI and flags when height/weight change
    useEffect(() => {
        const { heightCm, weightKg, systolic, diastolic, tempC, pulseBpm } = watchedValues;
        let calculatedBmi = null;
        if (heightCm && weightKg) {
            calculatedBmi = calculateBMI(heightCm, weightKg);
            setBmi(calculatedBmi);
        }
        else {
            setBmi(null);
        }
        const vitalsForFlagging = {
            systolic,
            diastolic,
            tempC,
            pulseBpm,
            bmi: calculatedBmi || undefined
        };
        const newFlags = flagVitals(vitalsForFlagging);
        setFlags(newFlags);
    }, [watchedValues]);
    const onSubmit = async (data) => {
        setLoading(true);
        try {
            const vital = {
                id: generateId(),
                patientId,
                visitId,
                ...data,
                bmi: bmi || undefined,
                flags,
                takenAt: new Date()
            };
            await db.vitals.add(vital);
            await createAuditLog(currentUser?.role || 'unknown', 'create', 'vital', vital.id);
            // Bump daily count
            await bumpDailyCount(epochDay(new Date()), 'vitals');
            onSuccess?.();
        }
        catch (error) {
            console.error('Error saving vitals:', error);
        }
        finally {
            setLoading(false);
        }
    };
    const getPatientAge = (dob) => {
        const birthDate = new Date(dob);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
        return age;
    };
    if (!patient) {
        return (_jsx("div", { className: "flex items-center justify-center py-12", children: _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" }), _jsx("p", { className: "mt-4 text-gray-600", children: "Loading patient..." })] }) }));
    }
    const patientAge = getPatientAge(patient.dob);
    const patientSex = patient.sex === 'male' ? 'M' : patient.sex === 'female' ? 'F' : 'U';
    return (_jsx("div", { className: "max-w-2xl mx-auto", children: _jsxs("div", { className: "card", children: [_jsxs("div", { className: "flex items-center space-x-3 mb-6", children: [_jsx(HeartIcon, { className: "h-8 w-8 text-primary" }), _jsx("h2", { className: "text-2xl font-bold text-gray-900", children: "Record Vital Signs" }), _jsxs("div", { className: "text-sm text-gray-600", children: ["Age: ", patientAge, " \u2022 ", patient.sex] })] }), _jsxs("form", { onSubmit: handleSubmit(onSubmit), className: "space-y-6", children: [_jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: [_jsx(EnhancedVitalsInput, { name: "heightCm", label: t('vitals.height'), unit: "cm", metric: "hr", patientAge: patientAge, patientSex: patientSex, placeholder: "170", step: 0.1 }), _jsx(EnhancedVitalsInput, { name: "weightKg", label: t('vitals.weight'), unit: "kg", metric: "hr", patientAge: patientAge, patientSex: patientSex, placeholder: "70", step: 0.1 })] }), bmi && (_jsx("div", { className: "bg-blue-50 p-4 rounded-lg", children: _jsxs("p", { className: "text-sm font-medium text-blue-800", children: ["BMI: ", _jsx("span", { className: "text-lg", children: bmi })] }) })), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: [_jsx(EnhancedVitalsInput, { name: "tempC", label: t('vitals.temperature'), unit: "\u00B0C", metric: "temp", patientAge: patientAge, patientSex: patientSex, placeholder: "36.5", step: 0.1 }), _jsx(EnhancedVitalsInput, { name: "pulseBpm", label: t('vitals.pulse'), unit: "bpm", metric: "hr", patientAge: patientAge, patientSex: patientSex, placeholder: "72" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: t('vitals.bloodPressure') }), _jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsx(EnhancedVitalsInput, { name: "systolic", label: "Systolic", unit: "mmHg", metric: "sbp", patientAge: patientAge, patientSex: patientSex, placeholder: "120" }), _jsx(EnhancedVitalsInput, { name: "diastolic", label: "Diastolic", unit: "mmHg", metric: "dbp", patientAge: patientAge, patientSex: patientSex, placeholder: "80" })] })] }), _jsx(EnhancedVitalsInput, { name: "spo2", label: "SpO2", unit: "%", metric: "spo2", patientAge: patientAge, patientSex: patientSex, placeholder: "98" }), flags.length > 0 && (_jsxs("div", { className: "bg-yellow-50 border border-yellow-200 rounded-lg p-4", children: [_jsx("h3", { className: "text-sm font-medium text-yellow-800 mb-2", children: "\u26A0\uFE0F Abnormal Values Detected" }), _jsx("div", { className: "flex flex-wrap gap-2", children: flags.map((flag) => (_jsx("span", { className: `px-2 py-1 rounded-full text-xs font-medium ${getFlagColor(flag)}`, children: getFlagLabel(flag) }, flag))) })] })), _jsxs("div", { className: "flex space-x-4 pt-6", children: [_jsx(AudioButton, { audioKey: "action.save", fallbackText: "Save Vitals", type: "submit", disabled: loading, className: "btn-primary flex-1", children: loading ? 'Saving...' : 'Save Vitals' }), onCancel && (_jsx(AudioButton, { audioKey: "action.cancel", fallbackText: "Cancel", type: "button", onClick: onCancel, className: "btn-secondary flex-1", children: "Cancel" }))] })] })] }) }));
}
