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

type LoginForm = z.infer<typeof loginSchema>;

export function PatientLogin() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { contact: "", dob: "" },
  });

  const handleLogin = async (data: LoginForm) => {
    setLoading(true);
    setError("");

    try {
      const result = await loginPatientPortal(data.contact, data.dob);

      if (result.success && result.sessionToken) {
        localStorage.setItem("patient_session_token", result.sessionToken);
        localStorage.setItem(
          "patient_portal_user",
          JSON.stringify(result.portalUser),
        );
        startTransition(() => navigate("/patient/dashboard"));
      } else {
        setError(result.error || "Could not log in");
      }
    } catch {
      setError("An error occurred. Please try again.");
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
              <PhoneIcon className="w-8 h-8 text-blue-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              Patient Portal Login
            </h1>
            <p className="text-gray-600">
              Enter the email or phone number you registered with, plus your
              date of birth.
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <form onSubmit={form.handleSubmit(handleLogin)} className="space-y-6">
            <div>
              <label
                htmlFor="contact"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Email or Phone Number
              </label>
              <input
                {...form.register("contact")}
                type="text"
                id="contact"
                placeholder="email@example.com or +234 ..."
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={loading}
              />
              {form.formState.errors.contact && (
                <p className="mt-2 text-sm text-red-600">
                  {form.formState.errors.contact.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="dob"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Date of Birth
              </label>
              <input
                {...form.register("dob")}
                type="date"
                id="dob"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={loading}
              />
              {form.formState.errors.dob && (
                <p className="mt-2 text-sm text-red-600">
                  {form.formState.errors.dob.message}
                </p>
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

        <div className="mt-6 text-center space-y-3">
          <button
            type="button"
            onClick={() => navigate("/patient")}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            Back to Home
          </button>
          <div className="text-sm text-gray-600">
            <p>Med Bridge Health Reach</p>
            <p className="mt-1">Secure patient portal powered by mBHR</p>
          </div>
        </div>
      </div>
    </div>
  );
}
