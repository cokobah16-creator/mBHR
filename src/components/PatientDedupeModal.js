import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { mergePatients } from '@/db';
import { useAuthStore } from '@/stores/auth';
import { ExclamationTriangleIcon, UserIcon, PhoneIcon, CalendarIcon, MapPinIcon, XMarkIcon } from '@heroicons/react/24/outline';
export function PatientDedupeModal({ newPatient, candidates, onResolve, onCancel }) {
    const { currentUser } = useAuthStore();
    const [selectedWinner, setSelectedWinner] = useState(null);
    const [loading, setLoading] = useState(false);
    const handleMerge = async () => {
        if (!selectedWinner || !currentUser)
            return;
        setLoading(true);
        try {
            await mergePatients(selectedWinner, newPatient.id, currentUser.id);
            onResolve('merge', selectedWinner);
        }
        catch (error) {
            console.error('Error merging patients:', error);
            alert('Failed to merge patients');
        }
        finally {
            setLoading(false);
        }
    };
    const getMatchScore = (candidate) => {
        let score = 0;
        // Phone match (highest weight)
        if (candidate.phone && newPatient.phone &&
            candidate.phone.replace(/\D/g, '') === newPatient.phone.replace(/\D/g, '')) {
            score += 50;
        }
        // Name similarity
        if (candidate.givenName.toLowerCase() === newPatient.givenName.toLowerCase())
            score += 20;
        if (candidate.familyName.toLowerCase() === newPatient.familyName.toLowerCase())
            score += 20;
        // DOB match
        if (candidate.dob === newPatient.dob)
            score += 30;
        // Sex match
        if (candidate.sex === newPatient.sex)
            score += 10;
        return score;
    };
    const getMatchLabel = (score) => {
        if (score >= 70)
            return { label: 'High Match', color: 'bg-red-100 text-red-800' };
        if (score >= 40)
            return { label: 'Possible Match', color: 'bg-yellow-100 text-yellow-800' };
        return { label: 'Low Match', color: 'bg-gray-100 text-gray-800' };
    };
    const formatField = (value) => {
        if (!value)
            return '—';
        if (value instanceof Date)
            return value.toLocaleDateString();
        return String(value);
    };
    return (_jsx("div", { className: "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50", children: _jsx("div", { className: "bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto", children: _jsxs("div", { className: "p-6", children: [_jsxs("div", { className: "flex items-center justify-between mb-6", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(ExclamationTriangleIcon, { className: "h-8 w-8 text-yellow-600" }), _jsxs("div", { children: [_jsx("h2", { className: "text-xl font-bold text-gray-900", children: "Potential Duplicate Patient" }), _jsx("p", { className: "text-gray-600", children: "We found similar patients. Please review and choose an action." })] })] }), _jsx("button", { onClick: onCancel, className: "p-2 rounded-lg hover:bg-gray-100 transition-colors", children: _jsx(XMarkIcon, { className: "h-6 w-6 text-gray-600" }) })] }), _jsxs("div", { className: "mb-6", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-3", children: "New Patient Being Registered" }), _jsx("div", { className: "bg-blue-50 border border-blue-200 rounded-lg p-4", children: _jsxs("div", { className: "grid grid-cols-2 md:grid-cols-4 gap-4 text-sm", children: [_jsxs("div", { children: [_jsx("span", { className: "font-medium text-blue-800", children: "Name:" }), _jsxs("div", { className: "text-blue-700", children: [newPatient.givenName, " ", newPatient.familyName] })] }), _jsxs("div", { children: [_jsx("span", { className: "font-medium text-blue-800", children: "Phone:" }), _jsx("div", { className: "text-blue-700", children: formatField(newPatient.phone) })] }), _jsxs("div", { children: [_jsx("span", { className: "font-medium text-blue-800", children: "DOB:" }), _jsx("div", { className: "text-blue-700", children: formatField(newPatient.dob) })] }), _jsxs("div", { children: [_jsx("span", { className: "font-medium text-blue-800", children: "Sex:" }), _jsx("div", { className: "text-blue-700", children: formatField(newPatient.sex) })] })] }) })] }), _jsxs("div", { className: "mb-6", children: [_jsxs("h3", { className: "text-lg font-semibold text-gray-900 mb-3", children: ["Existing Patients (", candidates.length, " found)"] }), _jsx("div", { className: "space-y-3", children: candidates.map((candidate) => {
                                    const matchScore = getMatchScore(candidate);
                                    const matchInfo = getMatchLabel(matchScore);
                                    const isSelected = selectedWinner === candidate.id;
                                    return (_jsxs("div", { className: `border rounded-lg p-4 cursor-pointer transition-all ${isSelected
                                            ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                                            : 'border-gray-200 hover:border-gray-300'}`, onClick: () => setSelectedWinner(candidate.id), children: [_jsxs("div", { className: "flex items-start justify-between mb-3", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx("div", { className: "w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center", children: _jsx(UserIcon, { className: "h-5 w-5 text-gray-500" }) }), _jsxs("div", { children: [_jsxs("h4", { className: "font-medium text-gray-900", children: [candidate.givenName, " ", candidate.familyName] }), _jsxs("p", { className: "text-sm text-gray-600", children: ["ID: ", candidate.id.slice(-8).toUpperCase()] })] })] }), _jsxs("span", { className: `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${matchInfo.color}`, children: [matchInfo.label, " (", matchScore, "%)"] })] }), _jsxs("div", { className: "grid grid-cols-2 md:grid-cols-4 gap-4 text-sm", children: [_jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(PhoneIcon, { className: "h-4 w-4 text-gray-400" }), _jsx("span", { className: candidate.phone === newPatient.phone ? 'font-medium text-green-700' : 'text-gray-600', children: formatField(candidate.phone) })] }), _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(CalendarIcon, { className: "h-4 w-4 text-gray-400" }), _jsx("span", { className: candidate.dob === newPatient.dob ? 'font-medium text-green-700' : 'text-gray-600', children: formatField(candidate.dob) })] }), _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx("span", { className: "text-gray-400", children: "Sex:" }), _jsx("span", { className: candidate.sex === newPatient.sex ? 'font-medium text-green-700' : 'text-gray-600', children: formatField(candidate.sex) })] }), _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(MapPinIcon, { className: "h-4 w-4 text-gray-400" }), _jsx("span", { className: "text-gray-600", children: candidate.state })] })] }), _jsxs("div", { className: "mt-2 text-xs text-gray-500", children: ["Registered: ", candidate.createdAt.toLocaleDateString()] })] }, candidate.id));
                                }) })] }), _jsxs("div", { className: "flex space-x-4", children: [_jsx("button", { onClick: () => onResolve('create_new'), className: "btn-secondary flex-1", children: "Create New Patient" }), _jsx("button", { onClick: handleMerge, disabled: !selectedWinner || loading, className: "btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed", children: loading ? 'Merging...' : 'Use Selected Patient' })] }), _jsx("div", { className: "mt-4 text-center", children: _jsx("p", { className: "text-xs text-gray-500", children: "Selecting an existing patient will link this registration to their record." }) })] }) }) }));
}
