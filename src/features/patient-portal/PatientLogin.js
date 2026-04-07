import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, startTransition } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRightIcon, PhoneIcon } from "@heroicons/react/24/outline";
import { loginPatientPortal } from "@/services/patientPortalAuth";
const loginSchema = z.object({
    contact: z.string().min(3, "Please enter your phone number or email address"),
    dob: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
});
export function PatientLogin() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const form = useForm({
        resolver: zodResolver(loginSchema),
        defaultValues: { contact: "", dob: "" },
    });
    const handleLogin = async (data) => {
        setLoading(true);
        setError("");
        try {
            const result = await loginPatientPortal(data.contact, data.dob);
            if (result.success && result.sessionToken) {
                localStorage.setItem("patient_session_token", result.sessionToken);
                localStorage.setItem("patient_portal_user", JSON.stringify(result.portalUser));
                startTransition(() => navigate("/patient/dashboard"));
            }
            else {
                setError(result.error || "Could not log in");
            }
        }
        catch {
            setError("An error occurred. Please try again.");
        }
        finally {
            setLoading(false);
        }
    };
    return (_jsx("div", { className: "min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center p-4", children: _jsxs("div", { className: "w-full max-w-md", children: [_jsxs("div", { className: "bg-white rounded-2xl shadow-xl p-8", children: [_jsxs("div", { className: "text-center mb-8", children: [_jsx("div", { className: "inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4", children: _jsx(PhoneIcon, { className: "w-8 h-8 text-blue-600" }) }), _jsx("h1", { className: "text-2xl font-bold text-gray-900 mb-2", children: "Patient Portal Login" }), _jsx("p", { className: "text-gray-600", children: "Enter the email or phone number you registered with, plus your date of birth." })] }), error && (_jsx("div", { className: "mb-6 p-4 bg-red-50 border border-red-200 rounded-lg", children: _jsx("p", { className: "text-sm text-red-800", children: error }) })), _jsxs("form", { onSubmit: form.handleSubmit(handleLogin), className: "space-y-6", children: [_jsxs("div", { children: [_jsx("label", { htmlFor: "contact", className: "block text-sm font-medium text-gray-700 mb-2", children: "Email or Phone Number" }), _jsx("input", { ...form.register("contact"), type: "text", id: "contact", placeholder: "email@example.com or +234 ...", className: "w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent", disabled: loading }), form.formState.errors.contact && (_jsx("p", { className: "mt-2 text-sm text-red-600", children: form.formState.errors.contact.message }))] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "dob", className: "block text-sm font-medium text-gray-700 mb-2", children: "Date of Birth" }), _jsx("input", { ...form.register("dob"), type: "date", id: "dob", className: "w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent", disabled: loading }), form.formState.errors.dob && (_jsx("p", { className: "mt-2 text-sm text-red-600", children: form.formState.errors.dob.message }))] }), _jsx("button", { type: "submit", disabled: loading, className: "w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors", children: loading ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" }), "Logging in..."] })) : (_jsxs(_Fragment, { children: ["Login", _jsx(ArrowRightIcon, { className: "w-5 h-5" })] })) }), _jsx("div", { className: "text-center", children: _jsxs("p", { className: "text-sm text-gray-600", children: ["Don't have an account?", " ", _jsx("button", { type: "button", onClick: () => navigate("/patient/register"), className: "text-blue-600 hover:text-blue-700 font-medium", children: "Register here" })] }) })] })] }), _jsxs("div", { className: "mt-6 text-center space-y-3", children: [_jsx("button", { type: "button", onClick: () => navigate("/patient"), className: "text-sm text-blue-600 hover:text-blue-700 font-medium", children: "Back to Home" }), _jsxs("div", { className: "text-sm text-gray-600", children: [_jsx("p", { children: "Med Bridge Health Reach" }), _jsx("p", { className: "mt-1", children: "Secure patient portal powered by mBHR" })] })] })] }) }));
}
