import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { formatNigerianDate } from '@/utils/dateFormat';
import { BellAlertIcon, ClockIcon, CheckCircleIcon, PlusCircleIcon, XCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import * as logger from '@/lib/logger';
export function PrescriptionRefills() {
    const [prescriptions, setPrescriptions] = useState([]);
    const [refillRequests, setRefillRequests] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedPrescription, setSelectedPrescription] = useState(null);
    const [showRefillModal, setShowRefillModal] = useState(false);
    const [refillNotes, setRefillNotes] = useState('');
    const [requesting, setRequesting] = useState(false);
    useEffect(() => {
        loadPrescriptions();
        loadRefillRequests();
    }, []);
    const loadPrescriptions = async () => {
        setLoading(true);
        try {
            const portalUser = JSON.parse(localStorage.getItem('patient_portal_user') || '{}');
            if (!portalUser.patientId) {
                logger.error('No patient ID found');
                return;
            }
            // Mock data - replace with actual API calls
            const mockPrescriptions = [
                {
                    id: 'rx-1',
                    medicationName: 'Lisinopril',
                    dosage: '10mg',
                    frequency: 'Once daily',
                    prescribedBy: 'Dr. Adeyemi',
                    prescribedDate: new Date('2025-09-01'),
                    lastDispensedDate: new Date('2025-10-01'),
                    quantityDispensed: 30,
                    daysSupply: 30,
                    refillsRemaining: 2,
                    totalRefills: 3,
                    status: 'refill_soon'
                },
                {
                    id: 'rx-2',
                    medicationName: 'Metformin',
                    dosage: '500mg',
                    frequency: 'Twice daily',
                    prescribedBy: 'Dr. Adeyemi',
                    prescribedDate: new Date('2025-08-15'),
                    lastDispensedDate: new Date('2025-09-28'),
                    quantityDispensed: 60,
                    daysSupply: 30,
                    refillsRemaining: 5,
                    totalRefills: 6,
                    status: 'refill_due'
                },
                {
                    id: 'rx-3',
                    medicationName: 'Atorvastatin',
                    dosage: '20mg',
                    frequency: 'Once daily at bedtime',
                    prescribedBy: 'Dr. Okafor',
                    prescribedDate: new Date('2025-10-10'),
                    lastDispensedDate: new Date('2025-10-10'),
                    quantityDispensed: 30,
                    daysSupply: 30,
                    refillsRemaining: 4,
                    totalRefills: 5,
                    status: 'active'
                }
            ];
            setPrescriptions(mockPrescriptions);
        }
        catch (err) {
            logger.error('Error loading prescriptions:', err);
        }
        finally {
            setLoading(false);
        }
    };
    const loadRefillRequests = async () => {
        try {
            // Mock data - replace with actual API call
            const mockRequests = [
                {
                    id: 'req-1',
                    prescriptionId: 'rx-1',
                    medicationName: 'Lisinopril 10mg',
                    requestedAt: new Date('2025-10-23'),
                    status: 'ready',
                    pharmacy: 'Main Pharmacy',
                    reviewedAt: new Date('2025-10-24'),
                    reviewedBy: 'Pharmacist Johnson'
                }
            ];
            setRefillRequests(mockRequests);
        }
        catch (err) {
            logger.error('Error loading refill requests:', err);
        }
    };
    const getStatusInfo = (status) => {
        switch (status) {
            case 'refill_due':
                return {
                    color: 'bg-red-100 text-red-800 border-red-200',
                    icon: ExclamationTriangleIcon,
                    label: 'Refill Due Now',
                    message: 'Your prescription is running out soon'
                };
            case 'refill_soon':
                return {
                    color: 'bg-yellow-100 text-yellow-800 border-yellow-200',
                    icon: BellAlertIcon,
                    label: 'Refill Soon',
                    message: 'Consider requesting a refill'
                };
            case 'active':
                return {
                    color: 'bg-green-100 text-green-800 border-green-200',
                    icon: CheckCircleIcon,
                    label: 'Active',
                    message: 'Prescription is active'
                };
            case 'expired':
                return {
                    color: 'bg-gray-100 text-gray-800 border-gray-200',
                    icon: XCircleIcon,
                    label: 'Expired',
                    message: 'Contact your doctor for a new prescription'
                };
        }
    };
    const getRequestStatusColor = (status) => {
        switch (status) {
            case 'ready':
                return 'bg-green-100 text-green-800';
            case 'approved':
                return 'bg-blue-100 text-blue-800';
            case 'pending':
                return 'bg-yellow-100 text-yellow-800';
            case 'dispensed':
                return 'bg-gray-100 text-gray-800';
            case 'declined':
                return 'bg-red-100 text-red-800';
        }
    };
    const handleRequestRefill = (prescription) => {
        setSelectedPrescription(prescription);
        setRefillNotes('');
        setShowRefillModal(true);
    };
    const submitRefillRequest = async () => {
        if (!selectedPrescription)
            return;
        setRequesting(true);
        try {
            // Mock submission - replace with actual API call
            await new Promise(resolve => setTimeout(resolve, 1500));
            const newRequest = {
                id: `req-${Date.now()}`,
                prescriptionId: selectedPrescription.id,
                medicationName: `${selectedPrescription.medicationName} ${selectedPrescription.dosage}`,
                requestedAt: new Date(),
                status: 'pending',
                pharmacy: 'Main Pharmacy',
                notes: refillNotes || undefined
            };
            setRefillRequests([newRequest, ...refillRequests]);
            setShowRefillModal(false);
            setSelectedPrescription(null);
            setRefillNotes('');
            alert('Refill request submitted successfully! We will notify you when it\'s ready.');
        }
        catch (err) {
            logger.error('Refill request error:', err);
            alert('Failed to submit refill request. Please try again.');
        }
        finally {
            setRequesting(false);
        }
    };
    const getDaysUntilRefill = (prescription) => {
        const lastDispensed = new Date(prescription.lastDispensedDate);
        const nextRefillDate = new Date(lastDispensed.getTime() + prescription.daysSupply * 24 * 60 * 60 * 1000);
        const today = new Date();
        const daysRemaining = Math.ceil((nextRefillDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
        return daysRemaining;
    };
    const needsAttention = prescriptions.filter(p => p.status === 'refill_due' || p.status === 'refill_soon');
    const activePrescriptions = prescriptions.filter(p => p.status === 'active');
    if (loading) {
        return (_jsx("div", { className: "flex items-center justify-center min-h-screen", children: _jsx("div", { className: "w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" }) }));
    }
    return (_jsxs("div", { className: "max-w-7xl mx-auto px-4 py-8 space-y-6", children: [_jsxs("div", { className: "bg-white rounded-xl shadow-sm p-6", children: [_jsx("h1", { className: "text-3xl font-bold text-gray-900", children: "Prescription Refills" }), _jsx("p", { className: "text-gray-600 mt-2", children: "Manage your prescriptions and request refills" })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-3 gap-6", children: [_jsx("div", { className: "bg-white rounded-xl shadow-sm p-6", children: _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center", children: _jsx(BellAlertIcon, { className: "w-6 h-6 text-red-600" }) }), _jsxs("div", { children: [_jsx("p", { className: "text-sm text-gray-600", children: "Need Attention" }), _jsx("p", { className: "text-2xl font-bold text-gray-900", children: needsAttention.length })] })] }) }), _jsx("div", { className: "bg-white rounded-xl shadow-sm p-6", children: _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center", children: _jsx(CheckCircleIcon, { className: "w-6 h-6 text-green-600" }) }), _jsxs("div", { children: [_jsx("p", { className: "text-sm text-gray-600", children: "Active" }), _jsx("p", { className: "text-2xl font-bold text-gray-900", children: activePrescriptions.length })] })] }) }), _jsx("div", { className: "bg-white rounded-xl shadow-sm p-6", children: _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center", children: _jsx(ClockIcon, { className: "w-6 h-6 text-blue-600" }) }), _jsxs("div", { children: [_jsx("p", { className: "text-sm text-gray-600", children: "Pending Requests" }), _jsx("p", { className: "text-2xl font-bold text-gray-900", children: refillRequests.filter(r => r.status === 'pending' || r.status === 'approved').length })] })] }) })] }), refillRequests.filter(r => r.status !== 'dispensed').length > 0 && (_jsxs("div", { className: "bg-white rounded-xl shadow-sm overflow-hidden", children: [_jsx("div", { className: "px-6 py-4 border-b border-gray-200 bg-blue-50", children: _jsx("h2", { className: "text-xl font-bold text-gray-900", children: "Recent Refill Requests" }) }), _jsx("div", { className: "divide-y divide-gray-200", children: refillRequests.filter(r => r.status !== 'dispensed').map((request) => (_jsx("div", { className: "p-6 hover:bg-gray-50 transition-colors", children: _jsx("div", { className: "flex items-start justify-between", children: _jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("h3", { className: "font-semibold text-gray-900", children: request.medicationName }), _jsx("span", { className: `px-3 py-1 rounded-full text-xs font-medium ${getRequestStatusColor(request.status)}`, children: request.status.charAt(0).toUpperCase() + request.status.slice(1).replace('_', ' ') })] }), _jsxs("p", { className: "text-gray-600 mt-1", children: ["Requested: ", formatNigerianDate(request.requestedAt)] }), _jsxs("p", { className: "text-gray-600", children: ["Pharmacy: ", request.pharmacy] }), request.status === 'ready' && (_jsx("p", { className: "text-green-600 font-medium mt-2", children: "Ready for pickup!" }))] }) }) }, request.id))) })] })), needsAttention.length > 0 && (_jsxs("div", { className: "bg-white rounded-xl shadow-sm overflow-hidden", children: [_jsx("div", { className: "px-6 py-4 border-b border-gray-200 bg-yellow-50", children: _jsxs("h2", { className: "text-xl font-bold text-gray-900 flex items-center gap-2", children: [_jsx(BellAlertIcon, { className: "w-6 h-6 text-yellow-600" }), "Needs Attention"] }) }), _jsx("div", { className: "divide-y divide-gray-200", children: needsAttention.map((prescription) => {
                            const statusInfo = getStatusInfo(prescription.status);
                            const StatusIcon = statusInfo.icon;
                            const daysUntilRefill = getDaysUntilRefill(prescription);
                            return (_jsx("div", { className: "p-6 hover:bg-gray-50 transition-colors", children: _jsx("div", { className: "flex items-start justify-between", children: _jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx(StatusIcon, { className: "w-6 h-6 text-yellow-600" }), _jsxs("h3", { className: "font-semibold text-gray-900 text-lg", children: [prescription.medicationName, " ", prescription.dosage] }), _jsx("span", { className: `px-3 py-1 rounded-full text-xs font-medium border ${statusInfo.color}`, children: statusInfo.label })] }), _jsx("p", { className: "text-gray-600 mt-2", children: prescription.frequency }), _jsxs("p", { className: "text-gray-600", children: ["Prescribed by: ", prescription.prescribedBy] }), _jsxs("div", { className: "mt-3 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm", children: [_jsxs("div", { children: [_jsx("p", { className: "text-gray-500", children: "Days until refill" }), _jsxs("p", { className: "font-semibold text-gray-900", children: [daysUntilRefill, " days"] })] }), _jsxs("div", { children: [_jsx("p", { className: "text-gray-500", children: "Last filled" }), _jsx("p", { className: "font-semibold text-gray-900", children: formatNigerianDate(prescription.lastDispensedDate) })] }), _jsxs("div", { children: [_jsx("p", { className: "text-gray-500", children: "Refills remaining" }), _jsxs("p", { className: "font-semibold text-gray-900", children: [prescription.refillsRemaining, " of ", prescription.totalRefills] })] }), _jsxs("div", { children: [_jsx("p", { className: "text-gray-500", children: "Days supply" }), _jsxs("p", { className: "font-semibold text-gray-900", children: [prescription.daysSupply, " days"] })] })] }), _jsx("div", { className: "mt-4", children: _jsxs("button", { onClick: () => handleRequestRefill(prescription), disabled: prescription.refillsRemaining === 0, className: "px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed", children: [_jsx(PlusCircleIcon, { className: "w-5 h-5" }), "Request Refill"] }) })] }) }) }, prescription.id));
                        }) })] })), _jsxs("div", { className: "bg-white rounded-xl shadow-sm overflow-hidden", children: [_jsx("div", { className: "px-6 py-4 border-b border-gray-200", children: _jsx("h2", { className: "text-xl font-bold text-gray-900", children: "All Active Prescriptions" }) }), _jsx("div", { className: "divide-y divide-gray-200", children: prescriptions.map((prescription) => {
                            const statusInfo = getStatusInfo(prescription.status);
                            const StatusIcon = statusInfo.icon;
                            const daysUntilRefill = getDaysUntilRefill(prescription);
                            return (_jsx("div", { className: "p-6 hover:bg-gray-50 transition-colors", children: _jsx("div", { className: "flex items-start justify-between", children: _jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("h3", { className: "font-semibold text-gray-900 text-lg", children: [prescription.medicationName, " ", prescription.dosage] }), _jsx("span", { className: `px-3 py-1 rounded-full text-xs font-medium border ${statusInfo.color}`, children: statusInfo.label })] }), _jsx("p", { className: "text-gray-600 mt-2", children: prescription.frequency }), _jsxs("div", { className: "mt-3 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm", children: [_jsxs("div", { children: [_jsx("p", { className: "text-gray-500", children: "Prescribed by" }), _jsx("p", { className: "font-semibold text-gray-900", children: prescription.prescribedBy })] }), _jsxs("div", { children: [_jsx("p", { className: "text-gray-500", children: "Last filled" }), _jsx("p", { className: "font-semibold text-gray-900", children: formatNigerianDate(prescription.lastDispensedDate) })] }), _jsxs("div", { children: [_jsx("p", { className: "text-gray-500", children: "Refills remaining" }), _jsxs("p", { className: "font-semibold text-gray-900", children: [prescription.refillsRemaining, " of ", prescription.totalRefills] })] }), _jsxs("div", { children: [_jsx("p", { className: "text-gray-500", children: "Days until refill" }), _jsxs("p", { className: "font-semibold text-gray-900", children: [daysUntilRefill, " days"] })] })] }), prescription.status !== 'expired' && prescription.refillsRemaining > 0 && (_jsx("div", { className: "mt-4", children: _jsxs("button", { onClick: () => handleRequestRefill(prescription), className: "px-4 py-2 border border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors text-sm font-medium flex items-center gap-2", children: [_jsx(PlusCircleIcon, { className: "w-4 h-4" }), "Request Refill"] }) }))] }) }) }, prescription.id));
                        }) })] }), showRefillModal && selectedPrescription && (_jsx("div", { className: "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50", children: _jsxs("div", { className: "bg-white rounded-xl max-w-md w-full p-6", children: [_jsx("h2", { className: "text-2xl font-bold text-gray-900 mb-4", children: "Request Refill" }), _jsxs("div", { className: "bg-gray-50 rounded-lg p-4 mb-6", children: [_jsxs("p", { className: "font-semibold text-gray-900 text-lg", children: [selectedPrescription.medicationName, " ", selectedPrescription.dosage] }), _jsx("p", { className: "text-gray-600 mt-1", children: selectedPrescription.frequency }), _jsxs("p", { className: "text-sm text-gray-600 mt-2", children: ["Refills remaining: ", selectedPrescription.refillsRemaining, " of ", selectedPrescription.totalRefills] })] }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Additional Notes (Optional)" }), _jsx("textarea", { value: refillNotes, onChange: (e) => setRefillNotes(e.target.value), rows: 3, className: "w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent", placeholder: "Any special instructions or questions?" })] }), _jsx("div", { className: "bg-blue-50 border border-blue-200 rounded-lg p-4", children: _jsx("p", { className: "text-sm text-blue-800", children: "Your refill request will be reviewed by our pharmacy team. We'll notify you when it's ready for pickup." }) }), _jsxs("div", { className: "flex gap-3 pt-4", children: [_jsx("button", { type: "button", onClick: () => {
                                                setShowRefillModal(false);
                                                setSelectedPrescription(null);
                                                setRefillNotes('');
                                            }, disabled: requesting, className: "flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50", children: "Cancel" }), _jsx("button", { onClick: submitRefillRequest, disabled: requesting, className: "flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2", children: requesting ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" }), "Requesting..."] })) : (_jsxs(_Fragment, { children: [_jsx(PlusCircleIcon, { className: "w-5 h-5" }), "Submit Request"] })) })] })] })] }) }))] }));
}
