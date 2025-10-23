import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/hooks/useT';
import { useAuthStore } from '@/stores/auth';
import { db, generateId } from '@/db';
import { ExclamationTriangleIcon, HeartIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
export default function QuickTriage({ patientId, onComplete, onCancel }) {
    const { t } = useT();
    const { currentUser } = useAuthStore();
    const navigate = useNavigate();
    const [selectedPriority, setSelectedPriority] = useState(null);
    const [chiefComplaint, setChiefComplaint] = useState('');
    const [abcAssessment, setAbcAssessment] = useState({
        airway: 'clear',
        breathing: 'normal',
        circulation: 'normal'
    });
    const [vitalSigns, setVitalSigns] = useState({
        conscious: true,
        responsive: true,
        skinColor: 'normal',
        temperature: 'normal'
    });
    const [loading, setLoading] = useState(false);
    const priorityOptions = [
        {
            value: 'urgent',
            label: t('triage.priority.urgent'),
            description: 'Immediate attention required',
            color: 'bg-red-500 hover:bg-red-600 text-white',
            icon: '🚨',
            examples: ['Chest pain', 'Difficulty breathing', 'Unconscious', 'Severe bleeding']
        },
        {
            value: 'normal',
            label: t('triage.priority.normal'),
            description: 'Standard care pathway',
            color: 'bg-yellow-500 hover:bg-yellow-600 text-white',
            icon: '⚠️',
            examples: ['Fever', 'Cough', 'Minor injuries', 'Routine check-up']
        },
        {
            value: 'low',
            label: t('triage.priority.low'),
            description: 'Can wait for routine care',
            color: 'bg-green-500 hover:bg-green-600 text-white',
            icon: '✅',
            examples: ['Minor cuts', 'Prescription refills', 'Health education']
        }
    ];
    const abcOptions = {
        airway: [
            { value: 'clear', label: 'Clear', safe: true },
            { value: 'partial', label: 'Partially obstructed', safe: false },
            { value: 'obstructed', label: 'Obstructed', safe: false }
        ],
        breathing: [
            { value: 'normal', label: 'Normal', safe: true },
            { value: 'labored', label: 'Labored', safe: false },
            { value: 'absent', label: 'Absent/Minimal', safe: false }
        ],
        circulation: [
            { value: 'normal', label: 'Normal pulse', safe: true },
            { value: 'weak', label: 'Weak pulse', safe: false },
            { value: 'absent', label: 'No pulse', safe: false }
        ]
    };
    const calculateSuggestedPriority = () => {
        // ABC assessment takes priority
        if (abcAssessment.airway !== 'clear' ||
            abcAssessment.breathing !== 'normal' ||
            abcAssessment.circulation !== 'normal') {
            return 'urgent';
        }
        // Consciousness check
        if (!vitalSigns.conscious || !vitalSigns.responsive) {
            return 'urgent';
        }
        // Temperature check
        if (vitalSigns.temperature === 'high') {
            return 'normal';
        }
        // Skin color check
        if (vitalSigns.skinColor !== 'normal') {
            return 'urgent';
        }
        // Chief complaint keywords
        const urgentKeywords = ['chest pain', 'difficulty breathing', 'severe pain', 'bleeding', 'unconscious'];
        const complaint = chiefComplaint.toLowerCase();
        if (urgentKeywords.some(keyword => complaint.includes(keyword))) {
            return 'urgent';
        }
        return 'normal';
    };
    const suggestedPriority = calculateSuggestedPriority();
    const handleSubmit = async () => {
        if (!selectedPriority || !currentUser)
            return;
        setLoading(true);
        try {
            // Create triage record
            const triageRecord = {
                id: generateId(),
                patientId: patientId || 'walk-in',
                assessedBy: currentUser.id,
                priority: selectedPriority,
                chiefComplaint,
                abcAssessment: JSON.stringify(abcAssessment),
                vitalSigns: JSON.stringify(vitalSigns),
                suggestedPriority,
                overriddenPriority: selectedPriority !== suggestedPriority,
                createdAt: new Date(),
                _dirty: 1
            };
            // Store in triage samples for training data
            await db.triageSamples.add({
                id: generateId(),
                createdAt: new Date(),
                caseHash: btoa(JSON.stringify({ chiefComplaint, abcAssessment, vitalSigns })),
                goldPriority: selectedPriority,
                createdBy: currentUser.id
            });
            // Determine next queue stage based on priority
            let queueStage = 'vitals';
            if (selectedPriority === 'urgent') {
                queueStage = 'consult'; // Skip vitals for urgent cases
            }
            onComplete?.(selectedPriority, queueStage);
        }
        catch (error) {
            console.error('Error saving triage assessment:', error);
            alert('Failed to save triage assessment');
        }
        finally {
            setLoading(false);
        }
    };
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(ExclamationTriangleIcon, { className: "h-8 w-8 text-primary" }), _jsxs("div", { children: [_jsx("h2", { className: "text-2xl font-bold text-gray-900", children: "Quick Triage Assessment" }), _jsx("p", { className: "text-gray-600", children: "Rapid priority assessment for patient flow" })] })] }), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-6", children: [_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-medium text-gray-900 mb-4", children: "Chief Complaint" }), _jsx("textarea", { value: chiefComplaint, onChange: (e) => setChiefComplaint(e.target.value), className: "input-field", rows: 3, placeholder: "What is the main problem? (e.g., chest pain, fever, cough)" })] }), _jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-medium text-gray-900 mb-4", children: "ABC Assessment" }), _jsx("div", { className: "space-y-4", children: Object.entries(abcOptions).map(([category, options]) => (_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2 capitalize", children: category }), _jsx("div", { className: "grid grid-cols-1 gap-2", children: options.map((option) => (_jsx("button", { onClick: () => setAbcAssessment(prev => ({ ...prev, [category]: option.value })), className: `p-3 rounded-lg border text-left transition-all ${abcAssessment[category] === option.value
                                                            ? option.safe
                                                                ? 'border-green-300 bg-green-50 text-green-800'
                                                                : 'border-red-300 bg-red-50 text-red-800'
                                                            : 'border-gray-200 hover:border-gray-300'}`, children: _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx("div", { className: `w-3 h-3 rounded-full ${option.safe ? 'bg-green-500' : 'bg-red-500'}` }), _jsx("span", { className: "font-medium", children: option.label })] }) }, option.value))) })] }, category))) })] }), _jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-medium text-gray-900 mb-4", children: "Quick Vital Assessment" }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Conscious" }), _jsxs("div", { className: "flex space-x-2", children: [_jsx("button", { onClick: () => setVitalSigns(prev => ({ ...prev, conscious: true })), className: `flex-1 p-2 rounded-lg border ${vitalSigns.conscious
                                                                            ? 'border-green-300 bg-green-50 text-green-800'
                                                                            : 'border-gray-200'}`, children: "Yes" }), _jsx("button", { onClick: () => setVitalSigns(prev => ({ ...prev, conscious: false })), className: `flex-1 p-2 rounded-lg border ${!vitalSigns.conscious
                                                                            ? 'border-red-300 bg-red-50 text-red-800'
                                                                            : 'border-gray-200'}`, children: "No" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Responsive" }), _jsxs("div", { className: "flex space-x-2", children: [_jsx("button", { onClick: () => setVitalSigns(prev => ({ ...prev, responsive: true })), className: `flex-1 p-2 rounded-lg border ${vitalSigns.responsive
                                                                            ? 'border-green-300 bg-green-50 text-green-800'
                                                                            : 'border-gray-200'}`, children: "Yes" }), _jsx("button", { onClick: () => setVitalSigns(prev => ({ ...prev, responsive: false })), className: `flex-1 p-2 rounded-lg border ${!vitalSigns.responsive
                                                                            ? 'border-red-300 bg-red-50 text-red-800'
                                                                            : 'border-gray-200'}`, children: "No" })] })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Skin Color" }), _jsx("div", { className: "grid grid-cols-3 gap-2", children: [
                                                            { value: 'normal', label: 'Normal', safe: true },
                                                            { value: 'pale', label: 'Pale', safe: false },
                                                            { value: 'cyanotic', label: 'Blue/Gray', safe: false }
                                                        ].map((option) => (_jsx("button", { onClick: () => setVitalSigns(prev => ({ ...prev, skinColor: option.value })), className: `p-2 rounded-lg border text-center ${vitalSigns.skinColor === option.value
                                                                ? option.safe
                                                                    ? 'border-green-300 bg-green-50 text-green-800'
                                                                    : 'border-red-300 bg-red-50 text-red-800'
                                                                : 'border-gray-200 hover:border-gray-300'}`, children: option.label }, option.value))) })] })] })] })] }), _jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "card bg-blue-50 border-blue-200", children: [_jsxs("div", { className: "flex items-center space-x-2 mb-3", children: [_jsx(HeartIcon, { className: "h-5 w-5 text-blue-600" }), _jsx("h3", { className: "font-medium text-blue-800", children: "AI Suggestion" })] }), _jsxs("div", { className: "flex items-center space-x-3", children: [_jsx("div", { className: "text-2xl", children: suggestedPriority === 'urgent' ? '🚨' :
                                                    suggestedPriority === 'normal' ? '⚠️' : '✅' }), _jsxs("div", { children: [_jsxs("div", { className: "font-medium text-blue-800 capitalize", children: [suggestedPriority, " Priority"] }), _jsx("div", { className: "text-sm text-blue-600", children: "Based on ABC assessment and symptoms" })] })] })] }), _jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-medium text-gray-900 mb-4", children: "Assign Priority" }), _jsx("div", { className: "space-y-4", children: priorityOptions.map((option) => (_jsx("button", { onClick: () => setSelectedPriority(option.value), className: `w-full p-4 rounded-xl border-2 transition-all touch-target-large ${selectedPriority === option.value
                                                ? `${option.color} ring-2 ring-primary/20`
                                                : 'bg-white border-gray-200 hover:border-gray-300'}`, children: _jsxs("div", { className: "flex items-center space-x-4", children: [_jsx("div", { className: "text-3xl", children: option.icon }), _jsxs("div", { className: "text-left flex-1", children: [_jsx("div", { className: "text-lg font-bold", children: option.label }), _jsx("div", { className: "text-sm opacity-90", children: option.description }), _jsxs("div", { className: "text-xs opacity-75 mt-1", children: ["Examples: ", option.examples.slice(0, 2).join(', ')] })] }), selectedPriority === option.value && (_jsx(CheckCircleIcon, { className: "h-6 w-6" }))] }) }, option.value))) })] }), selectedPriority && selectedPriority !== suggestedPriority && (_jsx("div", { className: "bg-yellow-50 border border-yellow-200 rounded-lg p-4", children: _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(ExclamationTriangleIcon, { className: "h-5 w-5 text-yellow-600" }), _jsxs("div", { children: [_jsx("h4", { className: "font-medium text-yellow-800", children: "Priority Override" }), _jsxs("p", { className: "text-sm text-yellow-700", children: ["You selected ", selectedPriority, " but AI suggests ", suggestedPriority, ". Please confirm your clinical judgment."] })] })] }) })), _jsxs("div", { className: "flex space-x-4", children: [_jsx("button", { onClick: handleSubmit, disabled: !selectedPriority || loading, className: "btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed", children: loading ? 'Saving...' : 'Complete Triage' }), onCancel && (_jsx("button", { onClick: onCancel, className: "btn-secondary", children: "Cancel" }))] })] })] })] }));
}
