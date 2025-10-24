import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { clinicalDecisionSupport } from '@/services/clinicalDecisionSupport';
import { ExclamationTriangleIcon, CheckCircleIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
export function SmartVitalsInput({ vitals, onChange }) {
    const [analysis, setAnalysis] = useState(null);
    useEffect(() => {
        if (hasAnyVitals()) {
            analyzeVitals();
        }
    }, [vitals]);
    const hasAnyVitals = () => {
        return Object.values(vitals).some(v => v !== undefined && v > 0);
    };
    const analyzeVitals = () => {
        const result = clinicalDecisionSupport.analyzeVitals(vitals);
        setAnalysis(result);
    };
    const getRiskLevelColor = (level) => {
        switch (level) {
            case 'critical': return 'bg-red-50 border-red-300 text-red-900';
            case 'high': return 'bg-orange-50 border-orange-300 text-orange-900';
            case 'moderate': return 'bg-yellow-50 border-yellow-300 text-yellow-900';
            case 'low': return 'bg-green-50 border-green-300 text-green-900';
            default: return 'bg-gray-50 border-gray-300 text-gray-900';
        }
    };
    const getRiskIcon = (level) => {
        switch (level) {
            case 'critical':
            case 'high':
                return _jsx(ExclamationTriangleIcon, { className: "h-5 w-5 text-red-600" });
            case 'moderate':
                return _jsx(InformationCircleIcon, { className: "h-5 w-5 text-yellow-600" });
            case 'low':
                return _jsx(CheckCircleIcon, { className: "h-5 w-5 text-green-600" });
            default:
                return _jsx(InformationCircleIcon, { className: "h-5 w-5 text-gray-600" });
        }
    };
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Height (cm)" }), _jsx("input", { type: "number", value: vitals.heightCm || '', onChange: (e) => onChange('heightCm', parseFloat(e.target.value)), className: "w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500", placeholder: "e.g., 170" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Weight (kg)" }), _jsx("input", { type: "number", value: vitals.weightKg || '', onChange: (e) => onChange('weightKg', parseFloat(e.target.value)), className: "w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500", placeholder: "e.g., 70" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Temperature (\u00B0C)" }), _jsx("input", { type: "number", step: "0.1", value: vitals.tempC || '', onChange: (e) => onChange('tempC', parseFloat(e.target.value)), className: "w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500", placeholder: "e.g., 37.0" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Pulse (bpm)" }), _jsx("input", { type: "number", value: vitals.pulseBpm || '', onChange: (e) => onChange('pulseBpm', parseFloat(e.target.value)), className: "w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500", placeholder: "e.g., 80" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Blood Pressure - Systolic" }), _jsx("input", { type: "number", value: vitals.systolic || '', onChange: (e) => onChange('systolic', parseFloat(e.target.value)), className: "w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500", placeholder: "e.g., 120" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Blood Pressure - Diastolic" }), _jsx("input", { type: "number", value: vitals.diastolic || '', onChange: (e) => onChange('diastolic', parseFloat(e.target.value)), className: "w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500", placeholder: "e.g., 80" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "SpO2 (%)" }), _jsx("input", { type: "number", value: vitals.spo2 || '', onChange: (e) => onChange('spo2', parseFloat(e.target.value)), className: "w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500", placeholder: "e.g., 98" })] }), vitals.bmi && (_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "BMI (calculated)" }), _jsx("div", { className: "w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-gray-700", children: vitals.bmi.toFixed(1) })] }))] }), analysis && hasAnyVitals() && (_jsx("div", { className: `rounded-lg border p-4 ${getRiskLevelColor(analysis.riskLevel)}`, children: _jsxs("div", { className: "flex items-start gap-3", children: [getRiskIcon(analysis.riskLevel), _jsxs("div", { className: "flex-1", children: [_jsxs("h4", { className: "font-semibold mb-2 capitalize", children: [analysis.riskLevel, " Risk Level", _jsxs("span", { className: "ml-2 text-sm font-normal", children: ["(Score: ", analysis.score, ")"] })] }), analysis.urgentFlags.length > 0 && (_jsxs("div", { className: "mb-3 p-3 bg-red-100 border border-red-300 rounded-md", children: [_jsx("p", { className: "font-semibold text-red-900 mb-1", children: "URGENT:" }), _jsx("ul", { className: "list-disc list-inside space-y-1", children: analysis.urgentFlags.map((flag, idx) => (_jsx("li", { className: "text-sm text-red-800", children: flag }, idx))) })] })), analysis.concerns.length > 0 && (_jsxs("div", { className: "mb-3", children: [_jsx("p", { className: "font-medium mb-1", children: "Concerns Identified:" }), _jsx("ul", { className: "list-disc list-inside space-y-1", children: analysis.concerns.map((concern, idx) => (_jsx("li", { className: "text-sm", children: concern }, idx))) })] })), analysis.recommendations.length > 0 && (_jsxs("div", { children: [_jsx("p", { className: "font-medium mb-1", children: "Recommendations:" }), _jsx("ul", { className: "list-disc list-inside space-y-1", children: analysis.recommendations.map((rec, idx) => (_jsx("li", { className: "text-sm", children: rec }, idx))) })] })), analysis.concerns.length === 0 && analysis.urgentFlags.length === 0 && (_jsx("p", { className: "text-sm", children: "All vital signs appear within normal ranges." }))] })] }) }))] }));
}
