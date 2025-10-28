import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '@/db';
import { queueManagement } from '@/services/queueManagement';
import { PatientSearch } from '@/components/PatientSearch';
import { TicketIcon, UserIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
const stages = ['registration', 'vitals', 'consult', 'pharmacy'];
export default function TicketIssuer() {
    const navigate = useNavigate();
    const [selectedPatient, setSelectedPatient] = useState(null);
    const [stage, setStage] = useState('vitals');
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    async function handleAddToQueue() {
        if (!selectedPatient)
            return;
        setLoading(true);
        setSuccess(false);
        try {
            // Check if patient is already in queue
            const existing = await db.queue
                .where('patientId')
                .equals(selectedPatient.id)
                .and(item => item.status !== 'done')
                .first();
            if (existing) {
                alert(`⚠️ Patient is already in queue at ${existing.stage} stage`);
                setLoading(false);
                return;
            }
            // Add to queue
            await queueManagement.addToQueue(selectedPatient.id, stage, 'normal');
            setSuccess(true);
            setTimeout(() => {
                setSuccess(false);
                setSelectedPatient(null);
            }, 2000);
        }
        catch (error) {
            console.error('Error adding to queue:', error);
            alert('❌ Failed to add patient to queue');
        }
        finally {
            setLoading(false);
        }
    }
    return (_jsxs("div", { className: "p-4 space-y-6", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(TicketIcon, { className: "h-8 w-8 text-primary" }), _jsx("h2", { className: "text-2xl font-bold text-gray-900", children: "Add Patient to Queue" })] }), _jsx("button", { onClick: () => navigate('/queue'), className: "btn-secondary text-sm", children: "View Queue" })] }), success ? (_jsxs("div", { className: "card max-w-2xl text-center py-12", children: [_jsx(CheckCircleIcon, { className: "h-16 w-16 text-green-500 mx-auto mb-4" }), _jsx("h3", { className: "text-xl font-semibold text-gray-900 mb-2", children: "Patient Added to Queue" }), _jsxs("p", { className: "text-gray-600", children: [selectedPatient?.givenName, " ", selectedPatient?.familyName, " has been added to the ", stage, " queue"] })] })) : (_jsx("div", { className: "card max-w-2xl", children: _jsxs("div", { className: "space-y-6", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Select Patient" }), selectedPatient ? (_jsxs("div", { className: "flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx("div", { className: "w-12 h-12 rounded-full bg-green-200 flex items-center justify-center", children: _jsx(UserIcon, { className: "h-6 w-6 text-green-700" }) }), _jsxs("div", { children: [_jsxs("div", { className: "font-semibold text-gray-900", children: [selectedPatient.givenName, " ", selectedPatient.familyName] }), _jsxs("div", { className: "text-sm text-gray-600", children: [selectedPatient.sex, " \u2022 ", selectedPatient.dob] }), _jsx("div", { className: "text-sm text-gray-600", children: selectedPatient.phone })] })] }), _jsx("button", { onClick: () => setSelectedPatient(null), className: "btn-secondary text-sm", children: "Change" })] })) : (_jsx(PatientSearch, { onPatientSelect: setSelectedPatient, placeholder: "Search by name or phone..." }))] }), selectedPatient && (_jsxs(_Fragment, { children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Add to Stage" }), _jsxs("select", { value: stage, onChange: (e) => setStage(e.target.value), className: "input-field", children: [_jsx("option", { value: "registration", children: "Registration" }), _jsx("option", { value: "vitals", children: "Vitals" }), _jsx("option", { value: "consult", children: "Consultation" }), _jsx("option", { value: "pharmacy", children: "Pharmacy" })] }), _jsx("p", { className: "text-sm text-gray-500 mt-1", children: "Select which stage to add the patient to" })] }), _jsxs("div", { className: "bg-blue-50 border border-blue-200 rounded-lg p-4", children: [_jsx("h4", { className: "font-medium text-blue-900 mb-2", children: "What happens next?" }), _jsxs("p", { className: "text-sm text-blue-800", children: [stage === 'registration' && 'Patient will be added to registration queue and wait to be registered.', stage === 'vitals' && 'Patient will be added to vitals queue and wait for vital signs to be recorded.', stage === 'consult' && 'Patient will be added to consultation queue and appear in the Doctor Station.', stage === 'pharmacy' && 'Patient will be added to pharmacy queue and wait for medication dispensing.'] })] }), _jsx("button", { onClick: handleAddToQueue, disabled: loading, className: "btn-primary w-full", children: loading ? 'Adding to Queue...' : `Add to ${stage.charAt(0).toUpperCase() + stage.slice(1)} Queue` })] }))] }) })), _jsxs("div", { className: "card max-w-2xl", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Current Queue Status" }), _jsx(QueueStats, {})] })] }));
}
function QueueStats() {
    const [stats, setStats] = useState({
        registration: 0,
        vitals: 0,
        consult: 0,
        pharmacy: 0
    });
    useEffect(() => {
        loadStats();
        const interval = setInterval(loadStats, 5000);
        return () => clearInterval(interval);
    }, []);
    async function loadStats() {
        const counts = {
            registration: 0,
            vitals: 0,
            consult: 0,
            pharmacy: 0
        };
        for (const stage of stages) {
            const items = await db.queue
                .where('stage')
                .equals(stage)
                .and(item => item.status !== 'done')
                .toArray();
            counts[stage] = items.length;
        }
        setStats(counts);
    }
    const stageColors = {
        registration: 'bg-blue-100 text-blue-800',
        vitals: 'bg-green-100 text-green-800',
        consult: 'bg-purple-100 text-purple-800',
        pharmacy: 'bg-orange-100 text-orange-800'
    };
    return (_jsx("div", { className: "grid grid-cols-2 md:grid-cols-4 gap-4", children: stages.map(stage => (_jsxs("div", { className: "text-center", children: [_jsx("div", { className: `text-2xl font-bold ${stageColors[stage]} rounded-lg py-4`, children: stats[stage] }), _jsx("div", { className: "text-sm text-gray-600 mt-2 capitalize", children: stage })] }, stage))) }));
}
