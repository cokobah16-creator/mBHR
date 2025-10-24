import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { useFormContext } from 'react-hook-form';
import { db } from '@/db';
import { ExclamationTriangleIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
export function EnhancedVitalsInput({ name, label, unit, metric, patientAge, patientSex, placeholder, step = 1 }) {
    const { register, watch, formState: { errors } } = useFormContext();
    const [range, setRange] = useState(null);
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const value = Number(watch(name)) || 0;
    useEffect(() => {
        loadVitalRange();
    }, [metric, patientAge, patientSex]);
    useEffect(() => {
        if (range && value > 0) {
            calculateStatus();
        }
        else {
            setStatus(null);
        }
    }, [value, range]);
    const loadVitalRange = async () => {
        try {
            const vitalsRange = await db.vitalsRanges
                .where('metric').equals(metric)
                .and(r => r.sex === patientSex || r.sex === 'U')
                .and(r => patientAge >= r.ageMin && patientAge <= r.ageMax)
                .first();
            setRange(vitalsRange || null);
        }
        catch (error) {
            console.error('Error loading vital range:', error);
        }
        finally {
            setLoading(false);
        }
    };
    const calculateStatus = () => {
        if (!range || value <= 0) {
            setStatus(null);
            return;
        }
        const { min, max } = range;
        const criticalLow = min * 0.7; // 30% below normal
        const criticalHigh = max * 1.3; // 30% above normal
        if (value < criticalLow || value > criticalHigh) {
            setStatus('critical');
        }
        else if (value < min) {
            setStatus('low');
        }
        else if (value > max) {
            setStatus('high');
        }
        else {
            setStatus('normal');
        }
    };
    const getStatusDisplay = () => {
        switch (status) {
            case 'critical':
                return {
                    icon: ExclamationTriangleIcon,
                    color: 'text-red-700 bg-red-50 border-red-200',
                    message: 'Critical value - immediate attention required',
                    priority: 'high'
                };
            case 'high':
                return {
                    icon: ExclamationTriangleIcon,
                    color: 'text-orange-700 bg-orange-50 border-orange-200',
                    message: 'Above normal - consider recheck',
                    priority: 'medium'
                };
            case 'low':
                return {
                    icon: ExclamationTriangleIcon,
                    color: 'text-yellow-700 bg-yellow-50 border-yellow-200',
                    message: 'Below normal - verify reading',
                    priority: 'medium'
                };
            case 'normal':
                return {
                    icon: CheckCircleIcon,
                    color: 'text-green-700 bg-green-50 border-green-200',
                    message: 'Within normal range',
                    priority: 'low'
                };
            default:
                return null;
        }
    };
    const statusDisplay = getStatusDisplay();
    return (_jsxs("div", { className: "space-y-2", children: [_jsxs("label", { className: "block text-sm font-medium text-gray-700", children: [label, range && !loading && (_jsxs("span", { className: "ml-2 text-xs text-gray-500", children: ["(Normal: ", range.min, "-", range.max, " ", unit, ")"] }))] }), _jsxs("div", { className: "relative", children: [_jsx("input", { ...register(name, {
                            valueAsNumber: true,
                            required: `${label} is required`
                        }), type: "number", step: step, className: `input-field ${statusDisplay?.priority === 'high' ? 'border-red-300 ring-red-200' :
                            statusDisplay?.priority === 'medium' ? 'border-yellow-300 ring-yellow-200' :
                                status === 'normal' ? 'border-green-300 ring-green-200' :
                                    'border-gray-300'}`, placeholder: placeholder, "aria-describedby": `${name}-status ${name}-range` }), statusDisplay && (_jsx("div", { className: "absolute right-3 top-1/2 transform -translate-y-1/2", children: _jsx(statusDisplay.icon, { className: `h-5 w-5 ${statusDisplay.priority === 'high' ? 'text-red-600' :
                                statusDisplay.priority === 'medium' ? 'text-yellow-600' :
                                    'text-green-600'}` }) }))] }), statusDisplay && (_jsx("div", { id: `${name}-status`, className: `p-2 rounded-lg border text-sm ${statusDisplay.color}`, role: statusDisplay.priority === 'high' ? 'alert' : 'status', "aria-live": statusDisplay.priority === 'high' ? 'assertive' : 'polite', children: _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(statusDisplay.icon, { className: "h-4 w-4" }), _jsx("span", { children: statusDisplay.message })] }) })), range && !loading && (_jsxs("p", { id: `${name}-range`, className: "text-xs text-gray-500", children: ["Age ", patientAge, ", ", patientSex === 'M' ? 'Male' : patientSex === 'F' ? 'Female' : 'Unknown', " \u2022 Source: ", range.source] })), errors[name] && (_jsx("p", { className: "text-red-600 text-sm", role: "alert", children: errors[name]?.message }))] }));
}
