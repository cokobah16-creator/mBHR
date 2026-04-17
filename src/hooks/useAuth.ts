/**
 * useAuth – Supabase auth hook for the patient portal.
 *
 * Exposes login, signup, logout, and the current Supabase user/session.
 * Falls back gracefully when Supabase is not configured.
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
  fullName: string;
  phone?: string;
  dateOfBirth?: string;
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
  const [user, setUser]       = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    // Populate from existing session immediately
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
    if (!supabase) return { message: "Supabase is not configured. Running in offline mode." };

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { message: error.message };
    return null;
  }, []);

  const signup = useCallback(async (data: SignUpData): Promise<AuthError | null> => {
    if (!supabase) return { message: "Supabase is not configured. Running in offline mode." };

    const { data: authData, error: signUpError } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
    });

    if (signUpError) return { message: signUpError.message };
    if (!authData.user) return { message: "Signup succeeded but no user returned." };

    // Insert the patient profile row linked to the new auth user
    const { error: insertError } = await supabase.from("patients").insert({
      auth_user_id:   authData.user.id,
      full_name:      data.fullName,
      email:          data.email,
      phone:          data.phone ?? null,
      date_of_birth:  data.dateOfBirth ?? null,
    });

    if (insertError) return { message: insertError.message };
    return null;
  }, []);

  const logout = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    // Also clear legacy localStorage keys left by the old offline auth
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
