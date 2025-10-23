import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { db } from '@/db';
import { MagnifyingGlassIcon, UserPlusIcon, UserIcon, PhoneIcon, MapPinIcon } from '@heroicons/react/24/outline';
export function Patients() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [patients, setPatients] = useState([]);
    const [filteredPatients, setFilteredPatients] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        loadPatients();
    }, []);
    useEffect(() => {
        if (searchQuery.trim()) {
            const filtered = patients.filter(patient => patient.givenName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                patient.familyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                patient.phone.includes(searchQuery));
            setFilteredPatients(filtered);
        }
        else {
            setFilteredPatients(patients);
        }
    }, [searchQuery, patients]);
    const loadPatients = async () => {
        try {
            console.log('Loading patients...');
            const patientsData = await db.patients.orderBy('createdAt').reverse().toArray();
            console.log('Loaded patients:', patientsData.length);
            setPatients(patientsData);
            setFilteredPatients(patientsData);
        }
        catch (error) {
            console.error('Error loading patients:', error);
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
    if (loading) {
        return (_jsx("div", { className: "flex items-center justify-center py-12", children: _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" }), _jsx("p", { className: "mt-4 text-gray-600", children: "Loading patients..." })] }) }));
    }
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Patients" }), _jsx("p", { className: "text-gray-600", children: "Manage patient records and information" })] }), _jsxs(Link, { to: "/register", className: "btn-primary inline-flex items-center space-x-2", children: [_jsx(UserPlusIcon, { className: "h-5 w-5" }), _jsx("span", { children: "Register Patient" })] })] }), _jsxs("div", { className: "relative", children: [_jsx("div", { className: "absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none", children: _jsx(MagnifyingGlassIcon, { className: "h-5 w-5 text-gray-400" }) }), _jsx("input", { type: "text", value: searchQuery, onChange: (e) => setSearchQuery(e.target.value), className: "input-field pl-10", placeholder: "Search patients by name or phone..." })] }), _jsx("div", { className: "space-y-4", children: filteredPatients.length === 0 ? (_jsxs("div", { className: "text-center py-12", children: [_jsx(UserIcon, { className: "h-12 w-12 mx-auto text-gray-400 mb-4" }), _jsx("h3", { className: "text-lg font-medium text-gray-900 mb-2", children: searchQuery ? 'No patients found' : 'No patients registered' }), _jsx("p", { className: "text-gray-600 mb-6", children: searchQuery
                                ? 'Try adjusting your search terms'
                                : 'Get started by registering your first patient' }), !searchQuery && (_jsx(Link, { to: "/register", className: "btn-primary", children: "Register Patient" }))] })) : (filteredPatients.map((patient) => (_jsx("div", { className: "card hover:shadow-md transition-shadow cursor-pointer", onClick: () => navigate(`/patients/${patient.id}`), children: _jsxs("div", { className: "flex items-center space-x-4", children: [_jsx("div", { className: "flex-shrink-0", children: patient.photoUrl ? (_jsx("img", { src: patient.photoUrl, alt: `${patient.givenName} ${patient.familyName}`, className: "w-16 h-16 rounded-full object-cover" })) : (_jsx("div", { className: "w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center", children: _jsxs("span", { className: "text-xl font-medium text-gray-600", children: [patient.givenName[0], patient.familyName[0]] }) })) }), _jsxs("div", { className: "flex-1 min-w-0", children: [_jsxs("div", { className: "flex items-center space-x-3 mb-2", children: [_jsxs("h3", { className: "text-lg font-medium text-gray-900 truncate", children: [patient.givenName, " ", patient.familyName] }), _jsx("span", { className: "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800", children: patient.sex })] }), _jsxs("div", { className: "flex flex-col sm:flex-row sm:items-center sm:space-x-6 space-y-1 sm:space-y-0 text-sm text-gray-600", children: [_jsx("div", { className: "flex items-center space-x-1", children: _jsxs("span", { children: ["Age: ", getPatientAge(patient.dob)] }) }), _jsxs("div", { className: "flex items-center space-x-1", children: [_jsx(PhoneIcon, { className: "h-4 w-4" }), _jsx("span", { children: patient.phone })] }), _jsxs("div", { className: "flex items-center space-x-1", children: [_jsx(MapPinIcon, { className: "h-4 w-4" }), _jsxs("span", { children: [patient.state, ", ", patient.lga] })] })] })] }), _jsxs("div", { className: "flex-shrink-0 text-right", children: [_jsx("p", { className: "text-xs text-gray-500", children: "ID" }), _jsx("p", { className: "text-sm font-mono text-gray-700", children: patient.id.slice(-8).toUpperCase() })] })] }) }, patient.id)))) })] }));
}
