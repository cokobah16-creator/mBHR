import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PatientSearch } from '@/components/PatientSearch';
import { DispenseForm } from '@/components/DispenseForm';
import { db, generateId } from '@/db';
import { ArrowLeftIcon, BeakerIcon } from '@heroicons/react/24/outline';
export function Pharmacy() {
    const { visitId } = useParams();
    const navigate = useNavigate();
    const [visit, setVisit] = useState(null);
    const [patient, setPatient] = useState(null);
    const [selectedPatient, setSelectedPatient] = useState(null);
    const [consultation, setConsultation] = useState(null);
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
                const [patientData, consultationData] = await Promise.all([
                    db.patients.get(visitData.patientId),
                    db.consultations.where('visitId').equals(id).first()
                ]);
                setPatient(patientData || null);
                setConsultation(consultationData || null);
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
            // Load consultation for this patient (most recent)
            const consultationData = await db.consultations
                .where('patientId')
                .equals(selectedPatient.id)
                .reverse()
                .first();
            setPatient(selectedPatient);
            setVisit(newVisit);
            setConsultation(consultationData || null);
            setSelectedPatient(selectedPatient);
        }
        catch (error) {
            console.error('Error creating visit:', error);
        }
    };
    const handleSuccess = () => {
        // Complete the visit and return to queue
        navigate('/queue', {
            state: {
                message: 'Medication dispensed successfully!'
            }
        });
    };
    const handleCancel = () => {
        navigate('/queue');
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
        return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-4", children: [_jsx("button", { onClick: () => navigate('/queue'), className: "p-2 rounded-lg hover:bg-gray-100 transition-colors touch-target", children: _jsx(ArrowLeftIcon, { className: "h-6 w-6 text-gray-600" }) }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Pharmacy" }), _jsx("p", { className: "text-gray-600", children: "Search for a patient to dispense medication" })] })] }), _jsxs("div", { className: "card max-w-2xl mx-auto", children: [_jsx("h2", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Select Patient" }), _jsx(PatientSearch, { onPatientSelect: handlePatientSelect, placeholder: "Search patients by name or phone...", className: "w-full" })] })] }));
    }
    if (loading) {
        return (_jsx("div", { className: "flex items-center justify-center py-12", children: _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" }), _jsx("p", { className: "mt-4 text-gray-600", children: "Loading pharmacy..." })] }) }));
    }
    if (!visit || !patient) {
        return (_jsxs("div", { className: "text-center py-12", children: [_jsx(BeakerIcon, { className: "h-12 w-12 mx-auto text-gray-400 mb-4" }), _jsx("h3", { className: "text-lg font-medium text-gray-900 mb-2", children: "Visit not found" }), _jsx("p", { className: "text-gray-600 mb-6", children: "The visit you're looking for doesn't exist." }), _jsx("button", { onClick: () => navigate('/queue'), className: "btn-primary", children: "Back to Queue" })] }));
    }
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-4", children: [_jsx("button", { onClick: () => navigate('/queue'), className: "p-2 rounded-lg hover:bg-gray-100 transition-colors touch-target", children: _jsx(ArrowLeftIcon, { className: "h-6 w-6 text-gray-600" }) }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Pharmacy" }), _jsxs("p", { className: "text-gray-600", children: ["Patient: ", patient.givenName, " ", patient.familyName] })] })] }), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-6", children: [_jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Patient Information" }), _jsxs("div", { className: "flex items-center space-x-4 mb-4", children: [patient.photoUrl ? (_jsx("img", { src: patient.photoUrl, alt: `${patient.givenName} ${patient.familyName}`, className: "w-16 h-16 rounded-full object-cover" })) : (_jsx("div", { className: "w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center", children: _jsxs("span", { className: "text-xl font-medium text-gray-600", children: [patient.givenName[0], patient.familyName[0]] }) })), _jsxs("div", { children: [_jsxs("h4", { className: "text-lg font-medium text-gray-900", children: [patient.givenName, " ", patient.familyName] }), _jsxs("p", { className: "text-sm text-gray-600", children: ["Age: ", getPatientAge(patient.dob), " \u2022 ", patient.sex, " \u2022 ", patient.phone] })] })] })] }), _jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Consultation Summary" }), consultation ? (_jsxs("div", { className: "space-y-3", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm font-medium text-gray-700", children: "Provider:" }), _jsx("p", { className: "text-sm text-gray-600", children: consultation.providerName })] }), consultation.provisionalDx.length > 0 && (_jsxs("div", { children: [_jsx("p", { className: "text-sm font-medium text-gray-700", children: "Diagnoses:" }), _jsx("ul", { className: "text-sm text-gray-600 list-disc list-inside", children: consultation.provisionalDx.map((dx, index) => (_jsx("li", { children: dx }, index))) })] })), _jsxs("div", { children: [_jsx("p", { className: "text-sm font-medium text-gray-700", children: "Treatment Plan:" }), _jsx("p", { className: "text-sm text-gray-600 line-clamp-3", children: consultation.soapPlan })] })] })) : (_jsx("p", { className: "text-gray-500 text-sm", children: "No consultation notes available" }))] })] }), _jsx(DispenseForm, { patientId: patient.id, visitId: visit.id, onSuccess: handleSuccess, onCancel: handleCancel })] }));
}
