/**
 * useAuth – Supabase auth hook for the patient portal.
 *
 * Wraps signInWithPassword, signUp (then links the clinic record on the
 * server with portal_link_patient_record), signOut, and exposes live
 * user/session state. signUp saves the versions of the terms of use and
 * privacy notice the patient accepted, and when, in the new account's user
 * metadata. Before any account is made it refuses a sign-up without all
 * three boxes ticked, and anyone under 18. The server refuses to link a
 * child's clinic record or to create a record for an under-18 date of birth
 * (20260926120100_portal_link_adults_only.sql).
 * Safe to call when Supabase is not configured — all operations no-op
 * gracefully so offline mode keeps working.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { Session, User } from "@/lib/supabaseClient";
import { clearStoredSupabaseAuth } from "@/lib/supabaseAuthStorage";
import { normalizePhone } from "@/utils/phone";
import { isMinor } from "@/utils/patient";
import { linkPortalAccount } from "@/services/portalSignIn";
import {
  ACCEPTANCE_REQUIRED_MESSAGE,
  UNDER_18_SIGN_UP_MESSAGE,
  isCompleteAcceptance,
  type PolicyAcceptance,
} from "@/pages/legal/policyMeta";

export interface AuthError {
  message: string;
  /**
   * Set when the account was created but is not ready yet:
   * confirm_email: sign-up needs the email confirmed before the clinic
   *   record can be linked (not an error; show it as information);
   * not_linked: the server did not link a clinic record (message says why).
   */
  code?: "confirm_email" | "not_linked";
}

export interface SignUpData {
  email: string;
  password: string;
  givenName: string;
  familyName: string;
  phone?: string;
  /** YYYY-MM-DD. Required: sign-up is refused for anyone under 18. */
  dob: string;
  /**
   * What the patient ticked on the sign-up form. Saved with the account;
   * sign-up is refused without it.
   */
  acceptance: PolicyAcceptance;
}

export interface UseAuthReturn {
  user: User | null;
  session: Session | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthError | null>;
  signup: (data: SignUpData) => Promise<AuthError | null>;
  logout: () => Promise<void>;
  isSupabaseEnabled: boolean;
}

export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    // Prime from existing session immediately (no network call)
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session);
        setUser(data.session?.user ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);
      },
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<AuthError | null> => {
      if (!supabase)
        return {
          message: "Supabase is not configured — running in offline mode.",
        };
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) return { message: error.message };
      return null;
    },
    [],
  );

  const signup = useCallback(
    async (data: SignUpData): Promise<AuthError | null> => {
      if (!supabase)
        return {
          message: "Supabase is not configured — running in offline mode.",
        };

      if (!isCompleteAcceptance(data.acceptance)) {
        return { message: ACCEPTANCE_REQUIRED_MESSAGE };
      }

      // Portal accounts are for adults. Check before any account is made.
      const minor = isMinor(data.dob);
      if (minor === null) {
        return { message: "Please enter a real date of birth." };
      }
      if (minor) return { message: UNDER_18_SIGN_UP_MESSAGE };

      const phone = data.phone ? normalizePhone(data.phone) || data.phone.trim() : null;

      // 1. Create the Supabase auth user. The registration details are kept
      //    on the account so the clinic record can be linked at the first
      //    sign-in when the email address must be confirmed first. The
      //    accepted versions are kept there too, so they are recorded with
      //    the account even when there is no session yet.
      const { data: authData, error: signUpError } = await supabase.auth.signUp(
        {
          email: data.email,
          password: data.password,
          options: {
            data: {
              full_name: `${data.givenName} ${data.familyName}`.trim(),
              given_name: data.givenName,
              family_name: data.familyName,
              dob: data.dob,
              phone,
              terms_version: data.acceptance.termsVersion,
              privacy_version: data.acceptance.privacyVersion,
              accepted_at: data.acceptance.acceptedAt,
            },
          },
        },
      );

      if (signUpError) return { message: signUpError.message };
      if (!authData.user)
        return { message: "Sign-up succeeded but no user was returned." };

      // Email confirmation required: there is no session yet, so the clinic
      // record is linked when the patient first signs in.
      if (!authData.session) {
        return {
          code: "confirm_email",
          message:
            "Your account is created. Confirm your email address with the link we sent you, then sign in to finish.",
        };
      }

      // 2. Link the clinic record on the server (or create a self-registered
      //    one). The server matches only verified contact details and the
      //    date of birth; the device never reads or writes patients here.
      //    A child's record, or an under-18 date of birth, comes back as
      //    needs_staff_verification (see portalLinkOutcome).
      const outcome = await linkPortalAccount(supabase, {
        dob: data.dob,
        givenName: data.givenName,
        familyName: data.familyName,
        phone,
      });
      if (outcome.linked) return null;

      // Not linked: do not stay signed in to a portal with no record.
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      clearStoredSupabaseAuth();
      return {
        code: "not_linked",
        message: outcome.message ?? "Your account could not be linked to your clinic record.",
      };
    },
    [],
  );

  const logout = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    // Clear legacy session keys from the old offline auth system
    sessionStorage.removeItem("patient_session_token");
    localStorage.removeItem("patient_portal_user");
    localStorage.removeItem("patient_active_profile");
  }, []);

  return {
    user,
    session,
    loading,
    login,
    signup,
    logout,
    isSupabaseEnabled: supabase !== null,
  };
}
