import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BeakerIcon, ExclamationTriangleIcon, XMarkIcon, } from '@heroicons/react/24/outline';
import { getPendingLabOrders, getCriticalResults, addLabResult, reviewLabResult, updateLabOrderStatus, } from '@/services/labs';
import { useToast } from '@/stores/toast';
const resultSchema = z.object({
    resultValue: z.string().min(1, 'Result value is required'),
    resultUnit: z.string().optional(),
    referenceRange: z.string().optional(),
    interpretation: z.enum(['normal', 'abnormal', 'critical']),
    notes: z.string().optional(),
});
export function LabResultsDashboard({ userId }) {
    const [pendingOrders, setPendingOrders] = useState([]);
    const [criticalResults, setCriticalResults] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [showResultForm, setShowResultForm] = useState(false);
    const [tab, setTab] = useState('pending');
    const toast = useToast();
    const { register, handleSubmit, formState: { errors }, reset, } = useForm({
        resolver: zodResolver(resultSchema),
        defaultValues: {
            interpretation: 'normal',
        },
    });
    useEffect(() => {
        loadData();
    }, [tab]);
    const loadData = async () => {
        try {
            setLoading(true);
            if (tab === 'pending') {
                const orders = await getPendingLabOrders();
                setPendingOrders(orders);
            }
            else {
                const results = await getCriticalResults();
                setCriticalResults(results);
            }
        }
        catch (error) {
            console.error('Failed to load data:', error);
        }
        finally {
            setLoading(false);
        }
    };
    const handleCollected = async (orderId) => {
        try {
            await updateLabOrderStatus(orderId, 'collected');
            toast.push({ id: Date.now().toString(), title: 'Specimen marked as collected' });
            await loadData();
        }
        catch (error) {
            console.error('Failed to update status:', error);
            toast.push({ id: Date.now().toString(), title: 'Failed to update status' });
        }
    };
    const handleProcessing = async (orderId) => {
        try {
            await updateLabOrderStatus(orderId, 'processing');
            toast.push({ id: Date.now().toString(), title: 'Test marked as processing' });
            await loadData();
        }
        catch (error) {
            console.error('Failed to update status:', error);
            toast.push({ id: Date.now().toString(), title: 'Failed to update status' });
        }
    };
    const handleAddResult = (order) => {
        setSelectedOrder(order);
        setShowResultForm(true);
    };
    const onSubmitResult = async (data) => {
        if (!selectedOrder)
            return;
        try {
            await addLabResult({
                orderId: selectedOrder.id,
                resultValue: data.resultValue,
                resultUnit: data.resultUnit,
                referenceRange: data.referenceRange,
                interpretation: data.interpretation,
                resultDate: new Date(),
                notes: data.notes,
            });
            await updateLabOrderStatus(selectedOrder.id, 'completed');
            toast.push({ id: Date.now().toString(), title: 'Lab result added successfully' });
            setShowResultForm(false);
            setSelectedOrder(null);
            reset();
            await loadData();
        }
        catch (error) {
            console.error('Failed to add result:', error);
            toast.push({ id: Date.now().toString(), title: 'Failed to add result' });
        }
    };
    const handleReview = async (resultId) => {
        try {
            await reviewLabResult(resultId, userId);
            toast.push({ id: Date.now().toString(), title: 'Result marked as reviewed' });
            await loadData();
        }
        catch (error) {
            console.error('Failed to review result:', error);
            toast.push({ id: Date.now().toString(), title: 'Failed to review result' });
        }
    };
    const getPriorityColor = (priority) => {
        switch (priority) {
            case 'stat':
                return 'text-red-600 bg-red-100';
            case 'urgent':
                return 'text-orange-600 bg-orange-100';
            default:
                return 'text-blue-600 bg-blue-100';
        }
    };
    const getInterpretationColor = (interpretation) => {
        switch (interpretation) {
            case 'critical':
                return 'text-red-600 bg-red-100';
            case 'abnormal':
                return 'text-yellow-600 bg-yellow-100';
            default:
                return 'text-green-600 bg-green-100';
        }
    };
    if (loading) {
        return (_jsx("div", { className: "flex items-center justify-center p-8", children: _jsx("div", { className: "animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" }) }));
    }
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "bg-white rounded-lg shadow", children: [_jsx("div", { className: "px-4 py-5 sm:px-6 border-b border-gray-200", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex items-center", children: [_jsx(BeakerIcon, { className: "h-6 w-6 text-gray-400 mr-2" }), _jsx("h3", { className: "text-lg font-medium text-gray-900", children: "Laboratory Results" })] }), _jsxs("div", { className: "flex space-x-2", children: [_jsxs("button", { onClick: () => setTab('pending'), className: `px-3 py-2 text-sm font-medium rounded-md ${tab === 'pending'
                                                ? 'bg-indigo-100 text-indigo-700'
                                                : 'text-gray-500 hover:text-gray-700'}`, children: ["Pending Orders (", pendingOrders.length, ")"] }), _jsxs("button", { onClick: () => setTab('critical'), className: `px-3 py-2 text-sm font-medium rounded-md ${tab === 'critical'
                                                ? 'bg-red-100 text-red-700'
                                                : 'text-gray-500 hover:text-gray-700'}`, children: ["Critical Results (", criticalResults.length, ")"] })] })] }) }), _jsx("div", { className: "divide-y divide-gray-200", children: tab === 'pending' ? (pendingOrders.length === 0 ? (_jsx("div", { className: "px-4 py-8 text-center text-gray-500", children: "No pending lab orders" })) : (pendingOrders.map((order) => (_jsx("div", { className: "px-4 py-4 sm:px-6 hover:bg-gray-50", children: _jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center", children: [_jsx("span", { className: `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getPriorityColor(order.priority)}`, children: order.priority.toUpperCase() }), _jsx("span", { className: "ml-3 text-sm font-medium text-gray-900", children: order.testName }), order.testCode && (_jsxs("span", { className: "ml-2 text-sm text-gray-500", children: ["(", order.testCode, ")"] }))] }), _jsxs("div", { className: "mt-2 text-sm text-gray-500", children: ["Status: ", _jsx("span", { className: "font-medium", children: order.status })] }), _jsxs("div", { className: "mt-1 text-sm text-gray-500", children: ["Ordered: ", order.orderedAt ? new Date(order.orderedAt).toLocaleString() : 'N/A'] })] }), _jsxs("div", { className: "flex flex-col space-y-2 ml-4", children: [order.status === 'ordered' && (_jsx("button", { onClick: () => handleCollected(order.id), className: "px-3 py-1 text-xs font-medium text-blue-700 bg-blue-100 rounded-md hover:bg-blue-200", children: "Mark Collected" })), order.status === 'collected' && (_jsx("button", { onClick: () => handleProcessing(order.id), className: "px-3 py-1 text-xs font-medium text-purple-700 bg-purple-100 rounded-md hover:bg-purple-200", children: "Start Processing" })), order.status === 'processing' && (_jsx("button", { onClick: () => handleAddResult(order), className: "px-3 py-1 text-xs font-medium text-green-700 bg-green-100 rounded-md hover:bg-green-200", children: "Add Result" }))] })] }) }, order.id))))) : criticalResults.length === 0 ? (_jsx("div", { className: "px-4 py-8 text-center text-gray-500", children: "No critical results pending review" })) : (criticalResults.map((result) => (_jsx("div", { className: "px-4 py-4 sm:px-6 bg-red-50 border-l-4 border-red-600", children: _jsxs("div", { className: "flex items-start justify-between", children: [_jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center", children: [_jsx(ExclamationTriangleIcon, { className: "h-5 w-5 text-red-600 mr-2" }), _jsx("span", { className: "text-sm font-medium text-gray-900", children: "CRITICAL RESULT" })] }), _jsxs("div", { className: "mt-2 text-sm", children: [_jsxs("span", { className: "font-medium", children: [result.testName, ":"] }), ' ', result.resultValue, " ", result.resultUnit] }), result.referenceRange && (_jsxs("div", { className: "mt-1 text-sm text-gray-600", children: ["Reference: ", result.referenceRange] })), result.notes && (_jsxs("div", { className: "mt-1 text-sm text-gray-600", children: ["Notes: ", result.notes] })), _jsxs("div", { className: "mt-1 text-sm text-gray-500", children: ["Result Date: ", result.resultDate ? new Date(result.resultDate).toLocaleString() : 'N/A'] })] }), !result.reviewedBy && (_jsx("button", { onClick: () => handleReview(result.id), className: "px-3 py-1 text-xs font-medium text-white bg-red-600 rounded-md hover:bg-red-700", children: "Mark Reviewed" }))] }) }, result.id)))) }), _jsx("div", { className: "px-4 py-3 bg-gray-50 text-right sm:px-6", children: _jsx("button", { onClick: loadData, className: "inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700", children: "Refresh" }) })] }), showResultForm && selectedOrder && (_jsx("div", { className: "fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center p-4 z-50", children: _jsxs("div", { className: "bg-white rounded-lg shadow-xl max-w-2xl w-full", children: [_jsxs("div", { className: "px-4 py-5 sm:px-6 border-b border-gray-200 flex items-center justify-between", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-lg font-medium text-gray-900", children: "Enter Lab Result" }), _jsx("p", { className: "mt-1 text-sm text-gray-500", children: selectedOrder.testName })] }), _jsx("button", { onClick: () => {
                                        setShowResultForm(false);
                                        setSelectedOrder(null);
                                        reset();
                                    }, className: "text-gray-400 hover:text-gray-500", children: _jsx(XMarkIcon, { className: "h-6 w-6" }) })] }), _jsxs("form", { onSubmit: handleSubmit(onSubmitResult), className: "px-4 py-5 sm:p-6 space-y-4", children: [_jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "Result Value *" }), _jsx("input", { ...register('resultValue'), type: "text", className: "mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm", placeholder: "e.g., 12.5" }), errors.resultValue && (_jsx("p", { className: "mt-1 text-sm text-red-600", children: errors.resultValue.message }))] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "Unit" }), _jsx("input", { ...register('resultUnit'), type: "text", className: "mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm", placeholder: "e.g., g/dL, mg/dL" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "Reference Range" }), _jsx("input", { ...register('referenceRange'), type: "text", className: "mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm", placeholder: "e.g., 12-16 g/dL" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "Interpretation *" }), _jsxs("select", { ...register('interpretation'), className: "mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm", children: [_jsx("option", { value: "normal", children: "Normal" }), _jsx("option", { value: "abnormal", children: "Abnormal" }), _jsx("option", { value: "critical", children: "Critical" })] }), errors.interpretation && (_jsx("p", { className: "mt-1 text-sm text-red-600", children: errors.interpretation.message }))] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700", children: "Notes" }), _jsx("textarea", { ...register('notes'), rows: 3, className: "mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm", placeholder: "Any additional notes or observations..." })] }), _jsxs("div", { className: "flex justify-end space-x-3 pt-4 border-t", children: [_jsx("button", { type: "button", onClick: () => {
                                                setShowResultForm(false);
                                                setSelectedOrder(null);
                                                reset();
                                            }, className: "px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50", children: "Cancel" }), _jsx("button", { type: "submit", className: "px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700", children: "Submit Result" })] })] })] }) }))] }));
}
