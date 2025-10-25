import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowRightIcon, PhoneIcon, CalendarIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { requestOTP, registerPatientPortalAccount } from '@/services/patientPortalAuth';
import { OTPInput } from './OTPInput';
const registrationSchema = z.object({
    phone: z.string().min(10, 'Phone number must be at least 10 digits').regex(/^\+?[\d\s-]+$/, 'Invalid phone number'),
    email: z.string().email('Invalid email address').optional().or(z.literal('')),
    dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
    consentGiven: z.boolean().refine(val => val === true, 'You must accept the terms to continue')
});
export function PatientRegister() {
    const navigate = useNavigate();
    const [step, setStep] = useState('info');
    const [formData, setFormData] = useState(null);
    const [otp, setOtp] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const form = useForm({
        resolver: zodResolver(registrationSchema),
        defaultValues: {
            phone: '',
            email: '',
            dob: '',
            consentGiven: false
        }
    });
    const handleSubmitInfo = async (data) => {
        setLoading(true);
        setError('');
        try {
            const result = await requestOTP({
                phone: data.phone,
                email: data.email || undefined,
                purpose: 'registration'
            });
            if (result.success) {
                setFormData(data);
                setStep('otp');
            }
            else {
                setError(result.error || 'Failed to send verification code');
            }
        }
        catch (err) {
            setError('An error occurred. Please try again.');
        }
        finally {
            setLoading(false);
        }
    };
    const handleVerifyOTP = async () => {
        if (!formData || otp.length !== 6) {
            setError('Please enter complete 6-digit code');
            return;
        }
        setLoading(true);
        setError('');
        try {
            const result = await registerPatientPortalAccount(formData.phone, formData.email || undefined, otp, formData.dob);
            if (result.success && result.sessionToken) {
                localStorage.setItem('patient_session_token', result.sessionToken);
                localStorage.setItem('patient_portal_user', JSON.stringify(result.portalUser));
                setStep('success');
                setTimeout(() => navigate('/patient/dashboard'), 2000);
            }
            else {
                setError(result.error || 'Registration failed');
                setOtp('');
            }
        }
        catch (err) {
            setError('An error occurred. Please try again.');
            setOtp('');
        }
        finally {
            setLoading(false);
        }
    };
    return (_jsx("div", { className: "min-h-screen bg-gradient-to-br from-green-50 to-green-100 flex items-center justify-center p-4", children: _jsxs("div", { className: "w-full max-w-md", children: [_jsxs("div", { className: "bg-white rounded-2xl shadow-xl p-8", children: [step === 'info' && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "text-center mb-8", children: [_jsx("div", { className: "inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4", children: _jsx(PhoneIcon, { className: "w-8 h-8 text-green-600" }) }), _jsx("h1", { className: "text-2xl font-bold text-gray-900 mb-2", children: "Create Your Account" }), _jsx("p", { className: "text-gray-600", children: "Join the mBHR Patient Portal for easy access to your health records" })] }), error && (_jsx("div", { className: "mb-6 p-4 bg-red-50 border border-red-200 rounded-lg", children: _jsx("p", { className: "text-sm text-red-800", children: error }) })), _jsxs("form", { onSubmit: form.handleSubmit(handleSubmitInfo), className: "space-y-6", children: [_jsxs("div", { children: [_jsx("label", { htmlFor: "phone", className: "block text-sm font-medium text-gray-700 mb-2", children: "Phone Number *" }), _jsx("input", { ...form.register('phone'), type: "tel", id: "phone", placeholder: "+234 XXX XXX XXXX", className: "w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent", disabled: loading }), form.formState.errors.phone && (_jsx("p", { className: "mt-2 text-sm text-red-600", children: form.formState.errors.phone.message })), _jsx("p", { className: "mt-1 text-xs text-gray-500", children: "This must match your patient record phone number" })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "email", className: "block text-sm font-medium text-gray-700 mb-2", children: "Email Address (Optional)" }), _jsx("input", { ...form.register('email'), type: "email", id: "email", placeholder: "your.email@example.com", className: "w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent", disabled: loading }), form.formState.errors.email && (_jsx("p", { className: "mt-2 text-sm text-red-600", children: form.formState.errors.email.message }))] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "dob", className: "block text-sm font-medium text-gray-700 mb-2", children: "Date of Birth *" }), _jsx("input", { ...form.register('dob'), type: "date", id: "dob", className: "w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent", disabled: loading }), form.formState.errors.dob && (_jsx("p", { className: "mt-2 text-sm text-red-600", children: form.formState.errors.dob.message })), _jsx("p", { className: "mt-1 text-xs text-gray-500", children: "This must match your patient record date of birth" })] }), _jsxs("div", { className: "bg-blue-50 border border-blue-200 rounded-lg p-4", children: [_jsx("h3", { className: "text-sm font-semibold text-blue-900 mb-2", children: "Identity Verification" }), _jsx("p", { className: "text-xs text-blue-800", children: "To protect your privacy, we'll verify your identity by matching your phone number and date of birth with our patient records." })] }), _jsxs("div", { className: "flex items-start gap-3", children: [_jsx("input", { ...form.register('consentGiven'), type: "checkbox", id: "consent", className: "mt-1 w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500", disabled: loading }), _jsxs("label", { htmlFor: "consent", className: "text-sm text-gray-700", children: ["I agree to the", ' ', _jsx("a", { href: "#", className: "text-green-600 hover:text-green-700 font-medium", children: "Terms of Service" }), ' ', "and", ' ', _jsx("a", { href: "#", className: "text-green-600 hover:text-green-700 font-medium", children: "Privacy Policy" }), ". I consent to access my medical records through this portal."] })] }), form.formState.errors.consentGiven && (_jsx("p", { className: "text-sm text-red-600", children: form.formState.errors.consentGiven.message })), _jsx("button", { type: "submit", disabled: loading, className: "w-full flex items-center justify-center gap-2 bg-green-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors", children: loading ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" }), "Processing..."] })) : (_jsxs(_Fragment, { children: ["Continue to Verification", _jsx(ArrowRightIcon, { className: "w-5 h-5" })] })) }), _jsx("div", { className: "text-center", children: _jsxs("p", { className: "text-sm text-gray-600", children: ["Already have an account?", ' ', _jsx("button", { type: "button", onClick: () => navigate('/patient/login'), className: "text-green-600 hover:text-green-700 font-medium", children: "Login here" })] }) })] })] })), step === 'otp' && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "text-center mb-8", children: [_jsx("div", { className: "inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4", children: _jsx(CalendarIcon, { className: "w-8 h-8 text-green-600" }) }), _jsx("h1", { className: "text-2xl font-bold text-gray-900 mb-2", children: "Verify Your Phone" }), _jsxs("p", { className: "text-gray-600", children: ["Enter the 6-digit code sent to ", formData?.phone] })] }), error && (_jsx("div", { className: "mb-6 p-4 bg-red-50 border border-red-200 rounded-lg", children: _jsx("p", { className: "text-sm text-red-800", children: error }) })), _jsxs("div", { className: "space-y-6", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-4 text-center", children: "Verification Code" }), _jsx(OTPInput, { value: otp, onChange: setOtp, disabled: loading, error: !!error })] }), _jsx("button", { onClick: handleVerifyOTP, disabled: loading || otp.length !== 6, className: "w-full flex items-center justify-center gap-2 bg-green-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors", children: loading ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" }), "Creating Account..."] })) : (_jsxs(_Fragment, { children: ["Complete Registration", _jsx(ArrowRightIcon, { className: "w-5 h-5" })] })) }), _jsx("div", { className: "text-center", children: _jsx("button", { type: "button", onClick: () => {
                                                    setStep('info');
                                                    setOtp('');
                                                    setError('');
                                                }, className: "text-sm text-green-600 hover:text-green-700 font-medium", children: "Go back to edit information" }) })] })] })), step === 'success' && (_jsxs("div", { className: "text-center py-8", children: [_jsx("div", { className: "inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-6", children: _jsx(CheckCircleIcon, { className: "w-12 h-12 text-green-600" }) }), _jsx("h1", { className: "text-2xl font-bold text-gray-900 mb-2", children: "Account Created!" }), _jsx("p", { className: "text-gray-600 mb-6", children: "Welcome to the mBHR Patient Portal. You'll be redirected to your dashboard shortly." }), _jsx("div", { className: "flex justify-center", children: _jsx("div", { className: "w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin" }) })] }))] }), _jsxs("div", { className: "mt-6 text-center text-sm text-gray-600", children: [_jsx("p", { children: "Med Bridge Health Reach" }), _jsx("p", { className: "mt-1", children: "Secure patient portal powered by mBHR" })] })] }) }));
}
