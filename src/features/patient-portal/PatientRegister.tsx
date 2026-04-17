import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  UserPlusIcon,
} from "@heroicons/react/24/outline";
import { useAuth } from "@/hooks/useAuth";
import { registerPatientPortalAccount } from "@/services/patientPortalAuth";
import { isSupabaseEnabled } from "@/lib/supabaseClient";

const schema = z
  .object({
    fullName: z.string().min(2, "Full name is required"),
    email: z.string().email("Please enter a valid email address"),
    phone: z
      .string()
      .regex(/^\+?[\d\s-]{7,}$/, "Invalid phone number")
      .optional()
      .or(z.literal("")),
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
      .optional()
      .or(z.literal("")),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
    consentGiven: z
      .boolean()
      .refine((v) => v === true, "You must accept the terms to continue"),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type RegistrationForm = z.infer<typeof schema>;

export function PatientRegister() {
  const navigate = useNavigate();
  const { signup } = useAuth();
  const [step, setStep]     = useState<"form" | "success">("form");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  const form = useForm<RegistrationForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullName: "",
      email: "",
      phone: "",
      dateOfBirth: "",
      password: "",
      confirmPassword: "",
      consentGiven: false,
    },
  });

  const handleSupabaseRegister = async (data: RegistrationForm) => {
    const authError = await signup({
      email:       data.email,
      password:    data.password,
      fullName:    data.fullName,
      phone:       data.phone || undefined,
      dateOfBirth: data.dateOfBirth || undefined,
    });
    if (authError) {
      const msg = authError.message.toLowerCase();
      if (msg.includes("already registered") || msg.includes("already exists")) {
        setError("An account with this email already exists. Please log in.");
      } else {
        setError(authError.message);
      }
      return;
    }
    setStep("success");
    setTimeout(() => navigate("/patient/dashboard"), 1800);
  };

  const handleOfflineRegister = async (data: RegistrationForm) => {
    // Split full name into given/family for the legacy offline service
    const parts      = data.fullName.trim().split(/\s+/);
    const givenName  = parts[0] ?? data.fullName;
    const familyName = parts.slice(1).join(" ") || "";

    const result = await registerPatientPortalAccount(
      data.phone || undefined,
      data.email,
      data.dateOfBirth || "2000-01-01",
      givenName,
      familyName,
    );
    if (result.success && result.sessionToken) {
      localStorage.setItem("patient_session_token", result.sessionToken);
      localStorage.setItem("patient_portal_user", JSON.stringify(result.portalUser));
      setStep("success");
      setTimeout(() => navigate("/patient/dashboard"), 1800);
    } else {
      setError(result.error || "Registration failed. Please try again.");
    }
  };

  const handleSubmit = async (data: RegistrationForm) => {
    setLoading(true);
    setError("");
    try {
      if (isSupabaseEnabled) {
        await handleSupabaseRegister(data);
      } else {
        await handleOfflineRegister(data);
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-green-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          {step === "form" && (
            <>
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
                  <UserPlusIcon className="w-8 h-8 text-green-600" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">Create Your Account</h1>
                <p className="text-gray-600">Join mBHR for secure access to your health records.</p>
              </div>

              {!isSupabaseEnabled && (
                <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-xs text-yellow-800">
                    Offline mode — account will be stored on this device only.
                  </p>
                </div>
              )}

              {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              )}

              <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">
                <div>
                  <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 mb-2">
                    Full Name *
                  </label>
                  <input
                    {...form.register("fullName")}
                    type="text"
                    id="fullName"
                    placeholder="Jane Doe"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    disabled={loading}
                    autoComplete="name"
                  />
                  {form.formState.errors.fullName && (
                    <p className="mt-1 text-sm text-red-600">{form.formState.errors.fullName.message}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                    Email Address *
                  </label>
                  <input
                    {...form.register("email")}
                    type="email"
                    id="email"
                    placeholder="your.email@example.com"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    disabled={loading}
                    autoComplete="email"
                  />
                  {form.formState.errors.email && (
                    <p className="mt-1 text-sm text-red-600">{form.formState.errors.email.message}</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
                      Phone
                    </label>
                    <input
                      {...form.register("phone")}
                      type="tel"
                      id="phone"
                      placeholder="+234 XXX XXX XXXX"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      disabled={loading}
                      autoComplete="tel"
                    />
                    {form.formState.errors.phone && (
                      <p className="mt-1 text-xs text-red-600">{form.formState.errors.phone.message}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="dateOfBirth" className="block text-sm font-medium text-gray-700 mb-2">
                      Date of Birth
                    </label>
                    <input
                      {...form.register("dateOfBirth")}
                      type="date"
                      id="dateOfBirth"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      disabled={loading}
                    />
                    {form.formState.errors.dateOfBirth && (
                      <p className="mt-1 text-xs text-red-600">{form.formState.errors.dateOfBirth.message}</p>
                    )}
                  </div>
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                    Password *
                  </label>
                  <input
                    {...form.register("password")}
                    type="password"
                    id="password"
                    placeholder="At least 8 characters"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    disabled={loading}
                    autoComplete="new-password"
                  />
                  {form.formState.errors.password && (
                    <p className="mt-1 text-sm text-red-600">{form.formState.errors.password.message}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
                    Confirm Password *
                  </label>
                  <input
                    {...form.register("confirmPassword")}
                    type="password"
                    id="confirmPassword"
                    placeholder="Repeat your password"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    disabled={loading}
                    autoComplete="new-password"
                  />
                  {form.formState.errors.confirmPassword && (
                    <p className="mt-1 text-sm text-red-600">{form.formState.errors.confirmPassword.message}</p>
                  )}
                </div>

                <div className="flex items-start gap-3">
                  <input
                    {...form.register("consentGiven")}
                    type="checkbox"
                    id="consent"
                    className="mt-1 w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
                    disabled={loading}
                  />
                  <label htmlFor="consent" className="text-sm text-gray-700">
                    I agree to the{" "}
                    <span className="text-green-600 font-medium">Terms of Service</span> and{" "}
                    <span className="text-green-600 font-medium">Privacy Policy</span>. I consent to
                    access my medical records through this portal.
                  </label>
                </div>
                {form.formState.errors.consentGiven && (
                  <p className="text-sm text-red-600">{form.formState.errors.consentGiven.message}</p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 bg-green-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Creating Account...
                    </>
                  ) : (
                    <>
                      Create Account
                      <ArrowRightIcon className="w-5 h-5" />
                    </>
                  )}
                </button>

                <div className="text-center">
                  <p className="text-sm text-gray-600">
                    Already have an account?{" "}
                    <button
                      type="button"
                      onClick={() => navigate("/patient/login")}
                      className="text-green-600 hover:text-green-700 font-medium"
                    >
                      Login here
                    </button>
                  </p>
                </div>
              </form>
            </>
          )}

          {step === "success" && (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full mb-6">
                <CheckCircleIcon className="w-12 h-12 text-green-600" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">Account Created!</h1>
              <p className="text-gray-600 mb-6">
                {isSupabaseEnabled
                  ? "Welcome to mBHR. If email confirmation is required, check your inbox — then log in."
                  : "Welcome to mBHR. Redirecting to your dashboard…"}
              </p>
              <div className="flex justify-center">
                <div className="w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin" />
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 text-center space-y-2">
          <button
            type="button"
            onClick={() => navigate("/patient")}
            className="text-sm text-green-600 hover:text-green-700 font-medium"
          >
            Back to Home
          </button>
          <p className="text-sm text-gray-500">Med Bridge Health Reach · Secure patient portal</p>
        </div>
      </div>
    </div>
  );
}
