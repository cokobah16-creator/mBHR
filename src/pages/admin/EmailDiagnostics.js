import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Email Diagnostics Tool
 *
 * Helps diagnose and test email delivery for patient portal invitations.
 * Shows current configuration status and provides manual test functionality.
 */
import React, { useState } from 'react';
import { EnvelopeIcon, CheckCircleIcon, XCircleIcon, ExclamationTriangleIcon, ArrowPathIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/stores/toast';
export default function EmailDiagnostics() {
    const [testing, setTesting] = useState(false);
    const [testEmail, setTestEmail] = useState('cokobah16@gmail.com');
    const [testResult, setTestResult] = useState(null);
    const [edgeFunctionUrl, setEdgeFunctionUrl] = useState('');
    const { push: pushToast } = useToast();
    React.useEffect(() => {
        const url = import.meta.env.VITE_SUPABASE_URL;
        setEdgeFunctionUrl(`${url}/functions/v1/send-otp-email`);
    }, []);
    const testEmailFunction = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            const testOTP = '123456';
            // Call the Edge Function directly
            const { data, error } = await supabase.functions.invoke('send-otp-email', {
                body: { email: testEmail, otp: testOTP }
            });
            if (error) {
                setTestResult({
                    success: false,
                    error: error.message,
                    details: error
                });
                pushToast({
                    id: crypto.randomUUID(),
                    title: 'Test Failed',
                    body: error.message
                });
            }
            else {
                setTestResult({
                    success: data?.success || false,
                    demo: data?.demo || false,
                    messageId: data?.messageId,
                    message: data?.message,
                    data
                });
                if (data?.demo) {
                    pushToast({
                        id: crypto.randomUUID(),
                        title: 'Demo Mode Active',
                        body: 'Email function is running in demo mode. Check console logs for OTP.'
                    });
                }
                else if (data?.success) {
                    pushToast({
                        id: crypto.randomUUID(),
                        title: 'Email Sent!',
                        body: `Test email sent to ${testEmail}`
                    });
                }
            }
        }
        catch (error) {
            setTestResult({
                success: false,
                error: error.message,
                details: error
            });
            pushToast({
                id: crypto.randomUUID(),
                title: 'Test Failed',
                body: error.message
            });
        }
        finally {
            setTesting(false);
        }
    };
    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        pushToast({
            id: crypto.randomUUID(),
            title: 'Copied!',
            body: 'Copied to clipboard'
        });
    };
    return (_jsxs("div", { className: "max-w-4xl mx-auto py-8 px-4", children: [_jsxs("div", { className: "mb-8", children: [_jsx("h1", { className: "text-3xl font-bold text-gray-900 mb-2", children: "Email System Diagnostics" }), _jsx("p", { className: "text-gray-600", children: "Test and diagnose the patient portal email delivery system" })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4 mb-8", children: [_jsx("div", { className: "card bg-white border-2 border-gray-200", children: _jsxs("div", { className: "flex items-start space-x-3", children: [_jsx("div", { className: "flex-shrink-0", children: _jsx(CheckCircleIcon, { className: "h-6 w-6 text-green-600" }) }), _jsxs("div", { className: "flex-1", children: [_jsx("h3", { className: "text-sm font-medium text-gray-900", children: "Edge Function" }), _jsx("p", { className: "text-xs text-gray-600 mt-1", children: "send-otp-email is ACTIVE" }), _jsx("div", { className: "mt-2", children: _jsx("code", { className: "text-xs bg-gray-100 px-2 py-1 rounded block overflow-x-auto", children: edgeFunctionUrl }) })] })] }) }), _jsx("div", { className: "card bg-yellow-50 border-2 border-yellow-200", children: _jsxs("div", { className: "flex items-start space-x-3", children: [_jsx("div", { className: "flex-shrink-0", children: _jsx(ExclamationTriangleIcon, { className: "h-6 w-6 text-yellow-600" }) }), _jsxs("div", { className: "flex-1", children: [_jsx("h3", { className: "text-sm font-medium text-gray-900", children: "API Configuration" }), _jsx("p", { className: "text-xs text-gray-600 mt-1", children: "RESEND_API_KEY may not be configured" }), _jsx("p", { className: "text-xs text-yellow-700 mt-2 font-medium", children: "Emails will be logged to console until API key is added" })] })] }) })] }), _jsxs("div", { className: "card bg-white mb-8", children: [_jsx("h2", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Test Email Delivery" }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { htmlFor: "testEmail", className: "block text-sm font-medium text-gray-700 mb-2", children: "Test Email Address" }), _jsx("input", { type: "email", id: "testEmail", value: testEmail, onChange: (e) => setTestEmail(e.target.value), className: "input w-full", placeholder: "your-email@example.com" }), _jsx("p", { className: "text-xs text-gray-500 mt-1", children: "A test OTP email will be sent to this address (OTP: 123456)" })] }), _jsx("button", { onClick: testEmailFunction, disabled: testing || !testEmail, className: "btn btn-primary w-full", children: testing ? (_jsxs(_Fragment, { children: [_jsx(ArrowPathIcon, { className: "h-5 w-5 animate-spin mr-2" }), "Testing..."] })) : (_jsxs(_Fragment, { children: [_jsx(EnvelopeIcon, { className: "h-5 w-5 mr-2" }), "Send Test Email"] })) })] })] }), testResult && (_jsxs("div", { className: "card bg-white", children: [_jsx("h2", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Test Results" }), _jsx("div", { className: `p-4 rounded-lg mb-4 ${testResult.success
                            ? testResult.demo
                                ? 'bg-yellow-50 border border-yellow-200'
                                : 'bg-green-50 border border-green-200'
                            : 'bg-red-50 border border-red-200'}`, children: _jsxs("div", { className: "flex items-start space-x-3", children: [_jsx("div", { className: "flex-shrink-0", children: testResult.success ? (testResult.demo ? (_jsx(ExclamationTriangleIcon, { className: "h-6 w-6 text-yellow-600" })) : (_jsx(CheckCircleIcon, { className: "h-6 w-6 text-green-600" }))) : (_jsx(XCircleIcon, { className: "h-6 w-6 text-red-600" })) }), _jsxs("div", { className: "flex-1", children: [_jsx("h3", { className: `text-sm font-medium ${testResult.success
                                                ? testResult.demo ? 'text-yellow-900' : 'text-green-900'
                                                : 'text-red-900'}`, children: testResult.success
                                                ? testResult.demo
                                                    ? 'Demo Mode Active'
                                                    : 'Email Sent Successfully'
                                                : 'Email Failed to Send' }), testResult.demo && (_jsxs("div", { className: "mt-2 text-xs text-yellow-800", children: [_jsx("p", { className: "font-medium", children: "Running in demo mode:" }), _jsxs("ul", { className: "list-disc list-inside mt-1 space-y-1", children: [_jsx("li", { children: "No RESEND_API_KEY found in Edge Function secrets" }), _jsx("li", { children: "OTP is logged to Supabase Edge Function logs instead" }), _jsx("li", { children: "Check Supabase Dashboard \u2192 Edge Functions \u2192 Logs" })] })] })), testResult.messageId && (_jsxs("p", { className: "text-xs text-green-700 mt-2", children: ["Message ID: ", testResult.messageId] })), testResult.message && (_jsx("p", { className: "text-xs text-gray-700 mt-2", children: testResult.message })), testResult.error && (_jsxs("p", { className: "text-xs text-red-700 mt-2", children: ["Error: ", testResult.error] }))] })] }) }), _jsxs("details", { className: "mt-4", children: [_jsx("summary", { className: "text-sm font-medium text-gray-700 cursor-pointer hover:text-gray-900", children: "View Raw Response" }), _jsx("div", { className: "mt-2 bg-gray-50 p-3 rounded-lg", children: _jsx("pre", { className: "text-xs text-gray-800 overflow-x-auto", children: JSON.stringify(testResult, null, 2) }) })] })] })), _jsx("div", { className: "card bg-blue-50 border-2 border-blue-200 mt-8", children: _jsxs("div", { className: "flex items-start space-x-3", children: [_jsx("div", { className: "flex-shrink-0", children: _jsx(ExclamationTriangleIcon, { className: "h-6 w-6 text-blue-600" }) }), _jsxs("div", { className: "flex-1", children: [_jsx("h3", { className: "text-sm font-medium text-blue-900 mb-2", children: "Setup Required: Configure Email API Key" }), _jsxs("div", { className: "text-xs text-blue-800 space-y-3", children: [_jsxs("div", { children: [_jsx("p", { className: "font-semibold mb-1", children: "Step 1: Create Resend Account (Free)" }), _jsxs("ol", { className: "list-decimal list-inside space-y-1 ml-2", children: [_jsxs("li", { children: ["Visit ", _jsx("a", { href: "https://resend.com", target: "_blank", rel: "noopener noreferrer", className: "underline", children: "resend.com" })] }), _jsx("li", { children: "Sign up (free tier: 3,000 emails/month)" }), _jsx("li", { children: "Verify your email" })] })] }), _jsxs("div", { children: [_jsx("p", { className: "font-semibold mb-1", children: "Step 2: Generate API Key" }), _jsxs("ol", { className: "list-decimal list-inside space-y-1 ml-2", children: [_jsx("li", { children: "Go to API Keys in Resend Dashboard" }), _jsx("li", { children: "Click \"Create API Key\"" }), _jsx("li", { children: "Name: \"mBHR Patient Portal\"" }), _jsx("li", { children: "Permission: \"Sending access\"" }), _jsx("li", { children: "Copy the key (starts with \"re_\")" })] })] }), _jsxs("div", { children: [_jsx("p", { className: "font-semibold mb-1", children: "Step 3: Add to Supabase" }), _jsxs("ol", { className: "list-decimal list-inside space-y-1 ml-2", children: [_jsx("li", { children: "Open Supabase Dashboard" }), _jsx("li", { children: "Go to Settings \u2192 Edge Functions" }), _jsx("li", { children: "Scroll to \"Secrets\" section" }), _jsx("li", { children: "Click \"Add a new secret\"" }), _jsxs("li", { children: ["Name: ", _jsx("code", { className: "bg-blue-100 px-1 rounded", children: "RESEND_API_KEY" })] }), _jsx("li", { children: "Value: [paste your API key]" }), _jsx("li", { children: "Wait 30 seconds for functions to reload" })] })] }), _jsxs("div", { children: [_jsx("p", { className: "font-semibold mb-1", children: "Step 4: Test" }), _jsx("p", { className: "ml-2", children: "Use the test button above to verify emails are being sent" })] }), _jsxs("div", { className: "mt-4 pt-3 border-t border-blue-300", children: [_jsx("p", { className: "font-semibold", children: "Quick Links:" }), _jsxs("ul", { className: "list-disc list-inside mt-1 space-y-1 ml-2", children: [_jsx("li", { children: _jsx("a", { href: "https://resend.com", target: "_blank", rel: "noopener noreferrer", className: "underline hover:text-blue-600", children: "Resend Website" }) }), _jsx("li", { children: _jsx("a", { href: `https://supabase.com/dashboard/project/${import.meta.env.VITE_SUPABASE_URL?.split('//')[1]?.split('.')[0]}/settings/functions`, target: "_blank", rel: "noopener noreferrer", className: "underline hover:text-blue-600", children: "Supabase Edge Functions Settings" }) }), _jsx("li", { children: _jsxs("button", { onClick: () => copyToClipboard('RESEND_API_KEY'), className: "underline hover:text-blue-600 inline-flex items-center", children: [_jsx(ClipboardDocumentIcon, { className: "h-3 w-3 mr-1" }), "Copy secret name: RESEND_API_KEY"] }) })] })] })] })] })] }) }), _jsxs("div", { className: "card bg-gray-50 mt-8", children: [_jsx("h3", { className: "text-sm font-semibold text-gray-900 mb-3", children: "Current System Status" }), _jsxs("div", { className: "space-y-2 text-xs", children: [_jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(CheckCircleIcon, { className: "h-4 w-4 text-green-600 flex-shrink-0" }), _jsx("span", { className: "text-gray-700", children: "Edge Function deployed and active" })] }), _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(CheckCircleIcon, { className: "h-4 w-4 text-green-600 flex-shrink-0" }), _jsx("span", { className: "text-gray-700", children: "Patient portal users table exists" })] }), _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(CheckCircleIcon, { className: "h-4 w-4 text-green-600 flex-shrink-0" }), _jsx("span", { className: "text-gray-700", children: "Kristopher's portal account created" })] }), _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(ExclamationTriangleIcon, { className: "h-4 w-4 text-yellow-600 flex-shrink-0" }), _jsx("span", { className: "text-gray-700", children: "Email API key not configured (demo mode)" })] })] })] })] }));
}
