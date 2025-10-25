import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { formatNigerianDate } from '@/utils/dateFormat';
import { CreditCardIcon, DocumentTextIcon, CheckCircleIcon, ClockIcon, ExclamationCircleIcon, BanknotesIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import * as logger from '@/lib/logger';
export function BillingPayments() {
    const [bills, setBills] = useState([]);
    const [payments, setPayments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedBill, setSelectedBill] = useState(null);
    const [paymentAmount, setPaymentAmount] = useState('');
    const [paymentMethod, setPaymentMethod] = useState('card');
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [processing, setProcessing] = useState(false);
    useEffect(() => {
        loadBillingData();
    }, []);
    const loadBillingData = async () => {
        setLoading(true);
        try {
            const portalUser = JSON.parse(localStorage.getItem('patient_portal_user') || '{}');
            if (!portalUser.patientId) {
                logger.error('No patient ID found');
                return;
            }
            // Mock data - replace with actual API calls
            const mockBills = [
                {
                    id: '1',
                    visitId: 'visit-1',
                    visitDate: new Date('2025-10-15'),
                    description: 'General Consultation + Lab Tests',
                    amount: 15000,
                    amountPaid: 5000,
                    status: 'partial',
                    dueDate: new Date('2025-11-15'),
                    createdAt: new Date('2025-10-15')
                },
                {
                    id: '2',
                    visitId: 'visit-2',
                    visitDate: new Date('2025-09-20'),
                    description: 'Follow-up Visit + Medications',
                    amount: 8500,
                    amountPaid: 8500,
                    status: 'paid',
                    dueDate: new Date('2025-10-20'),
                    createdAt: new Date('2025-09-20')
                }
            ];
            const mockPayments = [
                {
                    id: 'pay-1',
                    billId: '1',
                    amount: 5000,
                    paymentMethod: 'card',
                    referenceNumber: 'PAY-2025-001',
                    paidAt: new Date('2025-10-16'),
                    status: 'completed'
                }
            ];
            setBills(mockBills);
            setPayments(mockPayments);
        }
        catch (err) {
            logger.error('Error loading billing data:', err);
        }
        finally {
            setLoading(false);
        }
    };
    const getStatusColor = (status) => {
        switch (status) {
            case 'paid':
                return 'bg-green-100 text-green-800';
            case 'partial':
                return 'bg-yellow-100 text-yellow-800';
            case 'pending':
                return 'bg-blue-100 text-blue-800';
            case 'overdue':
                return 'bg-red-100 text-red-800';
            default:
                return 'bg-gray-100 text-gray-800';
        }
    };
    const getStatusIcon = (status) => {
        switch (status) {
            case 'paid':
                return _jsx(CheckCircleIcon, { className: "w-5 h-5" });
            case 'overdue':
                return _jsx(ExclamationCircleIcon, { className: "w-5 h-5" });
            default:
                return _jsx(ClockIcon, { className: "w-5 h-5" });
        }
    };
    const handlePayNow = (bill) => {
        setSelectedBill(bill);
        const remainingAmount = bill.amount - bill.amountPaid;
        setPaymentAmount(remainingAmount.toString());
        setShowPaymentModal(true);
    };
    const handleSubmitPayment = async (e) => {
        e.preventDefault();
        if (!selectedBill)
            return;
        setProcessing(true);
        try {
            // Mock payment processing - replace with actual payment gateway integration
            await new Promise(resolve => setTimeout(resolve, 2000));
            // Update bill status
            const updatedBills = bills.map(bill => {
                if (bill.id === selectedBill.id) {
                    const newAmountPaid = bill.amountPaid + parseFloat(paymentAmount);
                    return {
                        ...bill,
                        amountPaid: newAmountPaid,
                        status: newAmountPaid >= bill.amount ? 'paid' : 'partial'
                    };
                }
                return bill;
            });
            setBills(updatedBills);
            setShowPaymentModal(false);
            setSelectedBill(null);
            setPaymentAmount('');
            alert('Payment successful!');
        }
        catch (err) {
            logger.error('Payment error:', err);
            alert('Payment failed. Please try again.');
        }
        finally {
            setProcessing(false);
        }
    };
    const handleDownloadReceipt = (billId) => {
        logger.info('Downloading receipt for bill:', billId);
        alert('Receipt download will be implemented with PDF generation');
    };
    const totalOutstanding = bills.reduce((sum, bill) => sum + (bill.amount - bill.amountPaid), 0);
    if (loading) {
        return (_jsx("div", { className: "flex items-center justify-center min-h-screen", children: _jsx("div", { className: "w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" }) }));
    }
    return (_jsxs("div", { className: "max-w-7xl mx-auto px-4 py-8 space-y-6", children: [_jsxs("div", { className: "bg-white rounded-xl shadow-sm p-6", children: [_jsx("h1", { className: "text-3xl font-bold text-gray-900", children: "Bills & Payments" }), _jsx("p", { className: "text-gray-600 mt-2", children: "View and manage your medical bills" })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-3 gap-6", children: [_jsx("div", { className: "bg-white rounded-xl shadow-sm p-6", children: _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center", children: _jsx(BanknotesIcon, { className: "w-6 h-6 text-red-600" }) }), _jsxs("div", { children: [_jsx("p", { className: "text-sm text-gray-600", children: "Total Outstanding" }), _jsxs("p", { className: "text-2xl font-bold text-gray-900", children: ["\u20A6", totalOutstanding.toLocaleString()] })] })] }) }), _jsx("div", { className: "bg-white rounded-xl shadow-sm p-6", children: _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center", children: _jsx(CheckCircleIcon, { className: "w-6 h-6 text-green-600" }) }), _jsxs("div", { children: [_jsx("p", { className: "text-sm text-gray-600", children: "Paid Bills" }), _jsx("p", { className: "text-2xl font-bold text-gray-900", children: bills.filter(b => b.status === 'paid').length })] })] }) }), _jsx("div", { className: "bg-white rounded-xl shadow-sm p-6", children: _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center", children: _jsx(DocumentTextIcon, { className: "w-6 h-6 text-yellow-600" }) }), _jsxs("div", { children: [_jsx("p", { className: "text-sm text-gray-600", children: "Pending Bills" }), _jsx("p", { className: "text-2xl font-bold text-gray-900", children: bills.filter(b => b.status !== 'paid').length })] })] }) })] }), _jsxs("div", { className: "bg-white rounded-xl shadow-sm overflow-hidden", children: [_jsx("div", { className: "px-6 py-4 border-b border-gray-200", children: _jsx("h2", { className: "text-xl font-bold text-gray-900", children: "Recent Bills" }) }), _jsx("div", { className: "divide-y divide-gray-200", children: bills.map((bill) => (_jsx("div", { className: "p-6 hover:bg-gray-50 transition-colors", children: _jsx("div", { className: "flex items-start justify-between", children: _jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center gap-3 mb-2", children: [getStatusIcon(bill.status), _jsx("h3", { className: "font-semibold text-gray-900", children: bill.description }), _jsx("span", { className: `px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(bill.status)}`, children: bill.status.charAt(0).toUpperCase() + bill.status.slice(1) })] }), _jsxs("div", { className: "grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-gray-600 mt-3", children: [_jsxs("div", { children: [_jsx("p", { className: "font-medium text-gray-500", children: "Visit Date" }), _jsx("p", { children: formatNigerianDate(bill.visitDate) })] }), _jsxs("div", { children: [_jsx("p", { className: "font-medium text-gray-500", children: "Total Amount" }), _jsxs("p", { className: "font-semibold text-gray-900", children: ["\u20A6", bill.amount.toLocaleString()] })] }), _jsxs("div", { children: [_jsx("p", { className: "font-medium text-gray-500", children: "Amount Paid" }), _jsxs("p", { className: "font-semibold text-green-600", children: ["\u20A6", bill.amountPaid.toLocaleString()] })] }), _jsxs("div", { children: [_jsx("p", { className: "font-medium text-gray-500", children: "Balance" }), _jsxs("p", { className: "font-semibold text-red-600", children: ["\u20A6", (bill.amount - bill.amountPaid).toLocaleString()] })] })] }), _jsxs("div", { className: "flex items-center gap-4 mt-4", children: [bill.status !== 'paid' && (_jsx("button", { onClick: () => handlePayNow(bill), className: "px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium", children: "Pay Now" })), _jsxs("button", { onClick: () => handleDownloadReceipt(bill.id), className: "px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium flex items-center gap-2", children: [_jsx(ArrowDownTrayIcon, { className: "w-4 h-4" }), "Download Receipt"] })] })] }) }) }, bill.id))) })] }), showPaymentModal && selectedBill && (_jsx("div", { className: "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50", children: _jsxs("div", { className: "bg-white rounded-xl max-w-md w-full p-6", children: [_jsx("h2", { className: "text-2xl font-bold text-gray-900 mb-4", children: "Make Payment" }), _jsxs("div", { className: "bg-gray-50 rounded-lg p-4 mb-6", children: [_jsx("p", { className: "text-sm text-gray-600", children: "Bill Description" }), _jsx("p", { className: "font-semibold text-gray-900", children: selectedBill.description }), _jsx("p", { className: "text-sm text-gray-600 mt-2", children: "Amount Due" }), _jsxs("p", { className: "text-2xl font-bold text-gray-900", children: ["\u20A6", (selectedBill.amount - selectedBill.amountPaid).toLocaleString()] })] }), _jsxs("form", { onSubmit: handleSubmitPayment, className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Payment Amount (\u20A6)" }), _jsx("input", { type: "number", value: paymentAmount, onChange: (e) => setPaymentAmount(e.target.value), min: "1", max: selectedBill.amount - selectedBill.amountPaid, required: true, className: "w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Payment Method" }), _jsxs("select", { value: paymentMethod, onChange: (e) => setPaymentMethod(e.target.value), className: "w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent", children: [_jsx("option", { value: "card", children: "Debit/Credit Card" }), _jsx("option", { value: "bank_transfer", children: "Bank Transfer" }), _jsx("option", { value: "mobile_money", children: "Mobile Money" }), _jsx("option", { value: "cash", children: "Cash (Pay at Facility)" })] })] }), _jsxs("div", { className: "flex gap-3 pt-4", children: [_jsx("button", { type: "button", onClick: () => {
                                                setShowPaymentModal(false);
                                                setSelectedBill(null);
                                            }, disabled: processing, className: "flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50", children: "Cancel" }), _jsx("button", { type: "submit", disabled: processing, className: "flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2", children: processing ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" }), "Processing..."] })) : (_jsxs(_Fragment, { children: [_jsx(CreditCardIcon, { className: "w-5 h-5" }), "Pay Now"] })) })] })] })] }) }))] }));
}
