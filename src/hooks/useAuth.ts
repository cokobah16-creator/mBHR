/**
 * useAuth – Supabase auth hook for the patient portal.
 *
 * Wraps signInWithPassword, signUp (auto-creates the patients row),
 * signOut, and exposes live user/session state.
 * Safe to call when Supabase is not configured — all operations no-op
 * gracefully so offline mode keeps working.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { Session, User } from "@/lib/supabaseClient";
import { normalizePhone } from "@/utils/phone";

export interface AuthError {
  message: string;
}

export interface SignUpData {
  email: string;
  password: string;
  givenName: string;
  familyName: string;
  phone?: string;
  dob?: string;
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
  const [user,    setUser]    = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    // Prime from existing session immediately (no network call)
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<AuthError | null> => {
    if (!supabase) return { message: "Supabase is not configured — running in offline mode." };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { message: error.message };
    return null;
  }, []);

  const signup = useCallback(async (data: SignUpData): Promise<AuthError | null> => {
    if (!supabase) return { message: "Supabase is not configured — running in offline mode." };

    // 1. Create the Supabase auth user
    const { data: authData, error: signUpError } = await supabase.auth.signUp({
      email:    data.email,
      password: data.password,
      options: {
        data: { full_name: `${data.givenName} ${data.familyName}`.trim() },
      },
    });

    if (signUpError) return { message: signUpError.message };
    if (!authData.user) return { message: "Sign-up succeeded but no user was returned." };

    // 2. Look for an existing staff-registered patient with this email or phone.
    //    If one exists, stamp auth_uid onto it so the portal can find their
    //    clinical records (vitals, consults, dispenses) via getPatientProfile().
    const orClauses: string[] = [`email.eq.${data.email.toLowerCase().trim()}`];
    if (data.phone) {
      const normPhone = normalizePhone(data.phone);
      if (normPhone) orClauses.push(`phone.eq.${normPhone}`);
    }

    const { data: existingPatient } = await supabase
      .from("patients")
      .select("id")
      .or(orClauses.join(","))
      .maybeSingle();

    if (existingPatient) {
      // Link the new auth user to the pre-existing clinic patient record.
      const { error: linkError } = await supabase
        .from("patients")
        .update({ auth_uid: authData.user.id })
        .eq("id", existingPatient.id);

      if (linkError) {
        return { message: `Account created but could not link to your clinic record: ${linkError.message}` };
      }
      return null;
    }

    // 3. No existing clinic record — create a fresh patient row for self-registered users.
    const { error: insertError } = await supabase.from("patients").insert({
      id:           crypto.randomUUID(),
      auth_uid:     authData.user.id,
      given_name:   data.givenName,
      family_name:  data.familyName,
      email:        data.email,
      phone:        data.phone ?? null,
      dob:          data.dob   ?? null,
      sex:          "other",
      address:      "",
      state:        "",
      lga:          "",
    });

    if (insertError) {
      return { message: `Account created but profile save failed: ${insertError.message}` };
    }

    return null;
  }, []);

  const logout = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    // Clear legacy localStorage keys from the old offline auth system
    localStorage.removeItem("patient_session_token");
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
