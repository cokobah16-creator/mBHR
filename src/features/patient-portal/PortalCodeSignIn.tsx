import { useEffect, useId, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  DevicePhoneMobileIcon,
  EnvelopeIcon,
} from "@heroicons/react/24/outline";
import { useT } from "@/hooks/useT";
import { env } from "@/config/env";
import { supabase } from "@/lib/supabaseClient";
import {
  maskDestination,
  normalizeEmail,
  normalizeNigerianPhone,
  parseCodeChannels,
  sendPortalCode,
  verifyPortalCode,
  type CodeChannel,
  type CodeDestination,
  type SendCodeResult,
  type VerifyCodeResult,
} from "@/services/portalCodeSignIn";
import { AuthShell } from "./account/AuthShell";
import { completePortalSignIn } from "./account/completeSignIn";
import { OTPInput } from "./OTPInput";
import { PatientFriendlyAlert } from "./ui/PatientFriendlyAlert";
import { PortalField } from "./ui/PortalField";

/** Seconds before a new code can be requested. */
export const RESEND_AFTER_SECONDS = 60;
const CODE_LENGTH = 6;

type SendFailure = Exclude<SendCodeResult, { ok: true }>["reason"];
type VerifyFailure = Exclude<VerifyCodeResult, { ok: true }>["reason"] | "incomplete";

function useSecondsLeft(until: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until]);
  if (until === null) return 0;
  return Math.max(0, Math.ceil((until - now) / 1000));
}

/**
 * Sign in with a one-time code: enter phone or email, get a code, enter it.
 * Two separate steps with their own headings, so "enter your phone number"
 * is never confused with "enter the code we sent you", and neither looks
 * like a password form.
 */
