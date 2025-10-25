import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { formatNigerianDate } from '@/utils/dateFormat';
import { DocumentCheckIcon, CheckCircleIcon, ClockIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import * as logger from '@/lib/logger';
const preVisitFormSchema = z.object({
    chiefComplaint: z.string().min(5, 'Please describe your symptoms'),
    symptomDuration: z.string().min(1, 'Required'),
    currentMedications: z.string(),
    allergies: z.string(),
    recentHospitalVisits: z.string(),
    smokingStatus: z.enum(['never', 'former', 'current']),
    alcoholUse: z.enum(['never', 'occasional', 'regular']),
    exerciseFrequency: z.string(),
    additionalNotes: z.string()
});
export function PreVisitForms() {
    const [forms, setForms] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedForm, setSelectedForm] = useState(null);
    const [showFormModal, setShowFormModal] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const { register, handleSubmit, formState: { errors }, reset } = useForm({
        resolver: zodResolver(preVisitFormSchema)
    });
    useEffect(() => {
        loadForms();
    }, []);
    const loadForms = async () => {
        setLoading(true);
        try {
            const portalUser = JSON.parse(localStorage.getItem('patient_portal_user') || '{}');
            if (!portalUser.patientId) {
                logger.error('No patient ID found');
                return;
            }
            // Mock data - replace with actual API calls
            const mockForms = [
                {
                    id: 'form-1',
                    appointmentId: 'apt-1',
                    appointmentDate: new Date('2025-11-05'),
                    appointmentType: 'General Consultation',
                    status: 'pending'
                },
                {
                    id: 'form-2',
                    appointmentId: 'apt-2',
                    appointmentDate: new Date('2025-10-15'),
                    appointmentType: 'Follow-up Visit',
                    status: 'completed',
                    submittedAt: new Date('2025-10-13'),
                    data: {
                        chiefComplaint: 'Follow-up on blood pressure medication',
                        symptomDuration: '3 months',
                        currentMedications: 'Lisinopril 10mg daily',
                        allergies: 'None',
                        recentHospitalVisits: 'None',
                        smokingStatus: 'never',
                        alcoholUse: 'occasional',
                        exerciseFrequency: '3 times per week',
                        additionalNotes: 'BP readings have been stable'
                    }
                }
            ];
            setForms(mockForms);
        }
        catch (err) {
            logger.error('Error loading forms:', err);
        }
        finally {
            setLoading(false);
        }
    };
    const handleFillForm = (form) => {
        setSelectedForm(form);
        if (form.data) {
            reset(form.data);
        }
        else {
            reset({
                chiefComplaint: '',
                symptomDuration: '',
                currentMedications: '',
                allergies: '',
                recentHospitalVisits: '',
                smokingStatus: 'never',
                alcoholUse: 'never',
                exerciseFrequency: '',
                additionalNotes: ''
            });
        }
        setShowFormModal(true);
    };
    const onSubmit = async (data) => {
        if (!selectedForm)
            return;
        setSubmitting(true);
        try {
            // Mock submission - replace with actual API call
            await new Promise(resolve => setTimeout(resolve, 1500));
            const updatedForms = forms.map(form => {
                if (form.id === selectedForm.id) {
                    return {
                        ...form,
                        status: 'completed',
                        submittedAt: new Date(),
                        data
                    };
                }
                return form;
            });
            setForms(updatedForms);
            setShowFormModal(false);
            setSelectedForm(null);
            reset();
            alert('Form submitted successfully!');
        }
        catch (err) {
            logger.error('Form submission error:', err);
            alert('Failed to submit form. Please try again.');
        }
        finally {
            setSubmitting(false);
        }
    };
    const pendingForms = forms.filter(f => f.status === 'pending');
    const completedForms = forms.filter(f => f.status === 'completed');
    if (loading) {
        return (_jsx("div", { className: "flex items-center justify-center min-h-screen", children: _jsx("div", { className: "w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" }) }));
    }
    return (_jsxs("div", { className: "max-w-7xl mx-auto px-4 py-8 space-y-6", children: [_jsxs("div", { className: "bg-white rounded-xl shadow-sm p-6", children: [_jsx("h1", { className: "text-3xl font-bold text-gray-900", children: "Pre-Visit Forms" }), _jsx("p", { className: "text-gray-600 mt-2", children: "Complete forms before your appointment to save time" })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-6", children: [_jsx("div", { className: "bg-white rounded-xl shadow-sm p-6", children: _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center", children: _jsx(ClockIcon, { className: "w-6 h-6 text-yellow-600" }) }), _jsxs("div", { children: [_jsx("p", { className: "text-sm text-gray-600", children: "Pending Forms" }), _jsx("p", { className: "text-2xl font-bold text-gray-900", children: pendingForms.length })] })] }) }), _jsx("div", { className: "bg-white rounded-xl shadow-sm p-6", children: _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("div", { className: "w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center", children: _jsx(CheckCircleIcon, { className: "w-6 h-6 text-green-600" }) }), _jsxs("div", { children: [_jsx("p", { className: "text-sm text-gray-600", children: "Completed Forms" }), _jsx("p", { className: "text-2xl font-bold text-gray-900", children: completedForms.length })] })] }) })] }), pendingForms.length > 0 && (_jsxs("div", { className: "bg-white rounded-xl shadow-sm overflow-hidden", children: [_jsx("div", { className: "px-6 py-4 border-b border-gray-200 bg-yellow-50", children: _jsxs("h2", { className: "text-xl font-bold text-gray-900 flex items-center gap-2", children: [_jsx(ClockIcon, { className: "w-6 h-6 text-yellow-600" }), "Pending Forms"] }) }), _jsx("div", { className: "divide-y divide-gray-200", children: pendingForms.map((form) => (_jsx("div", { className: "p-6 hover:bg-gray-50 transition-colors", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex-1", children: [_jsx("h3", { className: "font-semibold text-gray-900 text-lg", children: form.appointmentType }), _jsxs("p", { className: "text-gray-600 mt-1", children: ["Appointment: ", formatNigerianDate(form.appointmentDate)] }), _jsx("p", { className: "text-sm text-yellow-600 mt-2", children: "Please complete before your visit" })] }), _jsxs("button", { onClick: () => handleFillForm(form), className: "px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center gap-2", children: [_jsx(DocumentCheckIcon, { className: "w-5 h-5" }), "Fill Form", _jsx(ChevronRightIcon, { className: "w-4 h-4" })] })] }) }, form.id))) })] })), completedForms.length > 0 && (_jsxs("div", { className: "bg-white rounded-xl shadow-sm overflow-hidden", children: [_jsx("div", { className: "px-6 py-4 border-b border-gray-200", children: _jsxs("h2", { className: "text-xl font-bold text-gray-900 flex items-center gap-2", children: [_jsx(CheckCircleIcon, { className: "w-6 h-6 text-green-600" }), "Completed Forms"] }) }), _jsx("div", { className: "divide-y divide-gray-200", children: completedForms.map((form) => (_jsx("div", { className: "p-6 hover:bg-gray-50 transition-colors", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("h3", { className: "font-semibold text-gray-900 text-lg", children: form.appointmentType }), _jsx("span", { className: "px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium", children: "Completed" })] }), _jsxs("p", { className: "text-gray-600 mt-1", children: ["Appointment: ", formatNigerianDate(form.appointmentDate)] }), form.submittedAt && (_jsxs("p", { className: "text-sm text-gray-500 mt-1", children: ["Submitted: ", formatNigerianDate(form.submittedAt)] }))] }), _jsx("button", { onClick: () => handleFillForm(form), className: "px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium", children: "View Form" })] }) }, form.id))) })] })), showFormModal && selectedForm && (_jsx("div", { className: "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 overflow-y-auto", children: _jsxs("div", { className: "bg-white rounded-xl max-w-3xl w-full p-6 my-8", children: [_jsx("h2", { className: "text-2xl font-bold text-gray-900 mb-2", children: "Pre-Visit Medical Form" }), _jsxs("p", { className: "text-gray-600 mb-6", children: [selectedForm.appointmentType, " - ", formatNigerianDate(selectedForm.appointmentDate)] }), _jsxs("form", { onSubmit: handleSubmit(onSubmit), className: "space-y-6", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "What brings you in today? (Chief Complaint) *" }), _jsx("textarea", { ...register('chiefComplaint'), rows: 3, className: "w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent", placeholder: "Describe your symptoms or reason for visit" }), errors.chiefComplaint && (_jsx("p", { className: "text-red-600 text-sm mt-1", children: errors.chiefComplaint.message }))] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "How long have you had these symptoms? *" }), _jsx("input", { ...register('symptomDuration'), type: "text", className: "w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent", placeholder: "e.g., 3 days, 2 weeks" }), errors.symptomDuration && (_jsx("p", { className: "text-red-600 text-sm mt-1", children: errors.symptomDuration.message }))] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Current Medications" }), _jsx("textarea", { ...register('currentMedications'), rows: 2, className: "w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent", placeholder: "List all medications you're currently taking" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Known Allergies" }), _jsx("textarea", { ...register('allergies'), rows: 2, className: "w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent", placeholder: "List any drug or food allergies" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Recent Hospital Visits" }), _jsx("textarea", { ...register('recentHospitalVisits'), rows: 2, className: "w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent", placeholder: "Any recent hospitalizations or ER visits" })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-6", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Smoking Status" }), _jsxs("select", { ...register('smokingStatus'), className: "w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent", children: [_jsx("option", { value: "never", children: "Never smoked" }), _jsx("option", { value: "former", children: "Former smoker" }), _jsx("option", { value: "current", children: "Current smoker" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Alcohol Use" }), _jsxs("select", { ...register('alcoholUse'), className: "w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent", children: [_jsx("option", { value: "never", children: "Never" }), _jsx("option", { value: "occasional", children: "Occasionally" }), _jsx("option", { value: "regular", children: "Regularly" })] })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Exercise Frequency" }), _jsx("input", { ...register('exerciseFrequency'), type: "text", className: "w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent", placeholder: "e.g., 3 times per week" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Additional Notes" }), _jsx("textarea", { ...register('additionalNotes'), rows: 3, className: "w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent", placeholder: "Any other information you'd like to share" })] }), _jsxs("div", { className: "flex gap-3 pt-4 border-t border-gray-200", children: [_jsx("button", { type: "button", onClick: () => {
                                                setShowFormModal(false);
                                                setSelectedForm(null);
                                                reset();
                                            }, disabled: submitting, className: "flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50", children: "Cancel" }), _jsx("button", { type: "submit", disabled: submitting || selectedForm.status === 'completed', className: "flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2", children: submitting ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" }), "Submitting..."] })) : selectedForm.status === 'completed' ? (_jsxs(_Fragment, { children: [_jsx(CheckCircleIcon, { className: "w-5 h-5" }), "Submitted"] })) : (_jsxs(_Fragment, { children: [_jsx(DocumentCheckIcon, { className: "w-5 h-5" }), "Submit Form"] })) })] })] })] }) }))] }));
}
