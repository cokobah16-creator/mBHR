/**
 * Email delivery check
 *
 * Shows whether this device can reach the email Edge Function, and sends a
 * test email so an administrator can see what actually happens. Nothing on
 * this page is assumed: every status comes from configuration or a test.
 */

import { useState, type FormEvent } from "react";
import {
  EnvelopeIcon,
  ClipboardDocumentIcon,
} from "@heroicons/react/24/outline";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/stores/toast";
import { useAuthStore } from "@/stores/auth";
import { generateId } from "@/db";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge, type Tone } from "@/components/ui/StatusBadge";
import { useServerStatus } from "@/features/admin/useServerStatus";
import { canUseSystemTools } from "@/features/admin/adminSections";
import type { ServerState } from "@/features/admin/serverStatus";

interface TestResult {
  success: boolean;
  demo?: boolean;
  messageId?: string;
  message?: string;
  error?: string;
  /** Raw response or error, for the "View raw response" section. */
  details?: unknown;
}

const SERVER_TONE: Record<ServerState, Tone> = {
  available: "success",
  offline: "warning",
  "not-configured": "neutral",
};

const BREADCRUMBS = [
  { label: "Administration", to: "/admin" },
  { label: "Email delivery check" },
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEST_CODE = "123456";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "The request failed.";
}

type ProviderState = "unknown" | "working" | "demo" | "failed";

