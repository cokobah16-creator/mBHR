import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Portal Dashboard - Analytics and Management Interface
 *
 * Provides overview of patient portal adoption and usage:
 * - Total patients with portal access
 * - Verification and activity statistics
 * - Filtered patient list with portal status
 * - Quick actions for bulk operations
 */
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { UserGroupIcon, CheckCircleIcon, ClockIcon, ChartBarIcon, CogIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { db } from '@/db';
import { formatNigerianDate } from '@/utils/dateFormat';
export function PortalDashboard() {
    const [stats, setStats] = useState({
        totalPatients: 0,
        portalEnabled: 0,
        verified: 0,
        active30Days: 0,
        invitationsSent: 0,
        pendingVerification: 0
    });
    const [patients, setPatients] = useState([]);
    const [filteredPatients, setFilteredPatients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    useEffect(() => {
        loadData();
    }, []);
    useEffect(() => {
        filterPatients();
    }, [searchQuery, statusFilter, patients]);
    const loadData = async () => {
        setLoading(true);
        try {
            const allPatients = await db.patients.toArray();
            // Calculate statistics
            const totalPatients = allPatients.length;
            const portalEnabled = allPatients.filter(p => p.portalEnabled === 1).length;
            const verified = allPatients.filter(p => p.contactVerified === 1).length;
            // Active in last 30 days
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const active30Days = allPatients.filter(p => {
                if (!p.lastPortalActivity)
                    return false;
                return new Date(p.lastPortalActivity) > thirtyDaysAgo;
            }).length;
            // Count invitations sent
            const invitationsSent = allPatients.filter(p => p.portalInvitation && p.portalInvitation.count && p.portalInvitation.count > 0).length;
            // Pending verification
            const pendingVerification = allPatients.filter(p => p.portalEnabled === 1 && p.contactVerified === 0).length;
            setStats({
                totalPatients,
                portalEnabled,
                verified,
                active30Days,
                invitationsSent,
                pendingVerification
            });
            // Map patients with status labels
            const patientsWithStatus = allPatients.map(p => {
                let statusLabel = 'Not Enabled';
                let statusColor = 'gray';
                if (p.portalEnabled === 1) {
                    if (p.contactVerified === 1) {
                        statusLabel = 'Verified';
                        statusColor = 'green';
                    }
                    else {
                        statusLabel = 'Pending Verification';
                        statusColor = 'yellow';
                    }
                }
                return {
                    ...p,
                    portalStatusLabel: statusLabel,
                    portalStatusColor: statusColor
                };
            });
            setPatients(patientsWithStatus);
        }
        catch (error) {
            console.error('Error loading portal dashboard data:', error);
        }
        finally {
            setLoading(false);
        }
    };
    const filterPatients = () => {
        let filtered = patients;
        // Apply search filter
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(p => p.givenName.toLowerCase().includes(query) ||
                p.familyName.toLowerCase().includes(query) ||
                p.email?.toLowerCase().includes(query) ||
                p.phone?.includes(query));
        }
        // Apply status filter
        if (statusFilter !== 'all') {
            filtered = filtered.filter(p => {
                switch (statusFilter) {
                    case 'enabled':
                        return p.portalEnabled === 1;
                    case 'disabled':
                        return p.portalEnabled === 0;
                    case 'verified':
                        return p.contactVerified === 1;
                    case 'pending':
                        return p.portalEnabled === 1 && p.contactVerified === 0;
                    default:
                        return true;
                }
            });
        }
        setFilteredPatients(filtered);
    };
    const getStatusBadge = (patient) => {
        const colorClasses = {
            green: 'bg-green-100 text-green-800',
            yellow: 'bg-yellow-100 text-yellow-800',
            gray: 'bg-gray-100 text-gray-800'
        };
        return (_jsx("span", { className: `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClasses[patient.portalStatusColor]}`, children: patient.portalStatusLabel }));
    };
    if (loading) {
        return (_jsx("div", { className: "flex items-center justify-center py-12", children: _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" }), _jsx("p", { className: "mt-4 text-gray-600", children: "Loading portal dashboard..." })] }) }));
    }
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Patient Portal Dashboard" }), _jsx("p", { className: "text-gray-600", children: "Monitor portal adoption and patient engagement" })] }), _jsxs(Link, { to: "/admin/portal-migration", className: "btn-primary inline-flex items-center space-x-2", children: [_jsx(CogIcon, { className: "h-5 w-5" }), _jsx("span", { children: "Bulk Migration" })] })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6", children: [_jsxs("div", { className: "card bg-blue-50 border-blue-200", children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx("p", { className: "text-sm font-medium text-blue-600", children: "Total Patients" }), _jsx(UserGroupIcon, { className: "h-6 w-6 text-blue-600" })] }), _jsx("p", { className: "text-3xl font-bold text-blue-900", children: stats.totalPatients }), _jsx("p", { className: "text-xs text-blue-800 mt-1", children: "In the system" })] }), _jsxs("div", { className: "card bg-green-50 border-green-200", children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx("p", { className: "text-sm font-medium text-green-600", children: "Portal Enabled" }), _jsx(CheckCircleIcon, { className: "h-6 w-6 text-green-600" })] }), _jsx("p", { className: "text-3xl font-bold text-green-900", children: stats.portalEnabled }), _jsx("p", { className: "text-xs text-green-800 mt-1", children: stats.totalPatients > 0
                                    ? `${Math.round((stats.portalEnabled / stats.totalPatients) * 100)}% adoption`
                                    : '0% adoption' })] }), _jsxs("div", { className: "card bg-purple-50 border-purple-200", children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx("p", { className: "text-sm font-medium text-purple-600", children: "Verified Users" }), _jsx(CheckCircleIcon, { className: "h-6 w-6 text-purple-600" })] }), _jsx("p", { className: "text-3xl font-bold text-purple-900", children: stats.verified }), _jsx("p", { className: "text-xs text-purple-800 mt-1", children: stats.portalEnabled > 0
                                    ? `${Math.round((stats.verified / stats.portalEnabled) * 100)}% verified`
                                    : '0% verified' })] }), _jsxs("div", { className: "card bg-yellow-50 border-yellow-200", children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx("p", { className: "text-sm font-medium text-yellow-600", children: "Pending Verification" }), _jsx(ClockIcon, { className: "h-6 w-6 text-yellow-600" })] }), _jsx("p", { className: "text-3xl font-bold text-yellow-900", children: stats.pendingVerification }), _jsx("p", { className: "text-xs text-yellow-800 mt-1", children: "Awaiting first login" })] }), _jsxs("div", { className: "card bg-indigo-50 border-indigo-200", children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx("p", { className: "text-sm font-medium text-indigo-600", children: "Active (30 days)" }), _jsx(ChartBarIcon, { className: "h-6 w-6 text-indigo-600" })] }), _jsx("p", { className: "text-3xl font-bold text-indigo-900", children: stats.active30Days }), _jsx("p", { className: "text-xs text-indigo-800 mt-1", children: stats.verified > 0
                                    ? `${Math.round((stats.active30Days / stats.verified) * 100)}% active`
                                    : '0% active' })] }), _jsxs("div", { className: "card bg-teal-50 border-teal-200", children: [_jsxs("div", { className: "flex items-center justify-between mb-2", children: [_jsx("p", { className: "text-sm font-medium text-teal-600", children: "Invitations Sent" }), _jsx(UserGroupIcon, { className: "h-6 w-6 text-teal-600" })] }), _jsx("p", { className: "text-3xl font-bold text-teal-900", children: stats.invitationsSent }), _jsx("p", { className: "text-xs text-teal-800 mt-1", children: "Total sent" })] })] }), _jsxs("div", { className: "card", children: [_jsxs("div", { className: "flex items-center justify-between mb-6", children: [_jsxs("h2", { className: "text-lg font-semibold text-gray-900", children: ["Patients (", filteredPatients.length, ")"] }), _jsxs("div", { className: "flex items-center space-x-4", children: [_jsxs("div", { className: "relative", children: [_jsx(MagnifyingGlassIcon, { className: "h-5 w-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" }), _jsx("input", { type: "text", placeholder: "Search patients...", value: searchQuery, onChange: e => setSearchQuery(e.target.value), className: "pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent" })] }), _jsxs("select", { value: statusFilter, onChange: e => setStatusFilter(e.target.value), className: "input-field", children: [_jsx("option", { value: "all", children: "All Status" }), _jsx("option", { value: "enabled", children: "Portal Enabled" }), _jsx("option", { value: "disabled", children: "Portal Disabled" }), _jsx("option", { value: "verified", children: "Verified" }), _jsx("option", { value: "pending", children: "Pending Verification" })] })] })] }), filteredPatients.length === 0 ? (_jsxs("div", { className: "text-center py-12", children: [_jsx(UserGroupIcon, { className: "h-12 w-12 mx-auto text-gray-400 mb-4" }), _jsx("p", { className: "text-gray-600", children: "No patients found" })] })) : (_jsxs("div", { className: "overflow-x-auto", children: [_jsxs("table", { className: "w-full", children: [_jsx("thead", { className: "bg-gray-50", children: _jsxs("tr", { children: [_jsx("th", { className: "px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase", children: "Name" }), _jsx("th", { className: "px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase", children: "Contact" }), _jsx("th", { className: "px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase", children: "Portal Status" }), _jsx("th", { className: "px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase", children: "Last Activity" }), _jsx("th", { className: "px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase", children: "Invitations" }), _jsx("th", { className: "px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase", children: "Actions" })] }) }), _jsx("tbody", { className: "bg-white divide-y divide-gray-200", children: filteredPatients.slice(0, 50).map(patient => (_jsxs("tr", { className: "hover:bg-gray-50", children: [_jsx("td", { className: "px-4 py-3", children: _jsxs(Link, { to: `/patients/${patient.id}`, className: "text-primary hover:underline font-medium", children: [patient.givenName, " ", patient.familyName] }) }), _jsx("td", { className: "px-4 py-3", children: _jsxs("div", { className: "text-sm", children: [patient.phone && _jsx("div", { className: "text-gray-900", children: patient.phone }), patient.email && _jsx("div", { className: "text-gray-600", children: patient.email })] }) }), _jsx("td", { className: "px-4 py-3", children: getStatusBadge(patient) }), _jsx("td", { className: "px-4 py-3 text-sm text-gray-600", children: patient.lastPortalActivity
                                                        ? formatNigerianDate(new Date(patient.lastPortalActivity))
                                                        : '-' }), _jsx("td", { className: "px-4 py-3 text-sm text-gray-600", children: patient.portalInvitation?.count || 0 }), _jsx("td", { className: "px-4 py-3", children: _jsx(Link, { to: `/patients/${patient.id}`, className: "text-primary hover:underline text-sm font-medium", children: "View Details" }) })] }, patient.id))) })] }), filteredPatients.length > 50 && (_jsxs("div", { className: "mt-4 text-center text-sm text-gray-600", children: ["Showing 50 of ", filteredPatients.length, " patients"] }))] }))] })] }));
}
