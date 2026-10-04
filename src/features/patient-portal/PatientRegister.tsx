import { useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { useAuth } from "@/hooks/useAuth";
import { useT } from "@/hooks/useT";
import { registerPatientPortalAccount } from "@/services/patientPortalAuth";
import { supabase, isSupabaseEnabled } from "@/lib/supabaseClient";
import { getPatientProfile, getPatientProfileByEmail } from "@/services/patientService";
import {
  ACCEPTANCE_REQUIRED_MESSAGE,
  UNDER_18_SIGN_UP_MESSAGE,
  currentPolicyAcceptance,
  type PolicyAcceptance,
} from "@/pages/legal/policyMeta";
import { isMinor } from "@/utils/patient";
import { AuthShell } from "./account/AuthShell";

// Three separate, required boxes. Each starts unticked and is asked for on
// its own, so agreeing to one is never taken as agreeing to the others.
const mustTick = (message: string) =>
  z.boolean().refine((v) => v === true, message);

const consentFields = {
  acceptTerms: mustTick("Tick this box to agree to the terms of use."),
  acceptPrivacy: mustTick(
    "Tick this box to confirm you have read the privacy notice.",
  ),
  consentRecordsAccess: mustTick(
    "Tick this box to consent to seeing your health records in this portal.",
  ),
};

type ConsentField = keyof typeof consentFields;

const INVALID_DOB_MESSAGE =
  "Please enter a real date of birth. It cannot be in the future.";

// Required in both modes. People under 18 cannot create their own account:
// a parent or guardian asks clinic staff instead.
const dateOfBirthField = z.string().superRefine((value, ctx) => {
  const fail = (message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (!value) return fail("Date of birth is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return fail("Please enter your date of birth as YYYY-MM-DD");
  }
  const minor = isMinor(value);
  if (minor === null) return fail(INVALID_DOB_MESSAGE);
  if (minor) fail(UNDER_18_SIGN_UP_MESSAGE);
});

// Online: password-based auth via Supabase
const onlineSchema = z
  .object({
    fullName: z.string().min(2, "Full name is required"),
    email: z.string().email("Please enter a valid email address"),
    phone: z
      .string()
      .regex(/^\+?[\d\s-]{7,}$/, "Invalid phone number")
      .optional()
      .or(z.literal("")),
    dateOfBirth: dateOfBirthField,
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
    ...consentFields,
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

// Offline: PIN is the login credential — 6-digit required
const offlineSchema = z
  .object({
    fullName: z.string().min(2, "Full name is required"),
    email: z.string().email("Please enter a valid email address"),
    phone: z
      .string()
      .regex(/^\+?[\d\s-]{7,}$/, "Invalid phone number")
      .optional()
      .or(z.literal("")),
    dateOfBirth: dateOfBirthField,
    pin: z.string().regex(/^\d{6}$/, "PIN must be exactly 6 digits"),
    confirmPin: z.string(),
    ...consentFields,
  })
  .refine((d) => d.pin === d.confirmPin, {
    message: "PINs do not match",
    path: ["confirmPin"],
  });

const schema = isSupabaseEnabled ? onlineSchema : offlineSchema;
type RegistrationForm = z.infer<typeof schema>;

// The English messages above (and the page's own error banners) are kept as
// they are; each one is translated where it is shown. A message with no key
// here (for example one returned by a service) is shown as it is.
const MESSAGE_KEYS: Record<string, string> = {
  "Tick this box to agree to the terms of use.": "portal.register.error.acceptTerms",
  "Tick this box to confirm you have read the privacy notice.":
    "portal.register.error.acceptPrivacy",
  "Tick this box to consent to seeing your health records in this portal.":
    "portal.register.error.consentRecordsAccess",
  [INVALID_DOB_MESSAGE]: "portal.register.error.dobInvalid",
  "Date of birth is required": "portal.register.error.dobRequired",
  "Please enter your date of birth as YYYY-MM-DD": "portal.register.error.dobFormat",
  [UNDER_18_SIGN_UP_MESSAGE]: "portal.register.error.under18",
  [ACCEPTANCE_REQUIRED_MESSAGE]: "portal.register.error.acceptanceRequired",
  "Full name is required": "portal.register.error.fullNameRequired",
  "Please enter a valid email address": "portal.register.error.emailInvalid",
  "Invalid phone number": "portal.register.error.phoneInvalid",
  "Password must be at least 8 characters": "portal.register.error.passwordTooShort",
  "Passwords do not match": "portal.register.error.passwordMismatch",
  "PIN must be exactly 6 digits": "portal.register.error.pinFormat",
  "PINs do not match": "portal.register.error.pinMismatch",
  "An account with this email already exists. Please log in.":
    "portal.register.error.alreadyExists",
  "Registration failed. Please try again.": "portal.register.error.failed",
  "An unexpected error occurred. Please try again.": "portal.register.error.unexpected",
};

export function PatientRegister() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { signup } = useAuth();
  const { t } = useT();
  const translateMessage = (message: string) => {
    const key = MESSAGE_KEYS[message];
    return key ? t(key, message) : message;
  };
  const [step, setStep] = useState<"form" | "check_email" | "success">("form");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Account made, but the email address must be confirmed before sign-in.
  const [confirmNotice, setConfirmNotice] = useState("");

  // Pre-fill from staff-shared invitation link (?email=xxx&phone=xxx)
  const prefillEmail = searchParams.get("email") || "";
  const prefillPhone = searchParams.get("phone") || "";

  const form = useForm<RegistrationForm>({
    resolver: zodResolver(schema),
    defaultValues: isSupabaseEnabled
      ? {
          fullName: "",
          email: prefillEmail,
          phone: prefillPhone,
          dateOfBirth: "",
          password: "",
          confirmPassword: "",
          acceptTerms: false,
          acceptPrivacy: false,
          consentRecordsAccess: false,
        }
      : {
          fullName: "",
          email: prefillEmail,
          phone: prefillPhone,
          dateOfBirth: "",
          pin: "",
          confirmPin: "",
          acceptTerms: false,
          acceptPrivacy: false,
          consentRecordsAccess: false,
        },
  });

  const handleSupabaseRegister = async (
    data: RegistrationForm,
    acceptance: PolicyAcceptance,
  ) => {
    const parts = data.fullName.trim().split(/\s+/);
    const givenName = parts[0] ?? data.fullName;
    const familyName = parts.slice(1).join(" ") || "";

    const authError = await signup({
      email: data.email,
      password: (data as z.infer<typeof onlineSchema>).password,
      givenName,
      familyName,
      phone: data.phone || undefined,
      dob: data.dateOfBirth,
      acceptance,
    });
    if (authError) {
      // The account exists but needs its email confirmed first: this is
      // information, not a failure, and there is no session to open.
      if (authError.code === "confirm_email") {
        setConfirmNotice(authError.message);
        setStep("check_email");
        return;
      }
      // The server did not link a clinic record (the message says why);
      // the account has already been signed out on this device.
      if (authError.code === "not_linked") {
        setError(authError.message);
        return;
      }
      const msg = authError.message.toLowerCase();
      if (
        msg.includes("already registered") ||
        msg.includes("already exists")
      ) {
        setError("An account with this email already exists. Please log in.");
      } else {
        setError(authError.message);
      }
      return;
    }
    // Populate patient_portal_user so Medical History / Messages can find the patient ID
    if (supabase) {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          let profileRes = await getPatientProfile(user.id);
          if (!profileRes.data && user.email) {
            profileRes = await getPatientProfileByEmail(user.id, user.email);
          }
          if (profileRes.data) {
            localStorage.setItem(
              "patient_portal_user",
              JSON.stringify({
                id: user.id,
                patientId: profileRes.data.id,
                givenName: profileRes.data.givenName,
                familyName: profileRes.data.familyName,
                email: profileRes.data.email,
              }),
            );
          }
          // If the profile is not readable yet, the portal layout looks it
          // up again when the dashboard opens.
        }
      } catch {
        // Profile fetch failed; the portal layout looks it up again.
      }
    }
    setStep("success");
    setTimeout(() => navigate("/patient/dashboard"), 1800);
  };

  const handleOfflineRegister = async (
    data: RegistrationForm,
    acceptance: PolicyAcceptance,
  ) => {
    const parts = data.fullName.trim().split(/\s+/);
    const givenName = parts[0] ?? data.fullName;
    const familyName = parts.slice(1).join(" ") || "";

    // pin is required in offline mode (enforced by offlineSchema)
    const offlineData = data as z.infer<typeof offlineSchema>;
    const result = await registerPatientPortalAccount(
      data.phone || undefined,
      data.email,
      data.dateOfBirth,
      givenName,
      familyName,
      offlineData.pin,
      acceptance,
    );
    if (result.success && result.sessionToken) {
      sessionStorage.setItem("patient_session_token", result.sessionToken);
      localStorage.setItem(
        "patient_portal_user",
        JSON.stringify(result.portalUser),
      );
      setStep("success");
      setTimeout(() => navigate("/patient/dashboard"), 1800);
    } else {
      setError(result.error || "Registration failed. Please try again.");
    }
  };

  const handleSubmit = async (data: RegistrationForm) => {
    // The schema already requires all three boxes. Check again here, because
    // this is where the acceptance that gets saved with the account is made.
    if (!data.acceptTerms || !data.acceptPrivacy || !data.consentRecordsAccess) {
      setError(ACCEPTANCE_REQUIRED_MESSAGE);
      return;
    }
    // The schema already refuses people under 18 and unusable dates. Check
    // again here too, right before an account is made.
    const minor = isMinor(data.dateOfBirth);
    if (minor !== false) {
      setError(minor ? UNDER_18_SIGN_UP_MESSAGE : INVALID_DOB_MESSAGE);
      return;
    }
    const acceptance = currentPolicyAcceptance();
    setLoading(true);
    setError("");
    try {
      if (isSupabaseEnabled) {
        await handleSupabaseRegister(data, acceptance);
      } else {
        await handleOfflineRegister(data, acceptance);
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const describe = (...ids: (string | false | undefined)[]) =>
    ids.filter(Boolean).join(" ") || undefined;
  const fieldErrors = form.formState.errors as Partial<
    Record<string, { message?: unknown }>
  >;
  const errorText = (name: string) => {
    const message = fieldErrors[name]?.message;
    return typeof message === "string" ? message : undefined;
  };
  const fieldError = (name: string) => {
    const message = errorText(name);
    return message ? (
      <p id={`${name}-error`} className="field-error">
        {translateMessage(message)}
      </p>
    ) : null;
  };
  const invalid = (name: string) => (errorText(name) ? true : undefined);
  const consentBox = (name: ConsentField, id: string, label: ReactNode) => (
    <div>
      <div className="flex items-start gap-3">
        <input
          {...form.register(name)}
          type="checkbox"
          id={id}
          className="mt-0.5 h-5 w-5 shrink-0 rounded border-line-strong text-primary focus:ring-primary"
          disabled={loading}
          aria-invalid={invalid(name)}
          aria-describedby={describe(!!errorText(name) && `${name}-error`)}
        />
        <label htmlFor={id} className="text-body text-ink-secondary">
          {label}
        </label>
      </div>
      {fieldError(name)}
    </div>
  );
  const policyLink = (href: string, text: string) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-primary-fg underline underline-offset-2"
    >
      {text}
    </a>
  );

  return (
    <AuthShell>
      {step === "form" && (
        <>
          <div className="mb-6">
            <h1 className="text-h1 text-ink">
              {t("portal.register.title", "Create your account")}
            </h1>
            <p className="mt-1 text-body text-ink-muted">
              {t(
                "portal.register.subtitle",
                "See your health records from mBHR clinics in one secure place.",
              )}
            </p>
          </div>

          {!isSupabaseEnabled && (
            <div className="banner banner-info mb-5">
              <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <div className="space-y-1">
                <p className="font-medium">
                  {t("portal.register.offline.title", "This device is in offline mode")}
                </p>
                <p className="text-label font-normal">
                  {t(
                    "portal.register.offline.bodyBefore",
                    "Your account will be stored on this device only. You will create a",
                  )}{" "}
                  <strong>{t("portal.register.offline.bodyPin", "6-digit PIN")}</strong>{" "}
                  {t(
                    "portal.register.offline.bodyAfter",
                    "to log in. Remember it: only clinic staff can reset it.",
                  )}
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="banner banner-danger mb-5" role="alert">
              <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <p>{translateMessage(error)}</p>
            </div>
          )}

          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-5"
            noValidate
          >
            <p className="text-caption text-ink-muted">
              {t("portal.register.requiredNote", "Fields marked * are required.")}
            </p>

            <div>
              <label htmlFor="fullName" className="field-label">
                {t("portal.register.fullName.label", "Full Name *")}
              </label>
              <input
                {...form.register("fullName")}
                type="text"
                id="fullName"
                placeholder={t("portal.register.fullName.placeholder", "Jane Doe")}
                className="input-field"
                disabled={loading}
                autoComplete="name"
                aria-required="true"
                aria-invalid={invalid("fullName")}
                aria-describedby={describe(!!errorText("fullName") && "fullName-error")}
              />
              {fieldError("fullName")}
            </div>

            <div>
              <label htmlFor="email" className="field-label">
                {t("portal.register.email.label", "Email Address *")}
              </label>
              <input
                {...form.register("email")}
                type="email"
                id="email"
                placeholder="your.email@example.com"
                className="input-field"
                disabled={loading}
                autoComplete="email"
                aria-required="true"
                aria-invalid={invalid("email")}
                aria-describedby={describe(
                  "email-hint",
                  !!errorText("email") && "email-error",
                )}
              />
              <p id="email-hint" className="field-hint">
                {t(
                  "portal.register.email.hint",
                  "Use the address the clinic has for you, so your account can be linked to your clinic record.",
                )}
              </p>
              {fieldError("email")}
            </div>

            <div className={isSupabaseEnabled ? "grid gap-4 sm:grid-cols-2" : ""}>
              <div>
                <label htmlFor="phone" className="field-label">
                  {t("portal.register.phone.label", "Phone (optional)")}
                </label>
                <input
                  {...form.register("phone")}
                  type="tel"
                  id="phone"
                  placeholder="+234 XXX XXX XXXX"
                  className="input-field"
                  disabled={loading}
                  autoComplete="tel"
                  aria-invalid={invalid("phone")}
                  aria-describedby={describe(!!errorText("phone") && "phone-error")}
                />
                {fieldError("phone")}
              </div>

              {isSupabaseEnabled && (
                <div>
                  <label htmlFor="dateOfBirth" className="field-label">
                    {t("portal.register.dob.label", "Date of Birth *")}
                  </label>
                  <input
                    {...form.register("dateOfBirth")}
                    type="date"
                    id="dateOfBirth"
                    className="input-field"
                    disabled={loading}
                    autoComplete="bday"
                    aria-required="true"
                    aria-invalid={invalid("dateOfBirth")}
                    aria-describedby={describe(
                      "dateOfBirth-hint",
                      !!errorText("dateOfBirth") && "dateOfBirth-error",
                    )}
                  />
                  <p id="dateOfBirth-hint" className="field-hint">
                    {t(
                      "portal.register.dob.hintOnline",
                      "You must be 18 or older to create your own account.",
                    )}
                  </p>
                  {fieldError("dateOfBirth")}
                </div>
              )}
            </div>

            {/* Offline: collect DOB for record-matching; PIN is the login credential */}
            {!isSupabaseEnabled && (
              <>
                <div>
                  <label htmlFor="dateOfBirth" className="field-label">
                    {t("portal.register.dob.label", "Date of Birth *")}
                  </label>
                  <input
                    {...form.register("dateOfBirth")}
                    type="date"
                    id="dateOfBirth"
                    className="input-field"
                    disabled={loading}
                    autoComplete="bday"
                    aria-required="true"
                    aria-invalid={invalid("dateOfBirth")}
                    aria-describedby={describe(
                      "dateOfBirth-hint",
                      !!errorText("dateOfBirth") && "dateOfBirth-error",
                    )}
                  />
                  <p id="dateOfBirth-hint" className="field-hint">
                    {t(
                      "portal.register.dob.hintOffline",
                      "Used to match you to your clinic record. You must be 18 or older to create your own account.",
                    )}
                  </p>
                  {fieldError("dateOfBirth")}
                </div>

                <div>
                  <label htmlFor="pin" className="field-label">
                    {t("portal.register.pin.label", "6-Digit PIN *")}
                  </label>
                  <input
                    {...form.register("pin" as keyof RegistrationForm)}
                    type="password"
                    id="pin"
                    inputMode="numeric"
                    placeholder="••••••"
                    maxLength={6}
                    className="input-field tracking-widest"
                    disabled={loading}
                    autoComplete="new-password"
                    aria-required="true"
                    aria-invalid={invalid("pin")}
                    aria-describedby={describe(
                      "pin-hint",
                      !!errorText("pin") && "pin-error",
                    )}
                  />
                  <p id="pin-hint" className="field-hint">
                    {t(
                      "portal.register.pin.hint",
                      "You will use this number to log in. Choose one you can remember and keep it to yourself.",
                    )}
                  </p>
                  {fieldError("pin")}
                </div>

                <div>
                  <label htmlFor="confirmPin" className="field-label">
                    {t("portal.register.confirmPin.label", "Confirm PIN *")}
                  </label>
                  <input
                    {...form.register("confirmPin" as keyof RegistrationForm)}
                    type="password"
                    id="confirmPin"
                    inputMode="numeric"
                    placeholder="••••••"
                    maxLength={6}
                    className="input-field tracking-widest"
                    disabled={loading}
                    autoComplete="new-password"
                    aria-required="true"
                    aria-invalid={invalid("confirmPin")}
                    aria-describedby={describe(
                      !!errorText("confirmPin") && "confirmPin-error",
                    )}
                  />
                  {fieldError("confirmPin")}
                </div>
              </>
            )}

            {/* Password fields only shown in online (Supabase) mode */}
            {isSupabaseEnabled && (
              <>
                <div>
                  <label htmlFor="password" className="field-label">
                    {t("portal.register.password.label", "Password *")}
                  </label>
                  <input
                    {...form.register("password" as keyof RegistrationForm)}
                    type="password"
                    id="password"
                    placeholder={t("portal.register.password.placeholder", "At least 8 characters")}
                    className="input-field"
                    disabled={loading}
                    autoComplete="new-password"
                    aria-required="true"
                    aria-invalid={invalid("password")}
                    aria-describedby={describe(
                      !!errorText("password") && "password-error",
                    )}
                  />
                  {fieldError("password")}
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="field-label">
                    {t("portal.register.confirmPassword.label", "Confirm Password *")}
                  </label>
                  <input
                    {...form.register("confirmPassword" as keyof RegistrationForm)}
                    type="password"
                    id="confirmPassword"
                    placeholder={t(
                      "portal.register.confirmPassword.placeholder",
                      "Repeat your password",
                    )}
                    className="input-field"
                    disabled={loading}
                    autoComplete="new-password"
                    aria-required="true"
                    aria-invalid={invalid("confirmPassword")}
                    aria-describedby={describe(
                      !!errorText("confirmPassword") && "confirmPassword-error",
                    )}
                  />
                  {fieldError("confirmPassword")}
                </div>
              </>
            )}

            <fieldset className="space-y-3 rounded-md border border-line bg-surface-sunken p-3">
              <legend className="px-1 text-label font-medium text-ink">
                {t(
                  "portal.register.consent.legend",
                  "Tick all three boxes to create your account *",
                )}
              </legend>
              {consentBox(
                "acceptTerms",
                "consent-terms",
                <>
                  {t("portal.register.consent.termsBefore", "I agree to the")}{" "}
                  {policyLink(
                    "/terms",
                    t("portal.register.consent.termsLink", "Terms of use"),
                  )}
                  {t("portal.register.consent.termsAfter", ".")}
                </>,
              )}
              {consentBox(
                "acceptPrivacy",
                "consent-privacy",
                <>
                  {t("portal.register.consent.privacyBefore", "I have read the")}{" "}
                  {policyLink(
                    "/privacy",
                    t("portal.register.consent.privacyLink", "Privacy notice"),
                  )}
                  {t("portal.register.consent.privacyAfter", ".")}
                </>,
              )}
              {consentBox(
                "consentRecordsAccess",
                "consent-records",
                <>
                  {t(
                    "portal.register.consent.records",
                    "I consent to seeing my health records in this portal.",
                  )}
                </>,
              )}
            </fieldset>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full"
            >
              {loading ? (
                <>
                  <span
                    className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"
                    aria-hidden
                  />
                  {t("portal.register.submit.working", "Creating Account...")}
                </>
              ) : (
                <>
                  {t("portal.register.submit.idle", "Create Account")}
                  <ArrowRightIcon className="h-5 w-5" aria-hidden />
                </>
              )}
            </button>

            <p className="text-center text-body text-ink-secondary">
              {t("portal.register.haveAccount", "Already have an account?")}{" "}
              <Link
                to="/patient/login"
                className="font-medium text-primary-fg underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {t("portal.register.loginLink", "Log in here")}
              </Link>
            </p>
          </form>
        </>
      )}

      {step === "check_email" && (
        <div className="py-2">
          <h1 className="text-h1 text-ink">
            {t("portal.register.checkEmail.title", "Check your email")}
          </h1>
          <div className="banner banner-info mt-4" role="status">
            <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <p>{confirmNotice}</p>
          </div>
          <Link to="/patient/login" className="btn-primary mt-6 w-full">
            {t("portal.register.checkEmail.loginButton", "Go to log in")}
            <ArrowRightIcon className="h-5 w-5" aria-hidden />
          </Link>
        </div>
      )}

      {step === "success" && (
        <div className="py-6 text-center" role="status">
          <CheckCircleIcon className="mx-auto mb-4 h-12 w-12 text-success" aria-hidden />
          <h1 className="text-h1 text-ink">
            {t("portal.register.success.title", "Your account is ready")}
          </h1>
          <p className="mt-2 text-body text-ink-secondary">
            {t("portal.register.success.body", "Welcome to mBHR. Opening your dashboard…")}
          </p>
          <span
            className="mx-auto mt-6 block h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"
            aria-hidden
          />
        </div>
      )}
    </AuthShell>
  );
}
