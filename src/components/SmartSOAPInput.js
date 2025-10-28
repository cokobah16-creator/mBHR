import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { clinicalDecisionSupport } from '@/services/clinicalDecisionSupport';
import { LightBulbIcon, SparklesIcon } from '@heroicons/react/24/outline';
export function SmartSOAPInput({ section, value, onChange, label, placeholder, patientAge, patientSex, vitalSigns }) {
    const [suggestions, setSuggestions] = useState(null);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    useEffect(() => {
        if (value.length > 10) {
            generateSuggestions();
        }
    }, [value]);
    const generateSuggestions = async () => {
        try {
            setIsGenerating(true);
            const result = clinicalDecisionSupport.generateSOAPSuggestions({
                section,
                partialText: value,
                patientAge,
                patientSex,
                vitalSigns
            });
            setSuggestions(result);
        }
        catch (error) {
            console.error('Failed to generate suggestions:', error);
        }
        finally {
            setIsGenerating(false);
        }
    };
    const applySuggestion = (suggestion) => {
        const currentValue = value.trim();
        const newValue = currentValue
            ? `${currentValue}\n${suggestion}`
            : suggestion;
        onChange(newValue);
        setShowSuggestions(false);
    };
    const hasRelevantSuggestions = suggestions && suggestions.suggestions.length > 0;
    return (_jsxs("div", { className: "space-y-2", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: label }), hasRelevantSuggestions && (_jsxs("button", { type: "button", onClick: () => setShowSuggestions(!showSuggestions), className: "text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1", children: [_jsx(SparklesIcon, { className: "h-4 w-4" }), showSuggestions ? 'Hide' : 'Show', " AI Suggestions"] }))] }), _jsx("textarea", { value: value, onChange: (e) => onChange(e.target.value), placeholder: placeholder, rows: 6, className: "w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" }), showSuggestions && hasRelevantSuggestions && (_jsxs("div", { className: "bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3", children: [_jsxs("div", { className: "flex items-center gap-2 text-sm font-medium text-blue-900", children: [_jsx(LightBulbIcon, { className: "h-5 w-5" }), "AI-Powered Suggestions", suggestions.confidence && (_jsxs("span", { className: "text-xs text-blue-600", children: ["(", Math.round(suggestions.confidence * 100), "% confidence)"] }))] }), _jsx("div", { className: "space-y-2", children: suggestions.suggestions.map((suggestion, idx) => (_jsx("div", { className: "bg-white rounded-md p-3 border border-blue-200 hover:border-blue-400 transition-colors cursor-pointer", onClick: () => applySuggestion(suggestion), children: _jsx("p", { className: "text-sm text-gray-700", children: suggestion }) }, idx))) }), suggestions.keywords.length > 0 && (_jsxs("div", { className: "text-xs text-blue-700", children: ["Based on: ", suggestions.keywords.join(', ')] })), _jsx("p", { className: "text-xs text-blue-600", children: "Click any suggestion to add it to your note" })] })), isGenerating && (_jsxs("div", { className: "flex items-center gap-2 text-sm text-gray-500", children: [_jsx("div", { className: "animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full" }), "Analyzing and generating suggestions..."] }))] }));
}
