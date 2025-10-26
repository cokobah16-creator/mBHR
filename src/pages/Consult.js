import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState, startTransition } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PatientSearch } from '@/components/PatientSearch';
import { SoapForm } from '@/components/SoapForm';
import { db, generateId } from '@/db';
import { getFlagColor, getFlagLabel } from '@/utils/vitals';
import { ArrowLeftIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
export function Consult() {
    const { visitId } = useParams();
    const navigate = useNavigate();
    const [visit, setVisit] = useState(null);
    const [patient, setPatient] = useState(null);
    const [selectedPatient, setSelectedPatient] = useState(null);
    const [vitals, setVitals] = useState([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (visitId) {
            loadVisitData(visitId);
        }
        else {
            setLoading(false);
        }
    }, [visitId]);
    const loadVisitData = async (id) => {
        try {
            const visitData = await db.visits.get(id);
            if (visitData) {
                setVisit(visitData);
                const [patientData, vitalsData] = await Promise.all([
                    db.patients.get(visitData.patientId),
                    db.vitals.where('visitId').equals(id).toArray()
                ]);
                setPatient(patientData || null);
                setVitals(vitalsData);
            }
        }
        catch (error) {
            console.error('Error loading visit data:', error);
        }
        finally {
            setLoading(false);
        }
    };
    const handlePatientSelect = async (selectedPatient) => {
        try {
            // Create a new visit for this patient
            const newVisit = {
                id: generateId(),
                patientId: selectedPatient.id,
                startedAt: new Date(),
                siteName: 'Mobile Clinic',
                status: 'open'
            };
            await db.visits.add(newVisit);
            // Load vitals for this patient
            const vitalsData = await db.vitals.where('patientId').equals(selectedPatient.id).toArray();
            setPatient(selectedPatient);
            setVisit(newVisit);
            setVitals(vitalsData);
            setSelectedPatient(selectedPatient);
        }
        catch (error) {
            console.error('Error creating visit:', error);
        }
    };
    const handleSuccess = () => {
        // Navigate to pharmacy or back to queue
        startTransition(() => {
            if (visit) {
                navigate(`/pharmacy/${visit.id}`);
            }
            else {
                navigate('/queue');
            }
        });
    };
    const handleCancel = () => {
        startTransition(() => {
            navigate('/queue');
        });
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
    // If no visitId provided, show patient search
    if (!visitId && !selectedPatient) {
        return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-4", children: [_jsx("button", { onClick: () => navigate('/queue'), className: "p-2 rounded-lg hover:bg-gray-100 transition-colors touch-target", children: _jsx(ArrowLeftIcon, { className: "h-6 w-6 text-gray-600" }) }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Consultation" }), _jsx("p", { className: "text-gray-600", children: "Search for a patient to start consultation" })] })] }), _jsxs("div", { className: "card max-w-2xl mx-auto", children: [_jsx("h2", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Select Patient" }), _jsx(PatientSearch, { onPatientSelect: handlePatientSelect, placeholder: "Search patients by name or phone...", className: "w-full" })] })] }));
    }
    if (loading) {
        return (_jsx("div", { className: "flex items-center justify-center py-12", children: _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" }), _jsx("p", { className: "mt-4 text-gray-600", children: "Loading consultation..." })] }) }));
    }
    if (!visit || !patient) {
        return (_jsxs("div", { className: "text-center py-12", children: [_jsx(DocumentTextIcon, { className: "h-12 w-12 mx-auto text-gray-400 mb-4" }), _jsx("h3", { className: "text-lg font-medium text-gray-900 mb-2", children: "Visit not found" }), _jsx("p", { className: "text-gray-600 mb-6", children: "The visit you're looking for doesn't exist." }), _jsx("button", { onClick: () => navigate('/queue'), className: "btn-primary", children: "Back to Queue" })] }));
    }
    const latestVitals = vitals[vitals.length - 1];
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-4", children: [_jsx("button", { onClick: () => navigate('/queue'), className: "p-2 rounded-lg hover:bg-gray-100 transition-colors touch-target", children: _jsx(ArrowLeftIcon, { className: "h-6 w-6 text-gray-600" }) }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Consultation" }), _jsxs("p", { className: "text-gray-600", children: ["Patient: ", patient.givenName, " ", patient.familyName] })] })] }), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-6", children: [_jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Patient Information" }), _jsxs("div", { className: "flex items-center space-x-4 mb-4", children: [patient.photoUrl ? (_jsx("img", { src: patient.photoUrl, alt: `${patient.givenName} ${patient.familyName}`, className: "w-16 h-16 rounded-full object-cover" })) : (_jsx("div", { className: "w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center", children: _jsxs("span", { className: "text-xl font-medium text-gray-600", children: [patient.givenName[0], patient.familyName[0]] }) })), _jsxs("div", { children: [_jsxs("h4", { className: "text-lg font-medium text-gray-900", children: [patient.givenName, " ", patient.familyName] }), _jsxs("p", { className: "text-sm text-gray-600", children: ["Age: ", getPatientAge(patient.dob), " \u2022 ", patient.sex, " \u2022 ", patient.phone] })] })] }), _jsxs("div", { className: "text-sm text-gray-600", children: [_jsxs("p", { children: [_jsx("strong", { children: "Address:" }), " ", patient.address] }), _jsxs("p", { children: [_jsx("strong", { children: "State/LGA:" }), " ", patient.state, ", ", patient.lga] })] })] }), _jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Current Vitals" }), latestVitals ? (_jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "grid grid-cols-2 gap-4 text-sm", children: [latestVitals.heightCm && (_jsxs("div", { children: [_jsx("span", { className: "text-gray-600", children: "Height:" }), _jsxs("span", { className: "ml-2 font-medium", children: [latestVitals.heightCm, " cm"] })] })), latestVitals.weightKg && (_jsxs("div", { children: [_jsx("span", { className: "text-gray-600", children: "Weight:" }), _jsxs("span", { className: "ml-2 font-medium", children: [latestVitals.weightKg, " kg"] })] })), latestVitals.bmi && (_jsxs("div", { children: [_jsx("span", { className: "text-gray-600", children: "BMI:" }), _jsx("span", { className: "ml-2 font-medium", children: latestVitals.bmi })] })), latestVitals.tempC && (_jsxs("div", { children: [_jsx("span", { className: "text-gray-600", children: "Temperature:" }), _jsxs("span", { className: "ml-2 font-medium", children: [latestVitals.tempC, "\u00B0C"] })] })), latestVitals.pulseBpm && (_jsxs("div", { children: [_jsx("span", { className: "text-gray-600", children: "Pulse:" }), _jsxs("span", { className: "ml-2 font-medium", children: [latestVitals.pulseBpm, " bpm"] })] })), latestVitals.systolic && latestVitals.diastolic && (_jsxs("div", { children: [_jsx("span", { className: "text-gray-600", children: "Blood Pressure:" }), _jsxs("span", { className: "ml-2 font-medium", children: [latestVitals.systolic, "/", latestVitals.diastolic] })] })), latestVitals.spo2 && (_jsxs("div", { children: [_jsx("span", { className: "text-gray-600", children: "SpO2:" }), _jsxs("span", { className: "ml-2 font-medium", children: [latestVitals.spo2, "%"] })] }))] }), latestVitals.flags.length > 0 && (_jsxs("div", { children: [_jsx("p", { className: "text-sm font-medium text-gray-700 mb-2", children: "Alerts:" }), _jsx("div", { className: "flex flex-wrap gap-2", children: latestVitals.flags.map((flag) => (_jsx("span", { className: `px-2 py-1 rounded-full text-xs font-medium ${getFlagColor(flag)}`, children: getFlagLabel(flag) }, flag))) })] }))] })) : (_jsx("p", { className: "text-gray-500 text-sm", children: "No vitals recorded for this visit" }))] })] }), _jsx(SoapForm, { patientId: patient.id, visitId: visit.id, onSuccess: handleSuccess, onCancel: handleCancel })] }));
}
