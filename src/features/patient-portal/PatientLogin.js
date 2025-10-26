import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect, startTransition } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowRightIcon, PhoneIcon, LockClosedIcon } from '@heroicons/react/24/outline';
import { requestOTP, verifyOTP } from '@/services/patientPortalAuth';
import { OTPInput } from './OTPInput';
import { useT } from '@/hooks/useT';
const contactSchema = z.object({
    contact: z.string().min(3, 'Please enter your phone number or email address')
});
const otpSchema = z.object({
    otp: z.string().length(6, 'OTP must be 6 digits')
});
export function PatientLogin() {
    const navigate = useNavigate();
    const t = useT();
    const [step, setStep] = useState('contact');
    const [contact, setContact] = useState('');
    const [isEmail, setIsEmail] = useState(false);
    const [otp, setOtp] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [countdown, setCountdown] = useState(0);
    const [canResend, setCanResend] = useState(false);
    const contactForm = useForm({
        resolver: zodResolver(contactSchema),
        defaultValues: { contact: '' }
    });
    useEffect(() => {
        if (countdown > 0) {
            const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
            return () => clearTimeout(timer);
        }
        else if (countdown === 0 && step === 'otp') {
            setCanResend(true);
        }
    }, [countdown, step]);
    const handleRequestOTP = async (data) => {
        setLoading(true);
        setError('');
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const isEmailAddress = emailRegex.test(data.contact);
        setIsEmail(isEmailAddress);
        try {
            const result = await requestOTP({
                phone: isEmailAddress ? undefined : data.contact,
                email: isEmailAddress ? data.contact : undefined,
                purpose: 'login'
            });
            if (result.success) {
                setContact(data.contact);
                setStep('otp');
                setCountdown(600);
                setCanResend(false);
            }
            else {
                setError(result.error || 'Failed to send OTP');
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
        if (otp.length !== 6) {
            setError('Please enter complete 6-digit code');
            return;
        }
        setLoading(true);
        setError('');
        try {
            const result = await verifyOTP({
                phone: isEmail ? undefined : contact,
                email: isEmail ? contact : undefined,
                otp
            });
            if (result.success && result.sessionToken) {
                localStorage.setItem('patient_session_token', result.sessionToken);
                localStorage.setItem('patient_portal_user', JSON.stringify(result.portalUser));
                startTransition(() => {
                    navigate('/patient/dashboard');
                });
            }
            else {
                setError(result.error || 'Invalid verification code');
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
    const handleResendOTP = async () => {
        if (!canResend)
            return;
        setLoading(true);
        setError('');
        try {
            const result = await requestOTP({
                phone: isEmail ? undefined : contact,
                email: isEmail ? contact : undefined,
                purpose: 'login'
            });
            if (result.success) {
                setCountdown(600);
                setCanResend(false);
                setOtp('');
                setError('');
            }
            else {
                setError(result.error || 'Failed to send OTP');
            }
        }
        catch (err) {
            setError('An error occurred. Please try again.');
        }
        finally {
            setLoading(false);
        }
    };
    const formatCountdown = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };
    return (_jsx("div", { className: "min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center p-4", children: _jsxs("div", { className: "w-full max-w-md", children: [_jsxs("div", { className: "bg-white rounded-2xl shadow-xl p-8", children: [_jsxs("div", { className: "text-center mb-8", children: [_jsx("div", { className: "inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4", children: step === 'contact' ? (_jsx(PhoneIcon, { className: "w-8 h-8 text-blue-600" })) : (_jsx(LockClosedIcon, { className: "w-8 h-8 text-blue-600" })) }), _jsx("h1", { className: "text-2xl font-bold text-gray-900 mb-2", children: step === 'contact' ? 'Patient Portal Login' : 'Verify Your Identity' }), _jsx("p", { className: "text-gray-600", children: step === 'contact'
                                        ? 'Enter your phone number or email address to receive a verification code'
                                        : `Enter the 6-digit code sent to your ${isEmail ? 'email' : 'phone'}` })] }), error && (_jsx("div", { className: "mb-6 p-4 bg-red-50 border border-red-200 rounded-lg", children: _jsx("p", { className: "text-sm text-red-800", children: error }) })), step === 'contact' ? (_jsxs("form", { onSubmit: contactForm.handleSubmit(handleRequestOTP), className: "space-y-6", children: [_jsxs("div", { children: [_jsx("label", { htmlFor: "contact", className: "block text-sm font-medium text-gray-700 mb-2", children: "Phone Number or Email Address" }), _jsx("input", { ...contactForm.register('contact'), type: "text", id: "contact", placeholder: "+234 XXX XXX XXXX or email@example.com", className: "w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent", disabled: loading }), contactForm.formState.errors.contact && (_jsx("p", { className: "mt-2 text-sm text-red-600", children: contactForm.formState.errors.contact.message })), _jsx("p", { className: "mt-1 text-xs text-gray-500", children: "Enter the phone number or email you used to register" })] }), _jsx("button", { type: "submit", disabled: loading, className: "w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors", children: loading ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" }), "Sending Code..."] })) : (_jsxs(_Fragment, { children: ["Continue", _jsx(ArrowRightIcon, { className: "w-5 h-5" })] })) }), _jsx("div", { className: "text-center", children: _jsxs("p", { className: "text-sm text-gray-600", children: ["Don't have an account?", ' ', _jsx("button", { type: "button", onClick: () => navigate('/patient/register'), className: "text-blue-600 hover:text-blue-700 font-medium", children: "Register here" })] }) })] })) : (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-4 text-center", children: "Verification Code" }), _jsx(OTPInput, { value: otp, onChange: setOtp, disabled: loading, error: !!error }), countdown > 0 && (_jsxs("p", { className: "mt-3 text-sm text-center text-gray-600", children: ["Code expires in ", _jsx("span", { className: "font-semibold text-blue-600", children: formatCountdown(countdown) })] }))] }), _jsx("button", { onClick: handleVerifyOTP, disabled: loading || otp.length !== 6, className: "w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors", children: loading ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" }), "Verifying..."] })) : (_jsxs(_Fragment, { children: ["Verify & Login", _jsx(ArrowRightIcon, { className: "w-5 h-5" })] })) }), _jsxs("div", { className: "text-center space-y-2", children: [_jsx("button", { type: "button", onClick: handleResendOTP, disabled: !canResend || loading, className: "text-sm text-blue-600 hover:text-blue-700 font-medium disabled:text-gray-400 disabled:cursor-not-allowed", children: canResend ? 'Resend Code' : `Resend available in ${formatCountdown(countdown)}` }), _jsx("p", { className: "text-sm text-gray-600", children: _jsx("button", { type: "button", onClick: () => {
                                                    setStep('contact');
                                                    setOtp('');
                                                    setError('');
                                                    setCountdown(0);
                                                }, className: "text-blue-600 hover:text-blue-700 font-medium", children: "Use different contact method" }) })] })] }))] }), _jsxs("div", { className: "mt-6 text-center text-sm text-gray-600", children: [_jsx("p", { children: "Med Bridge Health Reach" }), _jsx("p", { className: "mt-1", children: "Secure patient portal powered by mBHR" })] })] }) }));
}
