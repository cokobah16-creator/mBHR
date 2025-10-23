import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { usePatientsStore } from '@/stores/patients';
import { MagnifyingGlassIcon, UserIcon } from '@heroicons/react/24/outline';
export function PatientSearch({ onPatientSelect, placeholder = "Search patients...", className = "" }) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [showResults, setShowResults] = useState(false);
    const { searchPatients } = usePatientsStore();
    useEffect(() => {
        const searchDebounced = setTimeout(async () => {
            if (query.trim()) {
                const patients = await searchPatients(query);
                setResults(patients.slice(0, 5)); // Limit to 5 results
                setShowResults(true);
            }
            else {
                setResults([]);
                setShowResults(false);
            }
        }, 300);
        return () => clearTimeout(searchDebounced);
    }, [query, searchPatients]);
    const handleSelect = (patient) => {
        onPatientSelect(patient);
        setQuery(`${patient.givenName} ${patient.familyName}`);
        setShowResults(false);
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
    return (_jsxs("div", { className: `relative ${className}`, children: [_jsxs("div", { className: "relative", children: [_jsx("div", { className: "absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none", children: _jsx(MagnifyingGlassIcon, { className: "h-5 w-5 text-gray-400" }) }), _jsx("input", { type: "text", value: query, onChange: (e) => setQuery(e.target.value), onFocus: () => query && setShowResults(true), className: "input-field pl-10", placeholder: placeholder })] }), showResults && results.length > 0 && (_jsx("div", { className: "absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto", children: results.map((patient) => (_jsx("button", { onClick: () => handleSelect(patient), className: "w-full px-4 py-3 text-left hover:bg-gray-50 border-b border-gray-100 last:border-b-0 focus:bg-gray-50 focus:outline-none", children: _jsxs("div", { className: "flex items-center space-x-3", children: [patient.photoUrl ? (_jsx("img", { src: patient.photoUrl, alt: `${patient.givenName} ${patient.familyName}`, className: "w-10 h-10 rounded-full object-cover" })) : (_jsx("div", { className: "w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center", children: _jsx(UserIcon, { className: "h-5 w-5 text-gray-500" }) })), _jsxs("div", { className: "flex-1", children: [_jsxs("p", { className: "text-sm font-medium text-gray-900", children: [patient.givenName, " ", patient.familyName] }), _jsxs("p", { className: "text-xs text-gray-500", children: ["Age ", getPatientAge(patient.dob), " \u2022 ", patient.phone, " \u2022 ", patient.state] })] })] }) }, patient.id))) })), showResults && results.length === 0 && query.trim() && (_jsx("div", { className: "absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg p-4 text-center text-gray-500", children: "No patients found" }))] }));
}
