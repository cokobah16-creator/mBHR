import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { useT } from '@/hooks/useT';
import { useAuthStore } from '@/stores/auth';
import { db, generateId } from '@/db';
import { VisualNumberInput } from '@/components/VisualNumberInput';
import { calculateBMI, flagVitals, getFlagColor, getFlagLabel } from '@/utils/vitals';
import { HeartIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
export default function EnhancedVitalsForm({ patientId, visitId, patientAge, patientSex, onSuccess, onCancel }) {
    const { t } = useT();
    const { currentUser } = useAuthStore();
    const [vitals, setVitals] = useState({
        heightCm: 0,
        weightKg: 0,
        tempC: 36.5,
        pulseBpm: 72,
        systolic: 120,
        diastolic: 80,
        spo2: 98
    });
    const [ranges, setRanges] = useState({});
    const [warnings, setWarnings] = useState([]);
    const [bmi, setBmi] = useState(null);
    const [flags, setFlags] = useState([]);
    const [loading, setLoading] = useState(false);
    useEffect(() => {
        loadVitalsRanges();
    }, [patientAge, patientSex]);
    useEffect(() => {
        validateVitals();
        calculateBMIAndFlags();
    }, [vitals, ranges]);
    const loadVitalsRanges = async () => {
        try {
            // Load age/sex-specific ranges from database
            const vitalsRanges = await db.vitalsRanges
                .where('sex')
                .equals(patientSex)
                .and(range => patientAge >= range.ageMin && patientAge <= range.ageMax)
                .toArray();
            const rangeMap = {};
            vitalsRanges.forEach(range => {
                rangeMap[range.metric] = {
                    metric: range.metric,
                    min: range.min,
                    max: range.max,
                    unit: getMetricUnit(range.metric)
                };
            });
            // Fallback to adult ranges if no specific ranges found
            if (Object.keys(rangeMap).length === 0) {
                rangeMap.hr = { metric: 'hr', min: 60, max: 100, unit: 'bpm' };
                rangeMap.temp = { metric: 'temp', min: 36.1, max: 37.2, unit: '°C' };
                rangeMap.sbp = { metric: 'sbp', min: 90, max: 140, unit: 'mmHg' };
                rangeMap.dbp = { metric: 'dbp', min: 60, max: 90, unit: 'mmHg' };
                rangeMap.rr = { metric: 'rr', min: 12, max: 20, unit: '/min' };
                rangeMap.spo2 = { metric: 'spo2', min: 95, max: 100, unit: '%' };
            }
            setRanges(rangeMap);
        }
        catch (error) {
            console.error('Error loading vitals ranges:', error);
        }
    };
    const getMetricUnit = (metric) => {
        const units = {
            hr: 'bpm',
            temp: '°C',
            sbp: 'mmHg',
            dbp: 'mmHg',
            rr: '/min',
            spo2: '%'
        };
        return units[metric] || '';
    };
    const validateVitals = () => {
        const newWarnings = [];
        // Check each vital against normal ranges
        Object.entries(vitals).forEach(([key, value]) => {
            if (value <= 0)
                return;
            let metric = key;
            if (key === 'pulseBpm')
                metric = 'hr';
            if (key === 'tempC')
                metric = 'temp';
            const range = ranges[metric];
            if (range && (value < range.min || value > range.max)) {
                const status = value < range.min ? 'low' : 'high';
                newWarnings.push(`${range.metric.toUpperCase()} ${status}: ${value} (normal: ${range.min}-${range.max})`);
            }
        });
        // Special validations
        if (vitals.systolic > 0 && vitals.diastolic > 0 && vitals.systolic <= vitals.diastolic) {
            newWarnings.push('Systolic pressure should be higher than diastolic');
        }
        if (vitals.heightCm > 0 && vitals.heightCm < 50) {
            newWarnings.push('Height seems unusually low - please verify');
        }
        if (vitals.weightKg > 0 && vitals.weightKg < 2) {
            newWarnings.push('Weight seems unusually low - please verify');
        }
        setWarnings(newWarnings);
    };
    const calculateBMIAndFlags = () => {
        let calculatedBmi = null;
        if (vitals.heightCm > 0 && vitals.weightKg > 0) {
            calculatedBmi = calculateBMI(vitals.heightCm, vitals.weightKg);
            setBmi(calculatedBmi);
        }
        else {
            setBmi(null);
        }
        const vitalsForFlagging = {
            systolic: vitals.systolic,
            diastolic: vitals.diastolic,
            tempC: vitals.tempC,
            pulseBpm: vitals.pulseBpm,
            bmi: calculatedBmi || undefined
        };
        const newFlags = flagVitals(vitalsForFlagging);
        setFlags(newFlags);
    };
    const handleSubmit = async () => {
        if (warnings.length > 0) {
            const proceed = confirm(`There are ${warnings.length} warnings about these vitals. Do you want to proceed?\n\n${warnings.join('\n')}`);
            if (!proceed)
                return;
        }
        setLoading(true);
        try {
            const vital = {
                id: generateId(),
                patientId,
                visitId,
                heightCm: vitals.heightCm || undefined,
                weightKg: vitals.weightKg || undefined,
                tempC: vitals.tempC || undefined,
                pulseBpm: vitals.pulseBpm || undefined,
                systolic: vitals.systolic || undefined,
                diastolic: vitals.diastolic || undefined,
                spo2: vitals.spo2 || undefined,
                bmi: bmi || undefined,
                flags,
                takenAt: new Date(),
                _dirty: 1
            };
            await db.vitals.add(vital);
            // Create audit log
            await db.auditLogs.add({
                id: generateId(),
                actorRole: currentUser?.role || 'unknown',
                action: 'create',
                entity: 'vital',
                entityId: vital.id,
                at: new Date()
            });
            onSuccess?.();
        }
        catch (error) {
            console.error('Error saving vitals:', error);
            alert('Failed to save vitals');
        }
        finally {
            setLoading(false);
        }
    };
    const getVitalStatus = (key, value) => {
        if (value <= 0)
            return null;
        let metric = key;
        if (key === 'pulseBpm')
            metric = 'hr';
        if (key === 'tempC')
            metric = 'temp';
        const range = ranges[metric];
        if (!range)
            return null;
        if (value < range.min)
            return 'low';
        if (value > range.max)
            return 'high';
        return 'normal';
    };
    const getStatusColor = (status) => {
        switch (status) {
            case 'low':
                return 'text-blue-600 bg-blue-50';
            case 'high':
                return 'text-red-600 bg-red-50';
            case 'normal':
                return 'text-green-600 bg-green-50';
            default:
                return 'text-gray-600 bg-gray-50';
        }
    };
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(HeartIcon, { className: "h-8 w-8 text-primary" }), _jsxs("div", { children: [_jsx("h2", { className: "text-2xl font-bold text-gray-900", children: "Enhanced Vitals Recording" }), _jsxs("p", { className: "text-gray-600", children: ["Age: ", patientAge, " years \u2022 Sex: ", patientSex === 'M' ? 'Male' : patientSex === 'F' ? 'Female' : 'Unknown'] })] })] }), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-6", children: [_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-medium text-gray-900 mb-4", children: "Anthropometric" }), _jsxs("div", { className: "space-y-6", children: [_jsx(VisualNumberInput, { value: vitals.heightCm, onChange: (value) => setVitals(prev => ({ ...prev, heightCm: value })), min: 50, max: 250, label: t('vitals.height'), unit: "cm", showDots: false }), _jsx(VisualNumberInput, { value: vitals.weightKg, onChange: (value) => setVitals(prev => ({ ...prev, weightKg: value })), min: 2, max: 200, label: t('vitals.weight'), unit: "kg", showDots: false })] })] }), _jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-medium text-gray-900 mb-4", children: "Vital Signs" }), _jsxs("div", { className: "space-y-6", children: [_jsx(VisualNumberInput, { value: vitals.tempC, onChange: (value) => setVitals(prev => ({ ...prev, tempC: value })), min: 30, max: 45, step: 0.1, label: t('vitals.temperature'), unit: "\u00B0C", showDots: false }), _jsx(VisualNumberInput, { value: vitals.pulseBpm, onChange: (value) => setVitals(prev => ({ ...prev, pulseBpm: value })), min: 30, max: 200, label: t('vitals.pulse'), unit: "bpm", showDots: false }), _jsxs("div", { children: [_jsx("label", { className: "block text-lg font-medium text-gray-700 mb-4 text-center", children: t('vitals.bloodPressure') }), _jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsx(VisualNumberInput, { value: vitals.systolic, onChange: (value) => setVitals(prev => ({ ...prev, systolic: value })), min: 60, max: 250, label: "Systolic", unit: "mmHg", showDots: false }), _jsx(VisualNumberInput, { value: vitals.diastolic, onChange: (value) => setVitals(prev => ({ ...prev, diastolic: value })), min: 30, max: 150, label: "Diastolic", unit: "mmHg", showDots: false })] })] }), _jsx(VisualNumberInput, { value: vitals.spo2, onChange: (value) => setVitals(prev => ({ ...prev, spo2: value })), min: 70, max: 100, label: "SpO2", unit: "%", showDots: false })] })] })] }), _jsxs("div", { className: "space-y-6", children: [bmi && (_jsx("div", { className: "card bg-blue-50 border-blue-200", children: _jsxs("div", { className: "text-center", children: [_jsx("h3", { className: "text-lg font-medium text-blue-800 mb-2", children: "Body Mass Index" }), _jsx("div", { className: "text-4xl font-bold text-blue-900", children: bmi }), _jsx("div", { className: "text-sm text-blue-600 mt-2", children: bmi < 18.5 ? 'Underweight' :
                                                bmi < 25 ? 'Normal' :
                                                    bmi < 30 ? 'Overweight' : 'Obese' })] }) })), _jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-medium text-gray-900 mb-4", children: "Range Validation" }), _jsx("div", { className: "space-y-3", children: Object.entries(vitals).map(([key, value]) => {
                                            if (value <= 0)
                                                return null;
                                            const status = getVitalStatus(key, value);
                                            const range = ranges[key === 'pulseBpm' ? 'hr' : key === 'tempC' ? 'temp' : key];
                                            return (_jsxs("div", { className: "flex items-center justify-between p-3 rounded-lg border", children: [_jsxs("div", { children: [_jsx("span", { className: "font-medium text-gray-900", children: key === 'heightCm' ? 'Height' :
                                                                    key === 'weightKg' ? 'Weight' :
                                                                        key === 'tempC' ? 'Temperature' :
                                                                            key === 'pulseBpm' ? 'Pulse' :
                                                                                key === 'systolic' ? 'Systolic' :
                                                                                    key === 'diastolic' ? 'Diastolic' :
                                                                                        key === 'spo2' ? 'SpO2' : key }), _jsxs("div", { className: "text-sm text-gray-600", children: [value, " ", getMetricUnit(key), range && ` (normal: ${range.min}-${range.max})`] })] }), status && (_jsx("span", { className: `px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(status)}`, children: status }))] }, key));
                                        }) })] }), warnings.length > 0 && (_jsxs("div", { className: "bg-yellow-50 border border-yellow-200 rounded-lg p-4", children: [_jsxs("div", { className: "flex items-center space-x-2 mb-3", children: [_jsx(ExclamationTriangleIcon, { className: "h-5 w-5 text-yellow-600" }), _jsx("h3", { className: "font-medium text-yellow-800", children: "Validation Warnings" })] }), _jsx("ul", { className: "text-sm text-yellow-700 space-y-1", children: warnings.map((warning, index) => (_jsxs("li", { children: ["\u2022 ", warning] }, index))) })] })), flags.length > 0 && (_jsxs("div", { className: "bg-red-50 border border-red-200 rounded-lg p-4", children: [_jsxs("div", { className: "flex items-center space-x-2 mb-3", children: [_jsx(ExclamationTriangleIcon, { className: "h-5 w-5 text-red-600" }), _jsx("h3", { className: "font-medium text-red-800", children: "Clinical Alerts" })] }), _jsx("div", { className: "flex flex-wrap gap-2", children: flags.map((flag) => (_jsx("span", { className: `px-3 py-1 rounded-full text-sm font-medium ${getFlagColor(flag)}`, children: getFlagLabel(flag) }, flag))) })] })), _jsxs("div", { className: "card bg-gray-50", children: [_jsx("h3", { className: "text-lg font-medium text-gray-900 mb-4", children: "Normal Ranges" }), _jsxs("div", { className: "text-sm text-gray-700 space-y-2", children: [_jsxs("p", { children: [_jsx("strong", { children: "Age Group:" }), " ", patientAge < 18 ? 'Pediatric' : 'Adult'] }), _jsxs("p", { children: [_jsx("strong", { children: "Sex:" }), " ", patientSex === 'M' ? 'Male' : patientSex === 'F' ? 'Female' : 'Unknown'] }), Object.values(ranges).map(range => (_jsxs("p", { children: [_jsxs("strong", { children: [range.metric.toUpperCase(), ":"] }), " ", range.min, "-", range.max, " ", range.unit] }, range.metric)))] })] })] })] }), _jsxs("div", { className: "flex space-x-4", children: [_jsx("button", { onClick: handleSubmit, disabled: loading || Object.values(vitals).every(v => v <= 0), className: "btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed", children: loading ? 'Saving...' : 'Save Enhanced Vitals' }), onCancel && (_jsx("button", { onClick: onCancel, className: "btn-secondary", children: t('action.cancel') }))] })] }));
}
