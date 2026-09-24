/**
 * AuthCallback
 *
 * Handles the redirect that Supabase sends after a user clicks the
 * email-confirmation link.  Supabase Auth (with detectSessionInUrl: true)
 * exchanges the URL code/token for a session automatically; this component
 * just shows a friendly "please wait" screen while that exchange happens and
 * then navigates to the patient dashboard.
 *
 * Route: /auth/callback
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExclamationCircleIcon } from "@heroicons/react/24/outline";
import { supabase } from "@/lib/supabaseClient";

const OFFLINE_MESSAGE =
  "This device is offline, so we could not finish signing you in. Connect to the internet, then sign in with your email and password.";

export function AuthCallback() {
  const navigate   = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!supabase) {
      navigate("/patient/login", { replace: true });
      return;
    }

    // supabase-js processes the URL hash/code automatically on initialisation.
    // We listen for the resulting SIGNED_IN event and redirect.
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        navigate("/patient/dashboard", { replace: true });
      } else if (event === "TOKEN_REFRESHED") {
        navigate("/patient/dashboard", { replace: true });
      }
    });

    // Also check if there's already an active session (e.g. page was refreshed
    // after the exchange already completed)
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (data.session) {
          navigate("/patient/dashboard", { replace: true });
        }
      })
      .catch(() => {
        // The timeout below reports the failure.
      });

    // Timeout fallback — if nothing happened in 10 s, show an error
    const timer = setTimeout(() => {
      // Without a connection the session cannot be set up at all; do not
      // tell the patient the link expired. Supabase has already confirmed the
      // email before redirecting here, so signing in is the next step (the
      // email link itself has been used and would not work a second time).
      const offline =
        typeof navigator !== "undefined" && navigator.onLine === false;
      setError(
        offline
          ? OFFLINE_MESSAGE
          : "Could not verify your account. The link may have expired. Please try logging in.",
      );
    }, 10_000);

    return () => {
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
              <h1 className="text-h2 text-ink">
                {error === OFFLINE_MESSAGE
                  ? "Could not finish signing in"
                  : "Verification failed"}
              </h1>
              <p className="mt-1 text-body text-ink-secondary">{error}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => window.location.assign("/patient/login")}
            className="btn-primary mt-6 w-full"
          >
            Back to Login
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
            className="h-10 w-10 rounded-full border-4 border-primary border-t-transparent animate-spin"
            aria-hidden
          />
        </div>
        <h1 className="text-h2 text-ink mb-1">Verifying your account…</h1>
        <p className="text-body text-ink-muted">
          Please wait while we confirm your email address.
        </p>
      </div>
    </main>
  );
}
