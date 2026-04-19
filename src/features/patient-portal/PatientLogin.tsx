import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRightIcon, ShieldCheckIcon } from "@heroicons/react/24/outline";
import { useAuth } from "@/hooks/useAuth";
import { loginPatientPortal } from "@/services/patientPortalAuth";
import { isSupabaseEnabled } from "@/lib/supabaseClient";

const onlineSchema = z.object({
  email:    z.string().email("Please enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const offlineSchema = z.object({
  email:    z.string().email("Please enter a valid email address"),
  password: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Please use the format YYYY-MM-DD"),
});

type LoginForm = z.infer<typeof onlineSchema>;

export function PatientLogin() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  const form = useForm<LoginForm>({
    resolver: zodResolver(isSupabaseEnabled ? onlineSchema : offlineSchema),
    defaultValues: { email: "", password: "" },
  });

  const handleSupabaseLogin = async (data: LoginForm) => {
    const authError = await login(data.email, data.password);
    if (authError) {
      const msg = authError.message.toLowerCase();
      if (msg.includes("invalid login") || msg.includes("invalid credentials")) {
        setError("Email or password is incorrect. Please try again.");
      } else if (msg.includes("email not confirmed")) {
        setError("Please check your email and confirm your account before logging in.");
      } else if (msg.includes("too many requests")) {
        setError("Too many login attempts. Please wait a moment and try again.");
      } else {
        setError(authError.message);
      }
      return;
    }
    navigate("/patient/dashboard");
  };

  const handleOfflineLogin = async (data: LoginForm) => {
    const result = await loginPatientPortal(data.email, data.password, "dob").catch(() => null);
    if (result?.success && result.sessionToken) {
      localStorage.setItem("patient_session_token", result.sessionToken);
      localStorage.setItem("patient_portal_user", JSON.stringify(result.portalUser));
      navigate("/patient/dashboard");
    } else {
      setError(result?.error || "No account found. Please register first.");
    }
  };

  const handleSubmit = async (data: LoginForm) => {
    setLoading(true);
    setError("");
    try {
      if (isSupabaseEnabled) {
        await handleSupabaseLogin(data);
      } else {
        await handleOfflineLogin(data);
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
              <ShieldCheckIcon className="w-8 h-8 text-blue-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Patient Portal Login</h1>
            <p className="text-gray-600">
              {isSupabaseEnabled
                ? "Sign in with your email and password."
                : "Sign in with your email and date of birth."}
            </p>
          </div>

          {!isSupabaseEnabled && (
            <div className="mb-6 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-xs text-yellow-800 font-medium mb-1">Running in offline mode</p>
              <p className="text-xs text-yellow-800">
                Data is stored on this device only. Email invitations are not
                available without an internet connection — register directly
                using the link below.
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
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                Email Address
              </label>
              <input
                {...form.register("email")}
                type="email"
                id="email"
                placeholder="your.email@example.com"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={loading}
                autoComplete="email"
              />
              {form.formState.errors.email && (
                <p className="mt-2 text-sm text-red-600">{form.formState.errors.email.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                {isSupabaseEnabled ? "Password" : "Date of Birth"}
              </label>
              <input
                {...form.register("password")}
                type={isSupabaseEnabled ? "password" : "date"}
                id="password"
                placeholder={isSupabaseEnabled ? "Your password" : ""}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={loading}
                autoComplete={isSupabaseEnabled ? "current-password" : "bday"}
              />
              {!isSupabaseEnabled && (
                <p className="mt-1 text-xs text-gray-500">
                  Use the same date of birth you entered when you registered (e.g. 1990-01-15)
                </p>
              )}
              {form.formState.errors.password && (
                <p className="mt-2 text-sm text-red-600">{form.formState.errors.password.message}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Logging in...
                </>
              ) : (
                <>
                  Login
                  <ArrowRightIcon className="w-5 h-5" />
                </>
              )}
            </button>

            <div className="text-center">
              <p className="text-sm text-gray-600">
                Don't have an account?{" "}
                <button
                  type="button"
                  onClick={() => navigate("/patient/register")}
                  className="text-blue-600 hover:text-blue-700 font-medium"
                >
                  Register here
                </button>
              </p>
            </div>
          </form>
        </div>

        <div className="mt-6 text-center space-y-2">
          <button
            type="button"
            onClick={() => navigate("/patient")}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            Back to Home
          </button>
          <p className="text-sm text-gray-500">Med Bridge Health Reach · Secure patient portal</p>
        </div>
      </div>
    </div>
  );
}