function providerStatus(result: TestResult | null): {
  state: ProviderState;
  tone: Tone;
  label: string;
  detail: string;
} {
  if (!result) {
    return {
      state: "unknown",
      tone: "neutral",
      label: "Not tested yet",
      detail: "Send a test email below to find out whether email is set up.",
    };
  }
  if (!result.success) {
    return {
      state: "failed",
      tone: "danger",
      label: "Test failed",
      detail: "The last test did not send an email. See the result below.",
    };
  }
  if (result.demo) {
    return {
      state: "demo",
      tone: "warning",
      label: "Demo mode: no email sent",
      detail:
        "The Edge Function has no RESEND_API_KEY, so it writes codes to its logs instead of sending email.",
    };
  }
  return {
    state: "working",
    tone: "success",
    label: "Sending works",
    detail: "The last test email was accepted for delivery.",
  };
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const projectRef = supabaseUrl?.split("//")[1]?.split(".")[0];

export default function EmailDiagnostics() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const canTest = canUseSystemTools(currentUser?.role);
  const server = useServerStatus();
  const { push: pushToast } = useToast();

  const [testing, setTesting] = useState(false);
  const [testEmail, setTestEmail] = useState(currentUser?.email ?? "");
  const [emailError, setEmailError] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const edgeFunctionUrl =
    supabase && supabaseUrl ? `${supabaseUrl}/functions/v1/send-otp-email` : "";
  const provider = providerStatus(testResult);

  const testEmailFunction = async (e: FormEvent) => {
    e.preventDefault();
    if (!canTest) {
      pushToast({
        id: generateId(),
        tone: "error",
        title: "Not allowed",
        body: "Only an administrator can send test emails.",
      });
      return;
    }
    const email = testEmail.trim();
    if (!EMAIL_PATTERN.test(email)) {
      setEmailError("Enter an email address like name@example.com.");
      return;
    }
    setEmailError("");
    if (!supabase || !server.available) return;

    setTesting(true);
    setTestResult(null);

    try {
      // Call the Edge Function directly
      const { data, error } = await supabase.functions.invoke(
        "send-otp-email",
        {
          body: { email, otp: TEST_CODE },
        },
      );

      if (error) {
        setTestResult({
          success: false,
          error: error.message,
          details: error,
        });
        pushToast({
          id: generateId(),
          tone: "error",
          title: "Test failed",
          body: error.message,
        });
      } else {
        const result: TestResult = {
          success: data?.success || false,
          demo: data?.demo || false,
          messageId: data?.messageId,
          message: data?.message,
          details: data,
        };
        setTestResult(result);

        if (result.demo) {
          pushToast({
            id: generateId(),
            tone: "warning",
            title: "Demo mode: no email sent",
            body: "The Edge Function is running without an email key. The code is in its logs.",
          });
        } else if (result.success) {
          pushToast({
            id: generateId(),
            tone: "success",
            title: "Test email accepted",
            body: `Sent to ${email}. Check that inbox (and spam) to confirm it arrived.`,
          });
        } else {
          pushToast({
            id: generateId(),
            tone: "error",
            title: "Test failed",
            body: result.message || "The Edge Function did not report success.",
          });
        }
      }
    } catch (error) {
      const message = errorMessage(error);
      setTestResult({
        success: false,
        error: message,
        details: error instanceof Error ? { name: error.name, message } : error,
      });
      pushToast({
        id: generateId(),
        tone: "error",
        title: "Test failed",
        body: message,
      });
    } finally {
      setTesting(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      pushToast({
        id: generateId(),
        tone: "success",
        title: "Copied",
        body: `${text} copied to the clipboard.`,
      });
    } catch {
      pushToast({
        id: generateId(),
        tone: "warning",
        title: "Could not copy",
        body: `Select and copy it yourself: ${text}`,
      });
    }
  };

  const describedBy = ["testEmail-hint", emailError && "testEmail-error"]
    .filter(Boolean)
    .join(" ");

  const resultTone: Tone = !testResult
    ? "neutral"
    : !testResult.success
      ? "danger"
      : testResult.demo
        ? "warning"
        : "success";
  const resultBanner =
    resultTone === "danger"
      ? "banner-danger"
      : resultTone === "warning"
        ? "banner-warning"
        : "banner-success";

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumbs={BREADCRUMBS}
        title="Email delivery check"
        description="Check whether patient portal emails (invitations and sign-in codes) can be sent from this setup."
      />

      {/* Status */}
      <section className="panel" aria-labelledby="email-status-title">
        <div className="panel-header">
          <h2 id="email-status-title" className="panel-title">
            Current status
          </h2>
        </div>
        <dl className="divide-y divide-line" aria-live="polite">
          <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
            <dt className="text-label text-ink sm:w-48">Server connection</dt>
            <dd className="flex-1 space-y-1">
              <StatusBadge tone={SERVER_TONE[server.state]} icon>
                {server.label}
              </StatusBadge>
              <p className="text-caption text-ink-muted">{server.detail}</p>
            </dd>
          </div>
          <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
            <dt className="text-label text-ink sm:w-48">Email function</dt>
            <dd className="min-w-0 flex-1 space-y-1">
              {edgeFunctionUrl ? (
                <>
                  <p className="text-caption text-ink-muted">
                    send-otp-email. Whether it is deployed is only known after a
                    test.
                  </p>
                  <code className="block overflow-x-auto rounded-md bg-surface-sunken px-2 py-1 text-caption text-ink-secondary">
                    {edgeFunctionUrl}
                  </code>
                </>
              ) : (
                <p className="text-caption text-ink-muted">
                  Not available: no server is configured for this app.
                </p>
              )}
            </dd>
          </div>
          <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:gap-4">
            <dt className="text-label text-ink sm:w-48">Email provider</dt>
            <dd className="flex-1 space-y-1">
              <StatusBadge tone={provider.tone} icon>
                {provider.label}
              </StatusBadge>
              <p className="text-caption text-ink-muted">{provider.detail}</p>
            </dd>
          </div>
        </dl>
      </section>

      {/* Test Email Form */}
      <form
        onSubmit={testEmailFunction}
        className="panel"
        aria-labelledby="email-test-title"
        noValidate
      >
        <div className="panel-header">
          <h2 id="email-test-title" className="panel-title">
            Send a test email
          </h2>
        </div>
        <div className="panel-body space-y-3">
          <div className="max-w-md">
            <label htmlFor="testEmail" className="field-label">
              Send to
            </label>
            <input
              type="email"
              id="testEmail"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              className="input-field"
              placeholder="name@example.com"
              aria-invalid={emailError ? true : undefined}
              aria-describedby={describedBy}
            />
            <p id="testEmail-hint" className="field-hint">
              We send a sample sign-in email with the code {TEST_CODE}. It is not
              a real code.
            </p>
            {emailError && (
              <p id="testEmail-error" className="field-error">
                {emailError}
              </p>
            )}
          </div>

          {!server.available && (
            <p className="text-caption text-warning-fg">
              {server.state === "offline"
                ? "You're offline. Connect to the internet to send a test."
                : "No server is configured, so emails cannot be sent from this app."}
            </p>
          )}
          {!canTest && (
            <p className="text-caption text-warning-fg">
              Only an administrator can send test emails.
            </p>
          )}

          <button
            type="submit"
            disabled={testing || !testEmail.trim() || !server.available || !canTest}
            className="btn-primary"
          >
            <EnvelopeIcon className="h-5 w-5" aria-hidden />
            {testing ? "Sending…" : "Send test email"}
          </button>
        </div>
      </form>

      {/* Test Results */}
      {testResult && (
        <section className="panel" aria-labelledby="email-result-title">
          <div className="panel-header">
            <h2 id="email-result-title" className="panel-title">
              Test result
            </h2>
          </div>
          <div className="panel-body space-y-3">
            <div className={`banner ${resultBanner}`} role="status">
              <div className="space-y-1">
                <p className="font-medium">
                  {testResult.success
                    ? testResult.demo
                      ? "Demo mode: no email was sent"
                      : "Test email accepted for delivery"
                    : "The test email was not sent"}
                </p>
                {testResult.demo && (
                  <ul className="list-disc space-y-0.5 pl-5 text-caption">
                    <li>No RESEND_API_KEY is set in the Edge Function secrets.</li>
                    <li>The code is written to the Edge Function logs instead.</li>
                    <li>Check Supabase Dashboard → Edge Functions → Logs.</li>
                  </ul>
                )}
                {testResult.messageId && (
                  <p className="text-caption">Message ID: {testResult.messageId}</p>
                )}
                {testResult.message && (
                  <p className="text-caption">{testResult.message}</p>
                )}
                {testResult.error && (
                  <p className="text-caption">Error: {testResult.error}</p>
                )}
              </div>
            </div>

            <details>
              <summary className="cursor-pointer text-label text-ink-secondary hover:text-ink">
                View raw response
              </summary>
              <pre className="mt-2 overflow-x-auto rounded-md bg-surface-sunken p-3 text-caption text-ink">
                {JSON.stringify(testResult, null, 2)}
              </pre>
            </details>
          </div>
        </section>
      )}

      {/* Setup Instructions */}
      <section className="panel" aria-labelledby="email-setup-title">
        <div className="panel-header">
          <h2 id="email-setup-title" className="panel-title">
            Set up email sending
          </h2>
          <span className="text-caption text-ink-muted">
            Needed if the test shows demo mode
          </span>
        </div>
        <div className="panel-body space-y-4 text-body text-ink-secondary">
          <div>
            <h3 className="text-label text-ink">1. Create a Resend account</h3>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              <li>
                Visit{" "}
                <a
                  href="https://resend.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  resend.com
                </a>{" "}
                and sign up.
              </li>
              <li>Verify your email address.</li>
            </ol>
          </div>

          <div>
            <h3 className="text-label text-ink">2. Generate an API key</h3>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              <li>Go to API Keys in the Resend dashboard.</li>
              <li>Click "Create API Key".</li>
              <li>Name: "mBHR Patient Portal". Permission: "Sending access".</li>
              <li>Copy the key (it starts with "re_").</li>
            </ol>
          </div>

          <div>
            <h3 className="text-label text-ink">3. Add it to Supabase</h3>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              <li>Open the Supabase dashboard.</li>
              <li>Go to Settings → Edge Functions → Secrets.</li>
              <li>
                Add a secret named{" "}
                <code className="rounded bg-surface-sunken px-1">RESEND_API_KEY</code>{" "}
                with your API key as the value.
              </li>
              <li>Wait about 30 seconds for the functions to reload.</li>
            </ol>
          </div>

          <div>
            <h3 className="text-label text-ink">4. Test again</h3>
            <p className="mt-1">Send a test email above and check the result.</p>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <a
              href="https://resend.com"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
            >
              Resend website
            </a>
            {projectRef && (
              <a
                href={`https://supabase.com/dashboard/project/${projectRef}/settings/functions`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary"
              >
                Supabase Edge Function settings
              </a>
            )}
            <button
              type="button"
              onClick={() => copyToClipboard("RESEND_API_KEY")}
              className="btn-secondary"
            >
              <ClipboardDocumentIcon className="h-4 w-4" aria-hidden />
              Copy secret name
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