export function PortalCodeSignIn({
  channels = parseCodeChannels(env.VITE_PORTAL_CODE_CHANNELS),
}: {
  channels?: CodeChannel[];
}) {
  const { t } = useT();
  const navigate = useNavigate();
  const codeErrorId = useId();

  const [channel, setChannel] = useState<CodeChannel>(channels[0] ?? "sms");
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState("");
  const [dest, setDest] = useState<CodeDestination | null>(null);
  const [step, setStep] = useState<"destination" | "code">("destination");
  const [sending, setSending] = useState(false);
  const [sendFailure, setSendFailure] = useState<SendFailure | null>(null);
  const [resent, setResent] = useState(false);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyFailure, setVerifyFailure] = useState<VerifyFailure | null>(null);
  const [refusal, setRefusal] = useState("");
  const secondsLeft = useSecondsLeft(resendAt);

  if (channels.length === 0 || !supabase) {
    return (
      <AuthShell>
        <h1 className="text-h1 text-ink">{t("portal.code.title", "Sign in with a code")}</h1>
        <p className="mt-2 text-body text-ink-secondary">
          {t(
            "portal.code.notAvailable",
            "Signing in with a code is not available yet. Please sign in with your email and password.",
          )}
        </p>
        <Link to="/patient/login" className="btn-primary mt-6 w-full">
          {t("portal.code.usePassword", "Sign in with email and password")}
        </Link>
      </AuthShell>
    );
  }
  const client = supabase;

  const otherChannel: CodeChannel | null =
    channels.find((c) => c !== channel) ?? null;

  const switchChannel = (next: CodeChannel) => {
    setChannel(next);
    setInput("");
    setInputError("");
    setSendFailure(null);
    setDest(null);
    setStep("destination");
  };

  const send = async (target: CodeDestination, isResend: boolean) => {
    setSending(true);
    setSendFailure(null);
    setResent(false);
    const result = await sendPortalCode(client, target);
    setSending(false);
    if (!result.ok) {
      setSendFailure(result.reason);
      return;
    }
    setDest(target);
    setStep("code");
    setCode("");
    setVerifyFailure(null);
    setResendAt(Date.now() + RESEND_AFTER_SECONDS * 1000);
    setResent(isResend);
  };

  const onSubmitDestination = (e: FormEvent) => {
    e.preventDefault();
    setRefusal("");
    const value =
      channel === "sms" ? normalizeNigerianPhone(input) : normalizeEmail(input);
    if (!value) {
      setInputError(
        channel === "sms"
          ? t("portal.code.phoneInvalid", "Enter a Nigerian mobile number, for example 0803 123 4567.")
          : t("portal.code.emailInvalid", "Enter an email address, for example name@example.com."),
      );
      return;
    }
    setInputError("");
    void send({ channel, value }, false);
  };

  const onVerify = async (e: FormEvent) => {
    e.preventDefault();
    if (!dest) return;
    if (code.length !== CODE_LENGTH) {
      setVerifyFailure("incomplete");
      return;
    }
    setVerifying(true);
    setVerifyFailure(null);
    const result = await verifyPortalCode(client, dest, code);
    if (!result.ok) {
      setVerifying(false);
      setVerifyFailure(result.reason);
      return;
    }
    const signIn = await completePortalSignIn(client);
    setVerifying(false);
    if (signIn.kind === "allowed") {
      navigate("/patient/dashboard", { replace: true });
      return;
    }
    // Signed out again by completePortalSignIn: start over with the reason.
    setRefusal(signIn.message);
    setStep("destination");
    setCode("");
    setResendAt(null);
  };

  const masked = dest ? maskDestination(dest) : "";
  const failedTarget =
    channel === "sms" ? normalizeNigerianPhone(input) : normalizeEmail(input);
  const failedMasked = failedTarget ? maskDestination({ channel, value: failedTarget }) : "";

  const sendFailureBody = (reason: SendFailure) => {
    switch (reason) {
      case "offline":
        return t("portal.code.sendOffline", "You're offline. Connect to the internet and try again.");
      case "rate_limited":
        return t("portal.code.sendRateLimited", "Too many codes were asked for. Wait a few minutes, then try again.");
      case "delivery_failed":
        return t("portal.code.sendDeliveryFailed", "The message could not be delivered. Check the details and try again.");
      default:
        return t(
          "portal.code.sendUnavailable",
          "Check that this is the phone number or email your clinic has for you. If it is, ask the care team for help signing in.",
        );
    }
  };

  const verifyFailureText = (reason: VerifyFailure) => {
    switch (reason) {
      case "incomplete":
        return t("portal.code.incomplete", {
          defaultValue: "Enter all {{length}} digits of the code.",
          length: CODE_LENGTH,
        });
      case "invalid":
        return t("portal.code.invalid", "That code is wrong or has expired. Check it, or ask for a new code.");
      case "offline":
        return t("portal.code.verifyOffline", "You're offline. Connect to the internet, then enter the code again.");
      case "rate_limited":
        return t("portal.code.verifyRateLimited", "Too many tries. Wait a few minutes, then ask for a new code.");
      default:
        return t("portal.code.verifyFailed", "We couldn't check the code. Try again in a moment.");
    }
  };

  const channelLabel = (c: CodeChannel) =>
    c === "sms"
      ? t("portal.code.byPhone", "Phone number")
      : t("portal.code.byEmail", "Email address");

  if (step === "code" && dest) {
    return (
      <AuthShell>
        <h1 className="text-h1 text-ink">
          {t("portal.code.enterTitle", "Enter the code we sent you")}
        </h1>
        <p className="mt-2 text-body text-ink-secondary">
          {t("portal.code.sentTo", {
            defaultValue: "We sent a {{length}}-digit code to {{destination}}.",
            length: CODE_LENGTH,
            destination: masked,
          })}
        </p>
        <button
          type="button"
          onClick={() => {
            setStep("destination");
            setCode("");
            setVerifyFailure(null);
          }}
          className="mt-1 inline-flex min-h-touch-target items-center text-body text-primary-fg underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {dest.channel === "sms"
            ? t("portal.code.changePhone", "Change phone number")
            : t("portal.code.changeEmail", "Change email address")}
        </button>

        {resent && (
          <div className="mt-4">
            <PatientFriendlyAlert tone="success">
              {t("portal.code.resent", "We sent a new code. Use the newest one.")}
            </PatientFriendlyAlert>
          </div>
        )}
        {sendFailure && (
          <div className="mt-4">
            <PatientFriendlyAlert
              tone="danger"
              title={t("portal.code.sendFailedTitle", {
                defaultValue: "We couldn't send the code to {{destination}}.",
                destination: masked,
              })}
            >
              {sendFailureBody(sendFailure)}
            </PatientFriendlyAlert>
          </div>
        )}

        <form onSubmit={onVerify} className="mt-6 space-y-5" noValidate>
          <OTPInput
            length={CODE_LENGTH}
            value={code}
            onChange={(v) => {
              setCode(v);
              if (verifyFailure) setVerifyFailure(null);
            }}
            disabled={verifying}
            error={!!verifyFailure}
            errorId={codeErrorId}
            label={t("portal.code.codeLabel", "Sign-in code")}
          />
          {verifyFailure && (
            <p id={codeErrorId} role="alert" className="field-error text-body text-center">
              {verifyFailureText(verifyFailure)}
            </p>
          )}
          <button type="submit" disabled={verifying} className="btn-primary w-full">
            {verifying
              ? t("portal.code.verifying", "Checking the code…")
              : t("portal.code.verify", "Sign in")}
          </button>
        </form>

        <div className="mt-5 text-center text-body text-ink-secondary" aria-live="polite">
          {secondsLeft > 0 ? (
            <p>
              {t("portal.code.resendIn", {
                defaultValue: "You can ask for a new code in {{seconds}} seconds.",
                seconds: secondsLeft,
              })}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => void send(dest, true)}
              disabled={sending}
              className="btn-secondary w-full"
            >
              {sending
                ? t("portal.code.sending", "Sending…")
                : t("portal.code.resend", "Send a new code")}
            </button>
          )}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="text-h1 text-ink">{t("portal.code.title", "Sign in with a code")}</h1>
      <p className="mt-2 text-body text-ink-secondary">
        {t(
          "portal.code.intro",
          "We'll send a one-time code to the phone number or email your clinic has for you.",
        )}
      </p>

      {refusal && (
        <div className="mt-4">
          <PatientFriendlyAlert tone="danger">{refusal}</PatientFriendlyAlert>
        </div>
      )}

      {channels.length > 1 && (
        <div
          role="radiogroup"
          aria-label={t("portal.code.chooseChannel", "Where should we send your code?")}
          className="mt-5 grid grid-cols-2 gap-2"
        >
          {channels.map((c) => {
            const selected = c === channel;
            const Icon = c === "sms" ? DevicePhoneMobileIcon : EnvelopeIcon;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => switchChannel(c)}
                className={`flex min-h-touch-target items-center justify-center gap-2 rounded-md border px-3 py-2 text-body focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  selected
                    ? "border-primary bg-primary-soft font-semibold text-primary-fg"
                    : "border-line-strong bg-surface text-ink-secondary hover:bg-surface-hover"
                }`}
              >
                <Icon className="h-5 w-5" aria-hidden />
                {c === "sms" ? t("portal.code.textMe", "Text message") : t("portal.code.emailMe", "Email")}
              </button>
            );
          })}
        </div>
      )}

      {sendFailure && (
        <div className="mt-4">
          <PatientFriendlyAlert
            tone="danger"
            title={t("portal.code.sendFailedTitle", {
              defaultValue: "We couldn't send the code to {{destination}}.",
              destination: failedMasked,
            })}
            action={
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => failedTarget && void send({ channel, value: failedTarget }, false)}
                  disabled={sending}
                  className="btn-secondary"
                >
                  {t("portal.error.retry", "Try again")}
                </button>
                {otherChannel && (
                  <button
                    type="button"
                    onClick={() => switchChannel(otherChannel)}
                    className="btn-ghost"
                  >
                    {otherChannel === "email"
                      ? t("portal.code.useEmail", "Use email instead")
                      : t("portal.code.usePhone", "Use phone instead")}
                  </button>
                )}
              </div>
            }
          >
            {sendFailureBody(sendFailure)}
          </PatientFriendlyAlert>
        </div>
      )}

      <form onSubmit={onSubmitDestination} className="mt-5 space-y-5" noValidate>
        <PortalField
          label={channelLabel(channel)}
          required
          error={inputError || undefined}
          hint={
            channel === "sms"
              ? t("portal.code.phoneHint", "We'll text a 6-digit code to this number.")
              : t("portal.code.emailHint", "We'll email a 6-digit code to this address.")
          }
        >
          {(props) => (
            <input
              {...props}
              type={channel === "sms" ? "tel" : "email"}
              inputMode={channel === "sms" ? "tel" : "email"}
              autoComplete={channel === "sms" ? "tel" : "email"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={sending}
            />
          )}
        </PortalField>
        <button type="submit" disabled={sending} className="btn-primary w-full">
          {sending ? t("portal.code.sending", "Sending…") : t("portal.code.send", "Send code")}
        </button>
      </form>

      <p className="mt-5 text-center text-body text-ink-secondary">
        <Link
          to="/patient/login"
          className="inline-flex min-h-touch-target items-center text-primary-fg underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t("portal.code.usePassword", "Sign in with email and password")}
        </Link>
      </p>
    </AuthShell>
  );
}
