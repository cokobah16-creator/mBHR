/**
 * useAuth – Supabase auth hook for the patient portal.
 *
 * Wraps signInWithPassword, signUp (auto-creates the patients row),
 * signOut, and exposes live user/session state. signUp saves the versions
 * of the terms of use and privacy notice the patient accepted, and when,
 * in the new account's user metadata. It refuses people under 18, and never
 * links a new account to a clinic record for someone under 18.
 * Safe to call when Supabase is not configured — all operations no-op
 * gracefully so offline mode keeps working.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { Session, User } from "@/lib/supabaseClient";
import { normalizePhone } from "@/utils/phone";
import { isMinor } from "@/utils/patient";
import {
  ACCEPTANCE_REQUIRED_MESSAGE,
  MINOR_RECORD_LINK_MESSAGE,
  UNDER_18_SIGN_UP_MESSAGE,
  isCompleteAcceptance,
  type PolicyAcceptance,
} from "@/pages/legal/policyMeta";

export interface AuthError {
  message: string;
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

      // 1. Create the Supabase auth user. The accepted versions go in the
      //    user metadata, so they are recorded with the account even when
      //    there is no session yet (email confirmation still pending).
      const { data: authData, error: signUpError } = await supabase.auth.signUp(
        {
          email: data.email,
          password: data.password,
          options: {
            data: {
              full_name: `${data.givenName} ${data.familyName}`.trim(),
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

      // 2. Look for an existing staff-registered patient with this email or phone.
      //    If one exists, stamp auth_uid onto it so the portal can find their
      //    clinical records (vitals, consults, dispenses) via getPatientProfile().
      const orClauses: string[] = [
        `email.eq.${data.email.toLowerCase().trim()}`,
      ];
      if (data.phone) {
        const normPhone = normalizePhone(data.phone);
        if (normPhone) orClauses.push(`phone.eq.${normPhone}`);
      }

      // Security guard: never rebind a patient that already belongs to
      // another auth user, even if their phone/email is matched at sign-up.
      const { data: linkedPatients, error: linkedPatientError } = await supabase
        .from("patients")
        .select("id")
        .or(orClauses.join(","))
        .not("auth_uid", "is", null)
        .neq("auth_uid", authData.user.id)
        .limit(1);

      if (linkedPatientError) {
        return {
          message:
            "We could not automatically verify your clinic profile. Please contact support for identity verification.",
        };
      }

      if (linkedPatients && linkedPatients.length > 0) {
        return {
          message:
            "We could not automatically link your clinic profile. Please contact support for identity verification.",
        };
      }
      const normalizedEmail = data.email.toLowerCase().trim();

      const { data: existingPatient } = await supabase
        .from("patients")
        .select("id, auth_uid, dob, email, phone")
        .or(orClauses.join(","))
        .is("auth_uid", null)
        .maybeSingle();

      if (existingPatient) {
        const normalizedPhone = data.phone ? normalizePhone(data.phone) : null;
        const matchedByEmail =
          !!existingPatient.email &&
          existingPatient.email.toLowerCase().trim() === normalizedEmail;
        const matchedByPhone =
          !!normalizedPhone && existingPatient.phone === normalizedPhone;
        const dobMatches =
          !!existingPatient.dob &&
          !!data.dob &&
          existingPatient.dob === data.dob;
        const canLinkPatient = matchedByEmail || (matchedByPhone && dobMatches);

        // Never link a new account to a child's record, even when the email
        // matches: it is often a parent's email on their child's record.
        // A record with no date of birth still links, as before.
        if (canLinkPatient && isMinor(existingPatient.dob) === true) {
          return { message: MINOR_RECORD_LINK_MESSAGE };
        }

        if (canLinkPatient) {
          // Conditional update: only succeeds if auth_uid is still NULL (race safety).
          const { error: linkError } = await supabase
            .from("patients")
            .update({ auth_uid: authData.user.id })
            .eq("id", existingPatient.id)
            .is("auth_uid", null);

          if (!linkError) return null;
          // If the conditional update found no rows (already linked by a race),
          // fall through and create a fresh row.
        }
      }

      // 3. No existing clinic record — create a fresh patient row for self-registered users.
      const { error: insertError } = await supabase.from("patients").insert({
        id: crypto.randomUUID(),
        auth_uid: authData.user.id,
        given_name: data.givenName,
        family_name: data.familyName,
        email: data.email,
        phone: data.phone ?? null,
        dob: data.dob,
        sex: "other",
        address: "",
        state: "",
        lga: "",
      });

      if (insertError) {
        return {
          message: `Account created but profile save failed: ${insertError.message}`,
        };
      }

      return null;
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
