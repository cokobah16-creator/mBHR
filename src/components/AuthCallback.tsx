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
import { supabase } from "@/lib/supabaseClient";

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
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        navigate("/patient/dashboard", { replace: true });
      }
    });

    // Timeout fallback — if nothing happened in 10 s, show an error
    const timer = setTimeout(() => {
      setError(
        "Could not verify your account. The link may have expired. Please try logging in.",
      );
    }, 10_000);

    return () => {
      listener.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, [navigate]);

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">✕</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Verification failed</h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => window.location.assign("/patient/login")}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
        <div className="flex justify-center mb-6">
          <div className="w-14 h-14 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Verifying your account…</h1>
        <p className="text-gray-500 text-sm">
          Please wait while we confirm your email address.
        </p>
      </div>
    </div>
  );
}
