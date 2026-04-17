import { useState, startTransition } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ArrowRightIcon,
  PhoneIcon,
  CheckCircleIcon,
} from "@heroicons/react/24/outline";
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
    pin: z
      .string()
      .regex(/^\d{6}$/, "PIN must be exactly 6 digits")
      .optional()
      .or(z.literal("")),
    pinConfirm: z.string().optional().or(z.literal("")),
    consentGiven: z
      .boolean()
      .refine((val) => val === true, "You must accept the terms to continue"),
  })
  .refine((data) => data.phone || data.email, {
    message: "Please provide either a phone number or email address",
    path: ["phone"],
  })
  .refine(
    (data) => !data.pin || data.pin === data.pinConfirm,
    { message: "PINs do not match", path: ["pinConfirm"] },
  );

type RegistrationForm = z.infer<typeof registrationSchema>;

export function PatientRegister() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"info" | "success">("info");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const form = useForm<RegistrationForm>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      givenName: "",
      familyName: "",
      phone: "",
      email: "",
      dob: "",
      pin: "",
      pinConfirm: "",
      consentGiven: false,
    },
  });

  const handleSubmitInfo = async (data: RegistrationForm) => {
    setLoading(true);
    setError("");

    if (!data.phone && !data.email) {
      setError("Please provide either a phone number or email address");
      setLoading(false);
      return;
    }

    try {
      const result = await registerPatientPortalAccount(
        data.phone || undefined,
        data.email || undefined,
        data.dob,
        data.givenName,
        data.familyName,
        data.pin || undefined,
      );

      if (result.success && result.sessionToken) {
        localStorage.setItem("patient_session_token", result.sessionToken);
        localStorage.setItem(
          "patient_portal_user",
          JSON.stringify(result.portalUser),
        );
        setStep("success");
        setTimeout(
          () => startTransition(() => navigate("/patient/dashboard")),
          1500,
        );
      } else {
        setError(result.error || "Registration failed");
      }
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-green-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          {step === "info" && (
            <>
              <div className="text-center mb-8">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
                  <PhoneIcon className="w-8 h-8 text-green-600" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">
                  Create Your Account
                </h1>
                <p className="text-gray-600">
                  Join the mBHR Patient Portal for easy access to your health
                  records
                </p>
              </div>

              {error && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              )}

              <form
                onSubmit={form.handleSubmit(handleSubmitInfo)}
                className="space-y-6"
              >
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="givenName"
                      className="block text-sm font-medium text-gray-700 mb-2"
                    >
                      First Name *
                    </label>
                    <input
                      {...form.register("givenName")}
                      type="text"
                      id="givenName"
                      placeholder="First name"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      disabled={loading}
                    />
                    {form.formState.errors.givenName && (
                      <p className="mt-2 text-sm text-red-600">
                        {form.formState.errors.givenName.message}
                      </p>
                    )}
                  </div>
                  <div>
                    <label
                      htmlFor="familyName"
                      className="block text-sm font-medium text-gray-700 mb-2"
                    >
                      Last Name *
                    </label>
                    <input
                      {...form.register("familyName")}
                      type="text"
                      id="familyName"
                      placeholder="Last name"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      disabled={loading}
                    />
                    {form.formState.errors.familyName && (
                      <p className="mt-2 text-sm text-red-600">
                        {form.formState.errors.familyName.message}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="email"
                    className="block text-sm font-medium text-gray-700 mb-2"
                  >
                    Email Address
                  </label>
                  <input
                    {...form.register("email")}
                    type="email"
                    id="email"
                    placeholder="your.email@example.com"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    disabled={loading}
                  />
                  {form.formState.errors.email && (
                    <p className="mt-2 text-sm text-red-600">
                      {form.formState.errors.email.message}
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="phone"
                    className="block text-sm font-medium text-gray-700 mb-2"
                  >
                    Phone Number
                  </label>
                  <input
                    {...form.register("phone")}
                    type="tel"
                    id="phone"
                    placeholder="+234 XXX XXX XXXX"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    disabled={loading}
                  />
                  {form.formState.errors.phone && (
                    <p className="mt-2 text-sm text-red-600">
                      {form.formState.errors.phone.message}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-gray-500">
                    Provide at least one — email or phone.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="dob"
                    className="block text-sm font-medium text-gray-700 mb-2"
                  >
                    Date of Birth *
                  </label>
                  <input
                    {...form.register("dob")}
                    type="date"
                    id="dob"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    disabled={loading}
                  />
                  {form.formState.errors.dob && (
                    <p className="mt-2 text-sm text-red-600">
                      {form.formState.errors.dob.message}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-gray-500">
                    You'll use this to log back in.
                  </p>
                </div>

                <div className="border-t border-gray-100 pt-4">
                  <p className="text-sm font-medium text-gray-700 mb-3">
                    Set a 6-digit PIN for faster login{" "}
                    <span className="text-gray-400 font-normal">(optional)</span>
                  </p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label
                        htmlFor="pin"
                        className="block text-sm text-gray-600 mb-1"
                      >
                        PIN
                      </label>
                      <input
                        {...form.register("pin")}
                        type="password"
                        id="pin"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="6 digits"
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent tracking-widest text-center"
                        disabled={loading}
                      />
                      {form.formState.errors.pin && (
                        <p className="mt-1 text-xs text-red-600">
                          {form.formState.errors.pin.message}
                        </p>
                      )}
                    </div>
                    <div>
                      <label
                        htmlFor="pinConfirm"
                        className="block text-sm text-gray-600 mb-1"
                      >
                        Confirm PIN
                      </label>
                      <input
                        {...form.register("pinConfirm")}
                        type="password"
                        id="pinConfirm"
                        inputMode="numeric"
                        maxLength={6}
                        placeholder="6 digits"
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent tracking-widest text-center"
                        disabled={loading}
                      />
                      {form.formState.errors.pinConfirm && (
                        <p className="mt-1 text-xs text-red-600">
                          {form.formState.errors.pinConfirm.message}
                        </p>
                      )}
                    </div>
                  </div>
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
                    <a
                      href="#"
                      className="text-green-600 hover:text-green-700 font-medium"
                    >
                      Terms of Service
                    </a>{" "}
                    and{" "}
                    <a
                      href="#"
                      className="text-green-600 hover:text-green-700 font-medium"
                    >
                      Privacy Policy
                    </a>
                    . I consent to access my medical records through this
                    portal.
                  </label>
                </div>
                {form.formState.errors.consentGiven && (
                  <p className="text-sm text-red-600">
                    {form.formState.errors.consentGiven.message}
                  </p>
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
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                Account Created!
              </h1>
              <p className="text-gray-600 mb-6">
                Welcome to the mBHR Patient Portal. You'll be redirected to your
                dashboard shortly.
              </p>
              <div className="flex justify-center">
                <div className="w-8 h-8 border-4 border-green-600 border-t-transparent rounded-full animate-spin" />
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 text-center space-y-3">
          <button
            type="button"
            onClick={() => navigate("/patient")}
            className="text-sm text-green-600 hover:text-green-700 font-medium"
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
