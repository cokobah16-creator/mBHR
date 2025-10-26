import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Portal Migration Admin Page
 *
 * Bulk enable portal access for existing patients with contact information
 * Features:
 * - Filter patients by date, state, contact method
 * - Preview count before starting
 * - Batch processing with progress tracking
 * - Export CSV report of results
 */
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftIcon, UserGroupIcon, FunnelIcon, PlayIcon, CheckCircleIcon, XCircleIcon, DocumentArrowDownIcon, ClockIcon } from '@heroicons/react/24/outline';
import { findEligiblePatients, bulkEnablePortalAccess } from '@/services/portalEnrollment';
import { NIGERIAN_STATES } from '@/utils/nigeria';
import { formatNigerianDate } from '@/utils/dateFormat';
export function PortalMigration() {
    const [filters, setFilters] = useState({
        contactMethod: 'any'
    });
    const [eligiblePatients, setEligiblePatients] = useState([]);
    const [selectedPatients, setSelectedPatients] = useState(new Set());
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState({
        total: 0,
        completed: 0,
        successful: 0,
        failed: 0,
        isRunning: false,
        isPaused: false
    });
    const [errors, setErrors] = useState([]);
    const [showResults, setShowResults] = useState(false);
    useEffect(() => {
        loadEligiblePatients();
    }, [filters]);
    const loadEligiblePatients = async () => {
        setLoading(true);
        try {
            const patients = await findEligiblePatients({
                startDate: filters.startDate ? new Date(filters.startDate) : undefined,
                endDate: filters.endDate ? new Date(filters.endDate) : undefined,
                state: filters.state,
                contactMethod: filters.contactMethod
            });
            setEligiblePatients(patients);
            setSelectedPatients(new Set());
        }
        catch (error) {
            console.error('Error loading eligible patients:', error);
        }
        finally {
            setLoading(false);
        }
    };
    const handleSelectAll = () => {
        if (selectedPatients.size === eligiblePatients.length) {
            setSelectedPatients(new Set());
        }
        else {
            setSelectedPatients(new Set(eligiblePatients.map(p => p.id)));
        }
    };
    const handleTogglePatient = (patientId) => {
        const newSelected = new Set(selectedPatients);
        if (newSelected.has(patientId)) {
            newSelected.delete(patientId);
        }
        else {
            newSelected.add(patientId);
        }
        setSelectedPatients(newSelected);
    };
    const handleStartMigration = async (sendInvitations) => {
        const patientIds = Array.from(selectedPatients);
        if (patientIds.length === 0)
            return;
        setProgress({
            total: patientIds.length,
            completed: 0,
            successful: 0,
            failed: 0,
            isRunning: true,
            isPaused: false
        });
        setErrors([]);
        setShowResults(false);
        const result = await bulkEnablePortalAccess(patientIds, {
            sendInvitations,
            batchSize: 50,
            onProgress: (completed, total) => {
                setProgress(prev => ({
                    ...prev,
                    completed,
                    total
                }));
            }
        });
        setProgress(prev => ({
            ...prev,
            successful: result.success,
            failed: result.failed,
            isRunning: false
        }));
        setErrors(result.errors);
        setShowResults(true);
        // Refresh eligible patients list
        await loadEligiblePatients();
    };
    const handleExportCSV = () => {
        const headers = ['Patient ID', 'Name', 'Status', 'Error'];
        const rows = eligiblePatients
            .filter(p => selectedPatients.has(p.id))
            .map(p => {
            const error = errors.find(e => e.patientId === p.id);
            return [
                p.id,
                `${p.givenName} ${p.familyName}`,
                error ? 'Failed' : 'Success',
                error?.error || ''
            ];
        });
        const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `portal-migration-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };
    const progressPercentage = progress.total > 0
        ? Math.round((progress.completed / progress.total) * 100)
        : 0;
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-4", children: [_jsx(Link, { to: "/admin/portal-dashboard", className: "p-2 rounded-lg hover:bg-gray-100 transition-colors touch-target", children: _jsx(ArrowLeftIcon, { className: "h-6 w-6 text-gray-600" }) }), _jsxs("div", { className: "flex-1", children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Portal Migration Tool" }), _jsx("p", { className: "text-gray-600", children: "Bulk enable portal access for existing patients" })] })] }), _jsxs("div", { className: "card", children: [_jsxs("div", { className: "flex items-center space-x-3 mb-4", children: [_jsx(FunnelIcon, { className: "h-6 w-6 text-gray-600" }), _jsx("h2", { className: "text-lg font-semibold text-gray-900", children: "Filters" })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-4 gap-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Start Date" }), _jsx("input", { type: "date", value: filters.startDate || '', onChange: e => setFilters({ ...filters, startDate: e.target.value }), className: "input-field" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "End Date" }), _jsx("input", { type: "date", value: filters.endDate || '', onChange: e => setFilters({ ...filters, endDate: e.target.value }), className: "input-field" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "State" }), _jsxs("select", { value: filters.state || '', onChange: e => setFilters({ ...filters, state: e.target.value }), className: "input-field", children: [_jsx("option", { value: "", children: "All States" }), NIGERIAN_STATES.map(state => (_jsx("option", { value: state, children: state }, state)))] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Contact Method" }), _jsxs("select", { value: filters.contactMethod, onChange: e => setFilters({ ...filters, contactMethod: e.target.value }), className: "input-field", children: [_jsx("option", { value: "any", children: "Any" }), _jsx("option", { value: "email", children: "Email Only" }), _jsx("option", { value: "phone", children: "Phone Only" })] })] })] })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-4 gap-4", children: [_jsx("div", { className: "card bg-blue-50 border-blue-200", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm text-blue-600 font-medium", children: "Eligible Patients" }), _jsx("p", { className: "text-2xl font-bold text-blue-900", children: eligiblePatients.length })] }), _jsx(UserGroupIcon, { className: "h-8 w-8 text-blue-600" })] }) }), _jsx("div", { className: "card bg-green-50 border-green-200", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm text-green-600 font-medium", children: "Selected" }), _jsx("p", { className: "text-2xl font-bold text-green-900", children: selectedPatients.size })] }), _jsx(CheckCircleIcon, { className: "h-8 w-8 text-green-600" })] }) }), _jsx("div", { className: "card bg-yellow-50 border-yellow-200", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm text-yellow-600 font-medium", children: "In Progress" }), _jsxs("p", { className: "text-2xl font-bold text-yellow-900", children: [progress.completed, "/", progress.total] })] }), _jsx(ClockIcon, { className: "h-8 w-8 text-yellow-600" })] }) }), _jsx("div", { className: "card bg-red-50 border-red-200", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("p", { className: "text-sm text-red-600 font-medium", children: "Failed" }), _jsx("p", { className: "text-2xl font-bold text-red-900", children: progress.failed })] }), _jsx(XCircleIcon, { className: "h-8 w-8 text-red-600" })] }) })] }), progress.isRunning && (_jsxs("div", { className: "card bg-blue-50", children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx("span", { className: "text-sm font-medium text-blue-900", children: "Migration Progress" }), _jsxs("span", { className: "text-sm font-medium text-blue-900", children: [progressPercentage, "%"] })] }), _jsx("div", { className: "w-full bg-blue-200 rounded-full h-4 overflow-hidden", children: _jsx("div", { className: "bg-blue-600 h-full transition-all duration-300", style: { width: `${progressPercentage}%` } }) }), _jsxs("p", { className: "text-sm text-blue-800 mt-2", children: ["Processing ", progress.completed, " of ", progress.total, " patients..."] })] })), showResults && !progress.isRunning && (_jsx("div", { className: "card bg-green-50 border-green-200", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-lg font-semibold text-green-900 mb-2", children: "Migration Complete" }), _jsxs("p", { className: "text-sm text-green-800", children: ["Successfully enabled portal access for ", progress.successful, " patients.", progress.failed > 0 && ` ${progress.failed} failed.`] })] }), _jsxs("button", { onClick: handleExportCSV, className: "btn-secondary inline-flex items-center space-x-2", children: [_jsx(DocumentArrowDownIcon, { className: "h-5 w-5" }), _jsx("span", { children: "Export CSV" })] })] }) })), _jsxs("div", { className: "card", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsxs("h2", { className: "text-lg font-semibold text-gray-900", children: ["Eligible Patients (", eligiblePatients.length, ")"] }), _jsxs("div", { className: "flex items-center space-x-3", children: [_jsx("button", { onClick: handleSelectAll, className: "btn-secondary text-sm", children: selectedPatients.size === eligiblePatients.length ? 'Deselect All' : 'Select All' }), _jsxs("button", { onClick: () => handleStartMigration(false), disabled: selectedPatients.size === 0 || progress.isRunning, className: "btn-secondary inline-flex items-center space-x-2", children: [_jsx(PlayIcon, { className: "h-4 w-4" }), _jsx("span", { children: "Enable Portal (No Invites)" })] }), _jsxs("button", { onClick: () => handleStartMigration(true), disabled: selectedPatients.size === 0 || progress.isRunning, className: "btn-primary inline-flex items-center space-x-2", children: [_jsx(PlayIcon, { className: "h-4 w-4" }), _jsx("span", { children: "Enable & Send Invitations" })] })] })] }), loading ? (_jsx("div", { className: "flex items-center justify-center py-12", children: _jsx("div", { className: "animate-spin rounded-full h-8 w-8 border-b-2 border-primary" }) })) : eligiblePatients.length === 0 ? (_jsxs("div", { className: "text-center py-12", children: [_jsx(UserGroupIcon, { className: "h-12 w-12 mx-auto text-gray-400 mb-4" }), _jsx("p", { className: "text-gray-600", children: "No eligible patients found with current filters" })] })) : (_jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full", children: [_jsx("thead", { className: "bg-gray-50", children: _jsxs("tr", { children: [_jsx("th", { className: "px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase", children: _jsx("input", { type: "checkbox", checked: selectedPatients.size === eligiblePatients.length, onChange: handleSelectAll, className: "h-4 w-4 text-primary border-gray-300 rounded" }) }), _jsx("th", { className: "px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase", children: "Name" }), _jsx("th", { className: "px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase", children: "DOB" }), _jsx("th", { className: "px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase", children: "Phone" }), _jsx("th", { className: "px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase", children: "Email" }), _jsx("th", { className: "px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase", children: "State" }), _jsx("th", { className: "px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase", children: "Registered" })] }) }), _jsx("tbody", { className: "bg-white divide-y divide-gray-200", children: eligiblePatients.map(patient => (_jsxs("tr", { className: "hover:bg-gray-50", children: [_jsx("td", { className: "px-4 py-3", children: _jsx("input", { type: "checkbox", checked: selectedPatients.has(patient.id), onChange: () => handleTogglePatient(patient.id), className: "h-4 w-4 text-primary border-gray-300 rounded" }) }), _jsx("td", { className: "px-4 py-3", children: _jsxs(Link, { to: `/patients/${patient.id}`, className: "text-primary hover:underline font-medium", children: [patient.givenName, " ", patient.familyName] }) }), _jsx("td", { className: "px-4 py-3 text-sm text-gray-600", children: patient.dob }), _jsx("td", { className: "px-4 py-3 text-sm text-gray-600", children: patient.phone || '-' }), _jsx("td", { className: "px-4 py-3 text-sm text-gray-600", children: patient.email || '-' }), _jsx("td", { className: "px-4 py-3 text-sm text-gray-600", children: patient.state }), _jsx("td", { className: "px-4 py-3 text-sm text-gray-600", children: formatNigerianDate(patient.createdAt) })] }, patient.id))) })] }) }))] }), errors.length > 0 && (_jsxs("div", { className: "card bg-red-50 border-red-200", children: [_jsxs("h3", { className: "text-lg font-semibold text-red-900 mb-4", children: ["Failed Migrations (", errors.length, ")"] }), _jsx("div", { className: "space-y-2 max-h-64 overflow-y-auto", children: errors.map((error, index) => (_jsxs("div", { className: "flex items-start space-x-2 text-sm", children: [_jsx(XCircleIcon, { className: "h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" }), _jsxs("div", { children: [_jsxs("p", { className: "font-medium text-red-900", children: ["Patient ID: ", error.patientId] }), _jsx("p", { className: "text-red-800", children: error.error })] })] }, index))) })] }))] }));
}
