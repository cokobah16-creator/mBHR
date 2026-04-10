import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, startTransition } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRightIcon, PhoneIcon, CheckCircleIcon, } from "@heroicons/react/24/outline";
import { registerPatientPortalAccount } from "@/services/patientPortalAuth";
const registrationSchema = z
    .object({
    givenName: z.string().min(1, "First name is required"),
    familyName: z.string().min(1, "Last name is required"),
    phone: z
        .string()
        .min(10, "Phone number must be at least 10 digits")
        .regex(/^\+?[\d\s-]+$/, "Invalid phone number")
        .optional()
        .or(z.literal("")),
    email: z
        .string()
        .email("Invalid email address")
        .optional()
        .or(z.literal("")),
    dob: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format"),
    consentGiven: z
        .boolean()
        .refine((val) => val === true, "You must accept the terms to continue"),
})
    .refine((data) => data.phone || data.email, {
    message: "Please provide either a phone number or email address",
    path: ["phone"],
});
export function PatientRegister() {
    const navigate = useNavigate();
    const [step, setStep] = useState("info");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const form = useForm({
        resolver: zodResolver(registrationSchema),
        defaultValues: {
            givenName: "",
            familyName: "",
            phone: "",
            email: "",
            dob: "",
            consentGiven: false,
        },
    });
    const handleSubmitInfo = async (data) => {
        setLoading(true);
        setError("");
        if (!data.phone && !data.email) {
            setError("Please provide either a phone number or email address");
            setLoading(false);
            return;
        }
        try {
            const result = await registerPatientPortalAccount(data.phone || undefined, data.email || undefined, data.dob, data.givenName, data.familyName);
            if (result.success && result.sessionToken) {
                localStorage.setItem("patient_session_token", result.sessionToken);
                localStorage.setItem("patient_portal_user", JSON.stringify(result.portalUser));
                setStep("success");
                setTimeout(() => startTransition(() => navigate("/patient/dashboard")), 1500);
            }
            else {
                setError(result.error || "Registration failed");
            }
        }
        catch {
            setError("An error occurred. Please try again.");
        }
        finally {
            setLoading(false);
        }
    };
    return (_jsx("div", { className: "min-h-screen bg-gradient-to-br from-green-50 to-green-100 flex items-center justify-center p-4", children: _jsxs("div", { className: "w-full max-w-md", children: [_jsxs("div", { className: "bg-white rounded-2xl shadow-xl p-8", children: [step === "info" && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "text-center mb-8", children: [_jsx("div", { className: "inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4", children: _jsx(PhoneIcon, { className: "w-8 h-8 text-green-600" }) }), _jsx("h1", { className: "text-2xl font-bold text-gray-900 mb-2", children: "Create Your Account" }), _jsx("p", { className: "text-gray-600", children: "Join the mBHR Patient Portal for easy access to your health records" })] }), error && (_jsx("div", { className: "mb-6 p-4 bg-red-50 border border-red-200 rounded-lg", children: _jsx("p", { className: "text-sm text-red-800", children: error }) })), _jsxs("form", { onSubmit: form.handleSubmit(handleSubmitInfo), className: "space-y-6", children: [_jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("label", { htmlFor: "givenName", className: "block text-sm font-medium text-gray-700 mb-2", children: "First Name *" }), _jsx("input", { ...form.register("givenName"), type: "text", id: "givenName", placeholder: "First name", className: "w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent", disabled: loading }), form.formState.errors.givenName && (_jsx("p", { className: "mt-2 text-sm text-red-600", children: form.formState.errors.givenName.message }))] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "familyName", className: "block text-sm font-medium text-gray-700 mb-2", children: "Last Name *" }), _jsx("input", { ...form.register("familyName"), type: "text", id: "familyName", placeholder: "Last name", className: "w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent", disabled: loading }), form.formState.errors.familyName && (_jsx("p", { className: "mt-2 text-sm text-red-600", children: form.formState.errors.familyName.message }))] })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "email", className: "block text-sm font-medium text-gray-700 mb-2", children: "Email Address" }), _jsx("input", { ...form.register("email"), type: "email", id: "email", placeholder: "your.email@example.com", className: "w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent", disabled: loading }), form.formState.errors.email && (_jsx("p", { className: "mt-2 text-sm text-red-600", children: form.formState.errors.email.message }))] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "phone", className: "block text-sm font-medium text-gray-700 mb-2", children: "Phone Number" }), _jsx("input", { ...form.register("phone"), type: "tel", id: "phone", placeholder: "+234 XXX XXX XXXX", className: "w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent", disabled: loading }), form.formState.errors.phone && (_jsx("p", { className: "mt-2 text-sm text-red-600", children: form.formState.errors.phone.message })), _jsx("p", { className: "mt-1 text-xs text-gray-500", children: "Provide at least one \u2014 email or phone." })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "dob", className: "block text-sm font-medium text-gray-700 mb-2", children: "Date of Birth *" }), _jsx("input", { ...form.register("dob"), type: "date", id: "dob", className: "w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent", disabled: loading }), form.formState.errors.dob && (_jsx("p", { className: "mt-2 text-sm text-red-600", children: form.formState.errors.dob.message })), _jsx("p", { className: "mt-1 text-xs text-gray-500", children: "You'll use this to log back in." })] }), _jsxs("div", { className: "flex items-start gap-3", children: [_jsx("input", { ...form.register("consentGiven"), type: "checkbox", id: "consent", className: "mt-1 w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500", disabled: loading }), _jsxs("label", { htmlFor: "consent", className: "text-sm text-gray-700", children: ["I agree to the", " ", _jsx("a", { href: "#", className: "text-green-600 hover:text-green-700 font-medium", children: "Terms of Service" }), " ", "and", " ", _jsx("a", { href: "#", className: "text-green-600 hover:text-green-700 font-medium", children: "Privacy Policy" }), ". I consent to access my medical records through this portal."] })] }), form.formState.errors.consentGiven && (_jsx("p", { className: "text-sm text-red-600", children: form.formState.errors.consentGiven.message })), _jsx("button", { type: "submit", disabled: loading, className: "w-full flex items-center justify-center gap-2 bg-green-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors", children: loading ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" }), "Creating Account..."] })) : (_jsxs(_Fragment, { children: ["Create Account", _jsx(ArrowRightIcon, { className: "w-5 h-5" })] })) }), _jsx("div", { className: "text-center", children: _jsxs("p", { className: "text-sm text-gray-600", children: ["Already have an account?", " ", _jsx("button", { type: "button", onClick: () => navigate("/patient/login"), className: "text-green-600 hover:text-green-700 font-medium", children: "Login here" })] }) })] })] })), step === "success" && (_jsxs("div", { className: "text-center py-8", children: [_jsx("div", { className: "inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-6", children: _jsx(CheckCircleIcon, { className: "w-12 h-12 text-green-600" }) }), _jsx("h1", { className: "text-2xl font-bold text-gray-900 mb-2", children: "Account Created!" }), _jsx("p", { className: "text-gray-600 mb-6", children: "Welcome to the mBHR Patient Portal. You'll be redirected to your dashboard shortly." }), _jsx("div", { className: "flex justify-center", children: _jsx("div", { className: "w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin" }) })] }))] }), _jsxs("div", { className: "mt-6 text-center space-y-3", children: [_jsx("button", { type: "button", onClick: () => navigate("/patient"), className: "text-sm text-green-600 hover:text-green-700 font-medium", children: "Back to Home" }), _jsxs("div", { className: "text-sm text-gray-600", children: [_jsx("p", { children: "Med Bridge Health Reach" }), _jsx("p", { className: "mt-1", children: "Secure patient portal powered by mBHR" })] })] })] }) }));
}
