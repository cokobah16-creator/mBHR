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
    const [error, setError] = useState('');
    async function handleAddToQueue() {
        if (!selectedPatient) {
            setError('Please select a patient');
            return;
        }
        setLoading(true);
        setSuccess(false);
        setError('');
        try {
            // Check if patient is already in queue
            const existing = await db.queue
                .where('patientId')
                .equals(selectedPatient.id)
                .and(item => item.status !== 'done')
                .first();
            if (existing) {
                setError(`Patient is already in queue at ${existing.stage} stage`);
                setLoading(false);
                return;
            }
            // Add to queue
            await queueManagement.addToQueue(selectedPatient.id, stage, 'normal');
            setSuccess(true);
            setTimeout(() => {
                setSuccess(false);
                setSelectedPatient(null);
                setError('');
            }, 2000);
        }
        catch (err) {
            console.error('Error adding to queue:', err);
            setError('Failed to add patient to queue. Please try again.');
        }
        finally {
            setLoading(false);
        }
    }
    return (_jsxs("div", { className: "p-4 space-y-6 max-w-4xl mx-auto", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(TicketIcon, { className: "h-8 w-8 text-blue-600" }), _jsx("h2", { className: "text-2xl font-bold text-gray-900", children: "Add Patient to Queue" })] }), _jsx("button", { onClick: () => navigate('/queue'), className: "btn-secondary text-sm", children: "View Queue" })] }), error && (_jsx("div", { className: "bg-red-50 border border-red-200 rounded-lg p-4", children: _jsx("p", { className: "text-red-800 text-sm", children: error }) })), success ? (_jsxs("div", { className: "bg-white rounded-lg shadow-sm p-8 text-center", children: [_jsx(CheckCircleIcon, { className: "h-16 w-16 text-green-500 mx-auto mb-4" }), _jsx("h3", { className: "text-xl font-semibold text-gray-900 mb-2", children: "Patient Added to Queue" }), _jsxs("p", { className: "text-gray-600", children: [selectedPatient?.givenName, " ", selectedPatient?.familyName, " has been added to the ", stage, " queue"] })] })) : (_jsx("div", { className: "bg-white rounded-lg shadow-sm p-6", children: _jsxs("div", { className: "space-y-6", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Select Patient *" }), selectedPatient ? (_jsxs("div", { className: "flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [selectedPatient.photoUrl ? (_jsx("img", { src: selectedPatient.photoUrl, alt: `${selectedPatient.givenName} ${selectedPatient.familyName}`, className: "w-12 h-12 rounded-full object-cover" })) : (_jsx("div", { className: "w-12 h-12 rounded-full bg-green-200 flex items-center justify-center", children: _jsx(UserIcon, { className: "h-6 w-6 text-green-700" }) })), _jsxs("div", { children: [_jsxs("div", { className: "font-semibold text-gray-900", children: [selectedPatient.givenName, " ", selectedPatient.familyName] }), _jsxs("div", { className: "text-sm text-gray-600", children: [selectedPatient.sex, " \u2022 ", selectedPatient.dob] }), _jsx("div", { className: "text-sm text-gray-600", children: selectedPatient.phone })] })] }), _jsx("button", { onClick: () => {
                                                setSelectedPatient(null);
                                                setError('');
                                            }, className: "btn-secondary text-sm", children: "Change" })] })) : (_jsxs("div", { children: [_jsx(PatientSearch, { onPatientSelect: (patient) => {
                                                setSelectedPatient(patient);
                                                setError('');
                                            }, placeholder: "Search by name or phone..." }), _jsx("p", { className: "text-sm text-gray-500 mt-1", children: "Start typing to search for a patient" })] }))] }), selectedPatient && (_jsxs(_Fragment, { children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Add to Stage *" }), _jsxs("select", { value: stage, onChange: (e) => setStage(e.target.value), className: "w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500", children: [_jsx("option", { value: "registration", children: "Registration" }), _jsx("option", { value: "vitals", children: "Vitals (Recommended)" }), _jsx("option", { value: "consult", children: "Consultation" }), _jsx("option", { value: "pharmacy", children: "Pharmacy" })] }), _jsx("p", { className: "text-sm text-gray-500 mt-1", children: "Select which stage to add the patient to" })] }), _jsxs("div", { className: "bg-blue-50 border border-blue-200 rounded-lg p-4", children: [_jsx("h4", { className: "font-medium text-blue-900 mb-2", children: "What happens next?" }), _jsxs("p", { className: "text-sm text-blue-800", children: [stage === 'registration' && 'Patient will be added to registration queue and wait to be registered.', stage === 'vitals' && 'Patient will be added to vitals queue and wait for vital signs to be recorded. After vitals are recorded, they will automatically move to consultation.', stage === 'consult' && 'Patient will be added to consultation queue and appear in the Doctor Station immediately.', stage === 'pharmacy' && 'Patient will be added to pharmacy queue and wait for medication dispensing.'] })] }), _jsx("button", { onClick: handleAddToQueue, disabled: loading, className: `w-full py-3 px-4 rounded-lg font-medium text-white transition-colors ${loading
                                        ? 'bg-gray-400 cursor-not-allowed'
                                        : 'bg-blue-600 hover:bg-blue-700'}`, children: loading ? (_jsxs("span", { className: "flex items-center justify-center", children: [_jsxs("svg", { className: "animate-spin h-5 w-5 mr-2", viewBox: "0 0 24 24", children: [_jsx("circle", { className: "opacity-25", cx: "12", cy: "12", r: "10", stroke: "currentColor", strokeWidth: "4", fill: "none" }), _jsx("path", { className: "opacity-75", fill: "currentColor", d: "M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" })] }), "Adding to Queue..."] })) : (`Add to ${stage.charAt(0).toUpperCase() + stage.slice(1)} Queue`) })] }))] }) })), _jsxs("div", { className: "bg-white rounded-lg shadow-sm p-6", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Current Queue Status" }), _jsx(QueueStats, {})] })] }));
}
function QueueStats() {
    const [stats, setStats] = useState({
        registration: 0,
        vitals: 0,
        consult: 0,
        pharmacy: 0
    });
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        loadStats();
        const interval = setInterval(loadStats, 5000);
        return () => clearInterval(interval);
    }, []);
    async function loadStats() {
        try {
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
        catch (err) {
            console.error('Error loading queue stats:', err);
        }
        finally {
            setLoading(false);
        }
    }
    const stageColors = {
        registration: 'bg-blue-100 text-blue-800 border-blue-200',
        vitals: 'bg-green-100 text-green-800 border-green-200',
        consult: 'bg-purple-100 text-purple-800 border-purple-200',
        pharmacy: 'bg-orange-100 text-orange-800 border-orange-200'
    };
    if (loading) {
        return (_jsx("div", { className: "text-center py-8 text-gray-500", children: "Loading queue statistics..." }));
    }
    return (_jsx("div", { className: "grid grid-cols-2 md:grid-cols-4 gap-4", children: stages.map(stage => (_jsxs("div", { className: "text-center", children: [_jsx("div", { className: `text-3xl font-bold ${stageColors[stage]} border-2 rounded-lg py-6`, children: stats[stage] }), _jsx("div", { className: "text-sm text-gray-700 mt-2 font-medium capitalize", children: stage })] }, stage))) }));
}
