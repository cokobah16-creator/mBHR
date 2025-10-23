import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BeakerIcon } from '@heroicons/react/24/outline';
import { createLabOrder } from '@/services/labs';
import { useToast } from '@/stores/toast';
const labOrderSchema = z.object({
    testName: z.string().min(1, 'Test name is required'),
    testCode: z.string().optional(),
    priority: z.enum(['routine', 'urgent', 'stat']),
    notes: z.string().optional(),
});
const commonTests = [
    { name: 'Complete Blood Count (CBC)', code: 'CBC' },
    { name: 'Basic Metabolic Panel', code: 'BMP' },
    { name: 'Comprehensive Metabolic Panel', code: 'CMP' },
    { name: 'Lipid Panel', code: 'LIPID' },
    { name: 'Hemoglobin A1C', code: 'HBA1C' },
    { name: 'Thyroid Stimulating Hormone', code: 'TSH' },
    { name: 'Urinalysis', code: 'UA' },
    { name: 'Blood Glucose', code: 'GLUCOSE' },
    { name: 'Liver Function Tests', code: 'LFT' },
    { name: 'Kidney Function Tests', code: 'RFT' },
    { name: 'HIV Test', code: 'HIV' },
    { name: 'Hepatitis B Surface Antigen', code: 'HBSAG' },
    { name: 'Malaria Rapid Test', code: 'MRDTrunc' },
    { name: 'Pregnancy Test', code: 'PREG' },
    { name: 'Stool Analysis', code: 'STOOL' },
];
export function LabOrderForm({ patientId, visitId, orderedBy, onSuccess, onCancel }) {
    const [submitting, setSubmitting] = useState(false);
    const toast = useToast();
    const { register, handleSubmit, formState: { errors }, setValue, watch, } = useForm({
        resolver: zodResolver(labOrderSchema),
        defaultValues: {
            priority: 'routine',
        },
    });
    const selectedTest = watch('testName');
    const handleQuickSelect = (testName, testCode) => {
        setValue('testName', testName);
        setValue('testCode', testCode);
    };
    const onSubmit = async (data) => {
        try {
            setSubmitting(true);
            await createLabOrder({
                patientId,
                visitId,
                orderedBy,
                testName: data.testName,
                testCode: data.testCode,
                priority: data.priority,
                status: 'ordered',
                clinicalNotes: data.notes,
            });
            toast.push({ id: Date.now().toString(), title: 'Lab order created successfully' });
            onSuccess?.();
        }
        catch (error) {
            console.error('Failed to create lab order:', error);
            toast.push({ id: Date.now().toString(), title: 'Failed to create lab order' });
        }
        finally {
            setSubmitting(false);
        }
    };
    return (_jsxs("div", { className: "bg-white rounded-lg shadow", children: [_jsx("div", { className: "px-4 py-5 sm:px-6 border-b border-gray-200", children: _jsxs("div", { className: "flex items-center", children: [_jsx(BeakerIcon, { className: "h-6 w-6 text-gray-400 mr-2" }), _jsx("h3", { className: "text-lg font-medium text-gray-900", children: "Order Laboratory Test" })] }) }), _jsxs("form", { onSubmit: handleSubmit(onSubmit), className: "px-4 py-5 sm:p-6 space-y-6", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Quick Select" }), _jsx("div", { className: "grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3", children: commonTests.map((test) => (_jsx("button", { type: "button", onClick: () => handleQuickSelect(test.name, test.code), className: `px-3 py-2 text-sm text-left border rounded-md hover:bg-gray-50 ${selectedTest === test.name
                                        ? 'border-indigo-500 bg-indigo-50'
                                        : 'border-gray-300'}`, children: test.name }, test.code))) })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "testName", className: "block text-sm font-medium text-gray-700", children: "Test Name *" }), _jsx("input", { ...register('testName'), id: "testName", type: "text", className: "mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm", placeholder: "Enter test name or select from quick select" }), errors.testName && (_jsx("p", { className: "mt-1 text-sm text-red-600", children: errors.testName.message }))] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "testCode", className: "block text-sm font-medium text-gray-700", children: "Test Code" }), _jsx("input", { ...register('testCode'), id: "testCode", type: "text", className: "mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm", placeholder: "Optional test code" })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "priority", className: "block text-sm font-medium text-gray-700", children: "Priority *" }), _jsxs("select", { ...register('priority'), id: "priority", className: "mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm", children: [_jsx("option", { value: "routine", children: "Routine" }), _jsx("option", { value: "urgent", children: "Urgent" }), _jsx("option", { value: "stat", children: "STAT (Immediate)" })] })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "notes", className: "block text-sm font-medium text-gray-700", children: "Clinical Notes" }), _jsx("textarea", { ...register('notes'), id: "notes", rows: 3, className: "mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm", placeholder: "Any additional instructions or clinical indications..." })] }), _jsxs("div", { className: "flex justify-end space-x-3 pt-4 border-t", children: [onCancel && (_jsx("button", { type: "button", onClick: onCancel, disabled: submitting, className: "px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50", children: "Cancel" })), _jsx("button", { type: "submit", disabled: submitting, className: "inline-flex justify-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50", children: submitting ? 'Ordering...' : 'Order Test' })] })] })] }));
}
