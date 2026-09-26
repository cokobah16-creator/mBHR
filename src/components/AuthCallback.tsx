/**
 * AuthCallback
 *
 * Where Supabase sends a patient after they click the email-confirmation
 * link. Supabase Auth (detectSessionInUrl: true) turns the link into a
 * session; this page then finishes the portal sign-in the same way the
 * password login does (access check, first-time link to the clinic record)
 * and opens the portal, or says in plain words why it cannot.
 *
 * Before, it went straight to the dashboard, where an account not yet
 * linked was signed out and sent back to the login page with no message.
 *
 * Route: /auth/callback
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExclamationCircleIcon } from "@heroicons/react/24/outline";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { completePortalSignIn } from "@/features/patient-portal/account/completeSignIn";

const OFFLINE_MESSAGE =
  "This device is offline, so we could not finish signing you in. Connect to the internet, then sign in with your email and password.";

const LINK_FAILED_MESSAGE =
  "We could not confirm your sign-in. The link may have expired or already been used. Please sign in with your email and password.";

const WAIT_MS = 10_000;

export function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const finishing = useRef(false);

  useEffect(() => {
    if (!supabase) {
      navigate("/patient/login", { replace: true });
      return;
    }
    const client: SupabaseClient = supabase;
    let active = true;

    const finish = async () => {
      if (finishing.current) return;
      finishing.current = true;
      const result = await completePortalSignIn(client);
      if (!active) return;
      if (result.kind === "allowed") {
        navigate("/patient/dashboard", { replace: true });
      } else {
        setError({ title: "We could not open your portal", message: result.message });
      }
    };

    const { data: listener } = client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") void finish();
    });

    // The exchange may already be done (for example after a refresh).
    client.auth
      .getSession()
      .then(({ data }) => {
        if (data.session) void finish();
      })
      .catch(() => {
        // The timeout below reports the failure.
      });

    const timer = setTimeout(() => {
      if (finishing.current || !active) return;
      // Without a connection the session cannot be set up at all; do not
      // tell the patient the link expired.
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      setError(
        offline
          ? { title: "Could not finish signing in", message: OFFLINE_MESSAGE }
          : { title: "Could not confirm your sign-in", message: LINK_FAILED_MESSAGE },
      );
    }, WAIT_MS);

    return () => {
      active = false;
      listener.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, [navigate]);

  if (error) {
    return (
      <main className="min-h-screen bg-canvas flex items-center justify-center p-4">
        <div className="panel p-6 sm:p-8 max-w-md w-full" role="alert">
          <div className="flex items-start gap-3">
            <ExclamationCircleIcon
              className="h-6 w-6 shrink-0 text-danger mt-0.5"
              aria-hidden
            />
            <div>
              <h1 className="text-h2 text-ink">{error.title}</h1>
              <p className="mt-1 text-body text-ink-secondary">{error.message}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => window.location.assign("/patient/login")}
            className="btn-primary mt-6 w-full"
          >
            Go to sign in
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-canvas flex items-center justify-center p-4">
      <div className="panel p-6 sm:p-8 max-w-md w-full text-center" role="status">
        <div className="flex justify-center mb-4">
          <span
            className="h-10 w-10 rounded-full border-4 border-primary border-t-transparent motion-safe:animate-spin"
            aria-hidden
          />
        </div>
        <h1 className="text-h2 text-ink mb-1">Signing you in…</h1>
        <p className="text-body text-ink-muted">
          Please wait while we confirm your details with the clinic.
        </p>
      </div>
    </main>
  );
}
