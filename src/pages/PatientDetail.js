import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState, startTransition } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '@/db';
import { getFlagColor, getFlagLabel } from '@/utils/vitals';
import { formatNigerianDate } from '@/utils/dateFormat';
import { AllergyManager } from '@/components/AllergyManager';
import { PreferenceManager } from '@/components/PreferenceManager';
import { useAuthStore } from '@/stores/auth';
import { ArrowLeftIcon, UserIcon, PhoneIcon, MapPinIcon, CalendarIcon, HeartIcon, DocumentTextIcon, BeakerIcon, PlayIcon } from '@heroicons/react/24/outline';
export function PatientDetail() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { t } = useTranslation();
    const user = useAuthStore(s => s.currentUser);
    const [patient, setPatient] = useState(null);
    const [visits, setVisits] = useState([]);
    const [vitals, setVitals] = useState([]);
    const [consultations, setConsultations] = useState([]);
    const [dispenses, setDispenses] = useState([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (id) {
            loadPatientData(id);
        }
    }, [id]);
    const loadPatientData = async (patientId) => {
        try {
            const [patientData, visitsData, vitalsData, consultationsData, dispensesData] = await Promise.all([
                db.patients.get(patientId),
                db.visits.where('patientId').equals(patientId).reverse().toArray(),
                db.vitals.where('patientId').equals(patientId).reverse().toArray(),
                db.consultations.where('patientId').equals(patientId).reverse().toArray(),
                db.dispenses.where('patientId').equals(patientId).reverse().toArray()
            ]);
            setPatient(patientData || null);
            setVisits(visitsData);
            setVitals(vitalsData);
            setConsultations(consultationsData);
            setDispenses(dispensesData);
        }
        catch (error) {
            console.error('Error loading patient data:', error);
        }
        finally {
            setLoading(false);
        }
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
    const startNewVisit = async () => {
        if (!patient)
            return;
        try {
            const visit = {
                id: crypto.randomUUID(),
                patientId: patient.id,
                startedAt: new Date(),
                siteName: 'Mobile Clinic',
                status: 'open'
            };
            await db.visits.add(visit);
            navigate(`/vitals/${visit.id}`);
        }
        catch (error) {
            console.error('Error starting visit:', error);
        }
    };
    if (loading) {
        return (_jsx("div", { className: "flex items-center justify-center py-12", children: _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" }), _jsx("p", { className: "mt-4 text-gray-600", children: "Loading patient..." })] }) }));
    }
    if (!patient) {
        return (_jsxs("div", { className: "text-center py-12", children: [_jsx(UserIcon, { className: "h-12 w-12 mx-auto text-gray-400 mb-4" }), _jsx("h3", { className: "text-lg font-medium text-gray-900 mb-2", children: "Patient not found" }), _jsx("p", { className: "text-gray-600 mb-6", children: "The patient you're looking for doesn't exist." }), _jsx(Link, { to: "/patients", className: "btn-primary", children: "Back to Patients" })] }));
    }
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-4", children: [_jsx("button", { onClick: () => startTransition(() => navigate('/patients')), className: "p-2 rounded-lg hover:bg-gray-100 transition-colors touch-target", children: _jsx(ArrowLeftIcon, { className: "h-6 w-6 text-gray-600" }) }), _jsxs("div", { className: "flex-1", children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Patient Details" }), _jsx("p", { className: "text-gray-600", children: "View patient information and medical history" })] }), _jsxs("button", { onClick: startNewVisit, className: "btn-primary inline-flex items-center space-x-2", children: [_jsx(PlayIcon, { className: "h-5 w-5" }), _jsx("span", { children: "Start Visit" })] })] }), _jsx("div", { className: "card", children: _jsxs("div", { className: "flex items-start space-x-6", children: [_jsx("div", { className: "flex-shrink-0", children: patient.photoUrl ? (_jsx("img", { src: patient.photoUrl, alt: `${patient.givenName} ${patient.familyName}`, className: "w-24 h-24 rounded-full object-cover" })) : (_jsx("div", { className: "w-24 h-24 rounded-full bg-gray-200 flex items-center justify-center", children: _jsxs("span", { className: "text-2xl font-medium text-gray-600", children: [patient.givenName[0], patient.familyName[0]] }) })) }), _jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center space-x-3 mb-4", children: [_jsxs("h2", { className: "text-2xl font-bold text-gray-900", children: [patient.givenName, " ", patient.familyName] }), _jsx("span", { className: "inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800", children: patient.sex })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4 text-sm", children: [_jsxs("div", { className: "flex items-center space-x-2 text-gray-600", children: [_jsx(CalendarIcon, { className: "h-4 w-4" }), _jsxs("span", { children: ["Age: ", getPatientAge(patient.dob), " (", formatNigerianDate(patient.dob), ")"] })] }), _jsxs("div", { className: "flex items-center space-x-2 text-gray-600", children: [_jsx(PhoneIcon, { className: "h-4 w-4" }), _jsx("span", { children: patient.phone })] }), _jsxs("div", { className: "flex items-center space-x-2 text-gray-600", children: [_jsx(MapPinIcon, { className: "h-4 w-4" }), _jsxs("span", { children: [patient.state, ", ", patient.lga] })] }), _jsxs("div", { className: "text-gray-600", children: [_jsx("strong", { children: "ID:" }), " ", patient.id.slice(-8).toUpperCase()] })] }), _jsx("div", { className: "mt-4", children: _jsxs("p", { className: "text-sm text-gray-600", children: [_jsx("strong", { children: "Address:" }), " ", patient.address] }) })] })] }) }), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-3 gap-6", children: [_jsxs("div", { className: "card", children: [_jsxs("div", { className: "flex items-center space-x-2 mb-4", children: [_jsx(HeartIcon, { className: "h-5 w-5 text-green-600" }), _jsx("h3", { className: "text-lg font-semibold text-gray-900", children: "Recent Vitals" })] }), vitals.length === 0 ? (_jsx("p", { className: "text-gray-500 text-sm", children: "No vitals recorded" })) : (_jsx("div", { className: "space-y-3", children: vitals.slice(0, 3).map((vital) => (_jsxs("div", { className: "border-l-4 border-green-500 pl-3", children: [_jsx("div", { className: "text-sm text-gray-600", children: formatNigerianDate(vital.takenAt) }), _jsxs("div", { className: "text-sm", children: [vital.systolic && vital.diastolic && (_jsxs("span", { children: ["BP: ", vital.systolic, "/", vital.diastolic, " "] })), vital.pulseBpm && _jsxs("span", { children: ["HR: ", vital.pulseBpm, " "] }), vital.bmi && _jsxs("span", { children: ["BMI: ", vital.bmi] })] }), vital.flags.length > 0 && (_jsx("div", { className: "flex flex-wrap gap-1 mt-1", children: vital.flags.map((flag) => (_jsx("span", { className: `px-1 py-0.5 rounded text-xs ${getFlagColor(flag)}`, children: getFlagLabel(flag) }, flag))) }))] }, vital.id))) }))] }), _jsxs("div", { className: "card", children: [_jsxs("div", { className: "flex items-center space-x-2 mb-4", children: [_jsx(DocumentTextIcon, { className: "h-5 w-5 text-purple-600" }), _jsx("h3", { className: "text-lg font-semibold text-gray-900", children: "Consultations" })] }), consultations.length === 0 ? (_jsx("p", { className: "text-gray-500 text-sm", children: "No consultations recorded" })) : (_jsx("div", { className: "space-y-3", children: consultations.slice(0, 3).map((consultation) => (_jsxs("div", { className: "border-l-4 border-purple-500 pl-3", children: [_jsx("div", { className: "text-sm text-gray-600", children: formatNigerianDate(consultation.createdAt) }), _jsx("div", { className: "text-sm font-medium", children: consultation.providerName }), consultation.provisionalDx.length > 0 && (_jsx("div", { className: "text-sm text-gray-700", children: consultation.provisionalDx.slice(0, 2).join(', ') }))] }, consultation.id))) }))] }), _jsxs("div", { className: "card", children: [_jsxs("div", { className: "flex items-center space-x-2 mb-4", children: [_jsx(BeakerIcon, { className: "h-5 w-5 text-orange-600" }), _jsx("h3", { className: "text-lg font-semibold text-gray-900", children: "Medications" })] }), dispenses.length === 0 ? (_jsx("p", { className: "text-gray-500 text-sm", children: "No medications dispensed" })) : (_jsx("div", { className: "space-y-3", children: dispenses.slice(0, 3).map((dispense) => (_jsxs("div", { className: "border-l-4 border-orange-500 pl-3", children: [_jsx("div", { className: "text-sm text-gray-600", children: formatNigerianDate(dispense.dispensedAt) }), _jsx("div", { className: "text-sm font-medium", children: dispense.itemName }), _jsxs("div", { className: "text-sm text-gray-700", children: [dispense.dosage, " \u00D7 ", dispense.qty] })] }, dispense.id))) }))] })] }), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-6", children: [_jsx("div", { className: "card", children: patient && user && _jsx(AllergyManager, { patientId: patient.id, userId: user.id }) }), _jsx("div", { className: "card", children: patient && _jsx(PreferenceManager, { patientId: patient.id }) })] }), _jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Visit History" }), visits.length === 0 ? (_jsx("p", { className: "text-gray-500", children: "No visits recorded" })) : (_jsx("div", { className: "space-y-4", children: visits.map((visit) => (_jsx("div", { className: "border rounded-lg p-4", children: _jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsxs("div", { children: [_jsxs("span", { className: "font-medium", children: [formatNigerianDate(visit.startedAt), " - ", visit.siteName] }), _jsx("span", { className: `ml-2 px-2 py-1 rounded-full text-xs font-medium ${visit.status === 'open'
                                                    ? 'bg-green-100 text-green-800'
                                                    : 'bg-gray-100 text-gray-800'}`, children: visit.status })] }), _jsxs("span", { className: "text-sm text-gray-500", children: ["ID: ", visit.id.slice(-8).toUpperCase()] })] }) }, visit.id))) }))] })] }));
}
