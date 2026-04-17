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

    // 1. Create the auth user
    const { data: authData, error: signUpError } = await supabase.auth.signUp({
      email:    data.email,
      password: data.password,
      options: {
        // Pre-populate display name in auth metadata
        data: { full_name: `${data.givenName} ${data.familyName}`.trim() },
      },
    });

    if (signUpError) return { message: signUpError.message };
    if (!authData.user) return { message: "Sign-up succeeded but no user was returned." };

    // 2. Insert into the existing `patients` table
    //    Matches columns from migrations/20250930025202_young_hat.sql +
    //    20251029000000_add_patient_email_auth_fields.sql
    const patientId = crypto.randomUUID();
    const { error: insertError } = await supabase.from("patients").insert({
      id:           patientId,
      auth_uid:     authData.user.id,   // UUID stored as text (existing schema pattern)
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
      // Auth user was created but patient insert failed.
      // Surface the error — user can still log in and the profile will be missing.
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
