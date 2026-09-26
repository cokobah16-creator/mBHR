import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ArrowRightIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { useAuth } from "@/hooks/useAuth";
import { loginPatientPortal } from "@/services/patientPortalAuth";
import { supabase, isSupabaseEnabled } from "@/lib/supabaseClient";
import { AuthShell } from "./account/AuthShell";
import { completePortalSignIn } from "@/services/portalCompleteSignIn";
import { env } from "@/config/env";
import { parseCodeChannels } from "@/services/portalCodeSignIn";
import { useT } from "@/hooks/useT";

const SIGN_IN_FAILED_MESSAGE = "portal.login.err.failed";

// An error shown on the page: a message key, or text from the account
// service shown as it comes.
type LoginError = { key: string } | { raw: string } | null;

const onlineSchema = z.object({
  email: z.string().email("portal.login.err.email"),
  credential: z.string().min(6, "portal.login.err.password"),
});

const offlineSchema = z.object({
  email: z.string().email("portal.login.err.email"),
  credential: z.string().regex(/^\d{6}$/, "portal.login.err.pin"),
});

type LoginForm = z.infer<typeof onlineSchema>;

export function PatientLogin() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { t } = useT();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LoginError>(null);
  const errorText = error ? ("raw" in error ? error.raw : t(error.key)) : "";
  const schema = isSupabaseEnabled ? onlineSchema : offlineSchema;
  const codeSignInOn =
    isSupabaseEnabled && parseCodeChannels(env.VITE_PORTAL_CODE_CHANNELS).length > 0;

  const form = useForm<LoginForm>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", credential: "" },
  });
  const { errors } = form.formState;

  const handleSupabaseLogin = async (data: LoginForm) => {
    const authError = await login(data.email, data.credential);
    if (authError) {
      const msg = authError.message.toLowerCase();
      if (
        msg.includes("invalid login") ||
        msg.includes("invalid credentials")
      ) {
        setError({ key: "portal.login.err.incorrect" });
      } else if (msg.includes("email not confirmed")) {
        setError({ key: "portal.login.err.unconfirmed" });
      } else if (msg.includes("too many requests")) {
        setError({ key: "portal.login.err.tooMany" });
      } else {
        // Never show the provider's own text: it is technical and may
        // repeat what was typed.
        setError({ key: SIGN_IN_FAILED_MESSAGE });
      }
      return;
    }

    // Portal access is decided by the clinic's server: open the portal only
    // when it says access is on. Anything else (off, not linked, no answer)
    // signs the account out again on this device.
    if (!supabase) return;
    const result = await completePortalSignIn(supabase);
    if (result.kind === "refused") {
      setError({ raw: result.message });
      return;
    }
    navigate("/patient/dashboard");
  };

  const handleOfflineLogin = async (data: LoginForm) => {
    const result = await loginPatientPortal(
      data.email,
      data.credential,
      "pin",
    ).catch(() => null);
    if (result?.success && result.sessionToken) {
      sessionStorage.setItem("patient_session_token", result.sessionToken);
      localStorage.setItem(
        "patient_portal_user",
        JSON.stringify(result.portalUser),
      );
      navigate("/patient/dashboard");
    } else {
      setError(
        result?.error
          ? { raw: result.error }
          : { key: "portal.login.err.noAccount" },
      );
    }
  };

  const handleSubmit = async (data: LoginForm) => {
    setLoading(true);
    setError(null);
    try {
      if (isSupabaseEnabled) {
        await handleSupabaseLogin(data);
      } else {
        await handleOfflineLogin(data);
      }
    } catch {
      setError({ key: "portal.login.err.unexpected" });
    } finally {
      setLoading(false);
    }
  };

  const hintId = "credential-hint";
  const credentialDescribedBy = [
    hintId,
    errors.credential ? "credential-error" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <AuthShell>
      <div className="mb-6">
        <h1 className="text-h1 text-ink">{t("portal.login.title")}</h1>
        <p className="mt-1 text-body text-ink-muted">
          {isSupabaseEnabled ? (
            t("portal.login.introPassword")
          ) : (
            t("portal.login.introPin")
          )}
        </p>
      </div>

      {!isSupabaseEnabled && (
        <div className="banner banner-info mb-5">
          <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div className="space-y-1">
            <p className="font-medium">{t("portal.login.offlineTitle")}</p>
            <p className="text-label font-normal">
              {t("portal.login.offlineBody")}
            </p>
          </div>
        </div>
      )}

      {errorText && (
        <div className="banner banner-danger mb-5" role="alert">
          <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>{errorText}</p>
        </div>
      )}

      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-5"
        noValidate
      >
        <div>
          <label htmlFor="email" className="field-label">
            {t("portal.login.email")}
          </label>
          <input
            {...form.register("email")}
            type="email"
            id="email"
            placeholder="your.email@example.com"
            className="input-field"
            disabled={loading}
            autoComplete="email"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "email-error" : undefined}
          />
          {errors.email && (
            <p id="email-error" className="field-error">
              {t(String(errors.email.message))}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="credential" className="field-label">
            {isSupabaseEnabled ? t("portal.login.password") : t("portal.login.pin")}
          </label>
          <input
            {...form.register("credential")}
            type="password"
            id="credential"
            inputMode={isSupabaseEnabled ? undefined : "numeric"}
            placeholder={isSupabaseEnabled ? t("portal.login.passwordPlaceholder") : "••••••"}
            maxLength={isSupabaseEnabled ? undefined : 6}
            className="input-field"
            disabled={loading}
            autoComplete="current-password"
            aria-invalid={errors.credential ? true : undefined}
            aria-describedby={credentialDescribedBy}
          />
          {isSupabaseEnabled ? (
            <div className="mt-1 flex items-center justify-between gap-3">
              <p id={hintId} className="field-hint mt-0">
                {t("portal.login.passwordHint")}
              </p>
              <Link
                to="/patient/forgot-password"
                className="inline-flex min-h-touch-target shrink-0 items-center text-label text-primary-fg underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {t("portal.login.forgot")}
              </Link>
            </div>
          ) : (
            <p id={hintId} className="field-hint">
              {t("portal.login.pinHint")}
            </p>
          )}
          {errors.credential && (
            <p id="credential-error" className="field-error">
              {t(String(errors.credential.message))}
            </p>
          )}
        </div>

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
              {t("portal.login.loggingIn")}
            </>
          ) : (
            <>
              {t("portal.login.submit")}
              <ArrowRightIcon className="h-5 w-5" aria-hidden />
            </>
          )}
        </button>

        {codeSignInOn && (
          <Link
            to="/patient/sign-in-code"
            className="btn-secondary w-full"
          >
            {t("portal.login.useCode")}
          </Link>
        )}

        <p className="text-center text-body text-ink-secondary">
          {t("portal.login.noAccount")}{" "}
          <Link
            to="/patient/register"
            className="font-medium text-primary-fg underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t("portal.login.register")}
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
