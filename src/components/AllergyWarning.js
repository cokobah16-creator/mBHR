import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { getActiveAllergies, checkMedicationAllergy } from '../services/allergies';
import { ExclamationTriangleIcon } from '@heroicons/react/24/solid';
export function AllergyWarning({ patientId, medicationName }) {
    const [allergies, setAllergies] = useState([]);
    const [medicationConflict, setMedicationConflict] = useState(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        loadAllergies();
    }, [patientId, medicationName]);
    const loadAllergies = async () => {
        setLoading(true);
        const activeAllergies = await getActiveAllergies(patientId);
        setAllergies(activeAllergies);
        if (medicationName) {
            const conflict = await checkMedicationAllergy(patientId, medicationName);
            setMedicationConflict(conflict);
        }
        setLoading(false);
    };
    if (loading)
        return null;
    const severityLevel = medicationConflict?.severity || (allergies.length > 0 ? 'mild' : null);
    if (!severityLevel && allergies.length === 0)
        return null;
    const getSeverityStyles = (severity) => {
        switch (severity) {
            case 'life-threatening':
                return 'bg-red-100 border-red-500 text-red-900';
            case 'severe':
                return 'bg-orange-100 border-orange-500 text-orange-900';
            case 'moderate':
                return 'bg-yellow-100 border-yellow-500 text-yellow-900';
            case 'mild':
                return 'bg-blue-100 border-blue-500 text-blue-900';
            default:
                return 'bg-gray-100 border-gray-500 text-gray-900';
        }
    };
    return (_jsxs("div", { className: "space-y-2", children: [medicationConflict && (_jsx("div", { className: `border-l-4 p-4 rounded ${getSeverityStyles(medicationConflict.severity)} animate-pulse`, role: "alert", children: _jsxs("div", { className: "flex items-start", children: [_jsx(ExclamationTriangleIcon, { className: "h-6 w-6 mr-3 flex-shrink-0" }), _jsxs("div", { className: "flex-1", children: [_jsx("h4", { className: "font-bold text-lg mb-1", children: "MEDICATION ALLERGY ALERT!" }), _jsxs("p", { className: "font-medium mb-2", children: ["Patient is allergic to: ", _jsx("span", { className: "font-bold", children: medicationConflict.allergen })] }), _jsxs("p", { className: "text-sm", children: ["Severity: ", _jsx("span", { className: "font-bold uppercase", children: medicationConflict.severity })] }), medicationConflict.reaction && (_jsxs("p", { className: "text-sm mt-1", children: ["Reaction: ", medicationConflict.reaction] })), medicationConflict.notes && (_jsxs("p", { className: "text-sm mt-1 italic", children: ["Note: ", medicationConflict.notes] }))] })] }) })), !medicationConflict && allergies.length > 0 && (_jsx("div", { className: `border-l-4 p-3 rounded ${getSeverityStyles('mild')}`, children: _jsxs("div", { className: "flex items-start", children: [_jsx(ExclamationTriangleIcon, { className: "h-5 w-5 mr-2 flex-shrink-0" }), _jsxs("div", { className: "flex-1", children: [_jsxs("h4", { className: "font-semibold mb-1", children: ["Patient has ", allergies.length, " known allerg", allergies.length === 1 ? 'y' : 'ies', ":"] }), _jsx("ul", { className: "list-disc list-inside space-y-1", children: allergies.map(allergy => (_jsxs("li", { className: "text-sm", children: [_jsx("span", { className: "font-medium", children: allergy.allergen }), ' ', "(", allergy.allergyType, ", ", allergy.severity, ")", allergy.reaction && ` - ${allergy.reaction}`] }, allergy.id))) })] })] }) }))] }));
}
export function AllergyBadge({ patientId, compact = false }) {
    const [count, setCount] = useState(0);
    const [hasSevere, setHasSevere] = useState(false);
    useEffect(() => {
        loadAllergyCount();
    }, [patientId]);
    const loadAllergyCount = async () => {
        const allergies = await getActiveAllergies(patientId);
        setCount(allergies.length);
        const severe = allergies.some(a => a.severity === 'severe' || a.severity === 'life-threatening');
        setHasSevere(severe);
    };
    if (count === 0)
        return null;
    const colorClass = hasSevere
        ? 'bg-red-100 text-red-800 border-red-300'
        : 'bg-yellow-100 text-yellow-800 border-yellow-300';
    if (compact) {
        return (_jsxs("span", { className: `inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${colorClass}`, children: [_jsx(ExclamationTriangleIcon, { className: "h-3 w-3 mr-1" }), count] }));
    }
    return (_jsxs("div", { className: `inline-flex items-center px-3 py-1.5 rounded-lg border-2 ${colorClass}`, children: [_jsx(ExclamationTriangleIcon, { className: "h-4 w-4 mr-2" }), _jsxs("span", { className: "text-sm font-semibold", children: [count, " Allerg", count === 1 ? 'y' : 'ies'] })] }));
}
