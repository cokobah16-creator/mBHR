import { useLocation, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useState, useEffect } from "react";
import { EmergencyHelp } from "./EmergencyHelp";
import { PortalSkeleton } from "@/components/ui/Skeleton";
import { useT } from "@/hooks/useT";
import { supabase } from "@/lib/supabase";
import { supabase as authClient } from "@/lib/supabaseClient";
import * as logger from "@/lib/logger";
import {
  logout as endLocalPortalSession,
  type ManagedPatient,
} from "@/services/patientPortalAuth";
import { clearApiCaches } from "@/services/clearApiCaches";
import {
  getPatientProfile,
  getPatientProfileByEmail,
} from "@/services/patientService";
import {
  ACTIVE_PROFILE_KEY,
  PORTAL_USER_KEY,
  SESSION_TOKEN_KEY,
  clearPortalSession,
  clearStoredSupabaseAuth,
  readActiveProfile,
  readPortalUser,
} from "./portalSession";
import { PortalHeader, type PortalProfileProps } from "./shell/PortalHeader";
import { PortalSideNavigation } from "./shell/PortalNavigation";
import { PortalMobileNavigation } from "./shell/PortalMobileNavigation";

interface PatientPortalLayoutProps {
  children: ReactNode;
}

const SIGN_OUT_TIMEOUT_MS = 5000;

function hasPortalPatient(): boolean {
  const user = readPortalUser();
  return !!(user && user.patientId && user.id);
}

/**
 * The patient portal shell: header, desktop sidebar, phone bottom bar and
 * "More" sheet around the page. It also restores the portal user copy after
 * a fresh sign-in and owns sign-out.
 */
export function PatientPortalLayout({ children }: PatientPortalLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useT();
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // portalUserReady gates child rendering until patient_portal_user is populated.
  // Without this gate, MedicalHistory/Messages read empty localStorage and hard-redirect to login.
  const [portalUserReady, setPortalUserReady] = useState(hasPortalPatient);

  useEffect(() => {
    if (portalUserReady) return;
    if (!supabase) {
      setPortalUserReady(true);
      return;
    }
    let cancelled = false;
    const client = supabase;

    const hydrate = async () => {
      try {
        const {
          data: { user },
        } = await client.auth.getUser();
        if (!user) return;

        // Try lookup by auth_uid first, then fall back to email for patients
        // whose records were created by staff (no auth_uid set yet).
        let profile = (await getPatientProfile(user.id)).data;
        if (!profile && user.email) {
          profile = (await getPatientProfileByEmail(user.id, user.email)).data;
        }

        if (profile && !cancelled) {
          const entry = {
            id: user.id,
            patientId: profile.id,
            givenName: profile.givenName,
            familyName: profile.familyName,
            email: user.email ?? profile.email ?? "",
            managedPatients: [],
          };
          localStorage.setItem(PORTAL_USER_KEY, JSON.stringify(entry));
        }
      } catch (err) {
        // Pages show their own "please sign in again" message when the
        // portal user is still missing; never leave the skeleton up forever.
        logger.warn(
          "[PatientPortalLayout] profile lookup failed:",
          err instanceof Error ? err.name : "unknown",
        );
      } finally {
        if (!cancelled) setPortalUserReady(true);
      }
    };

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [portalUserReady]);

  const portalUser = readPortalUser();
  const name = portalUser?.givenName || "Patient";
  const activeProfile = readActiveProfile();

  const handleLogout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const token = sessionStorage.getItem(SESSION_TOKEN_KEY);
      if (token) await endLocalPortalSession(token);
      // End this phone's online session too, so the next person on a shared
      // phone cannot reopen this patient's records. Do not wait forever
      // offline; "local" leaves the patient's other devices signed in.
      if (authClient) {
        await Promise.race([
          authClient.auth.signOut({ scope: "local" }),
          new Promise((resolve) => setTimeout(resolve, SIGN_OUT_TIMEOUT_MS)),
        ]);
      }
    } catch (err) {
      logger.warn(
        "[PatientPortalLayout] sign-out:",
        err instanceof Error ? err.name : "unknown",
      );
    } finally {
      clearPortalSession();
      // signOut() cannot finish offline and then keeps the stored sign-in:
      // remove it from this phone either way.
      if (authClient) clearStoredSupabaseAuth();
      void clearApiCaches();
      navigate("/patient");
    }
  };

  const switchProfile = (patient: ManagedPatient) => {
    try {
      localStorage.setItem(
        ACTIVE_PROFILE_KEY,
        JSON.stringify({
          patientId: patient.patientId,
          givenName: patient.givenName,
          familyName: patient.familyName,
        }),
      );
    } catch {
      return; // Storage blocked: stay on the current profile.
    }
    window.location.reload();
  };

  const switchToSelf = () => {
    try {
      localStorage.removeItem(ACTIVE_PROFILE_KEY);
    } catch {
      return;
    }
    window.location.reload();
  };

  const profile: PortalProfileProps = {
    name,
    displayName: activeProfile?.givenName || name,
    managedPatients: portalUser?.managedPatients ?? [],
    activePatientId: activeProfile?.patientId ?? null,
    onSelectSelf: switchToSelf,
    onSelectProfile: switchProfile,
  };

  return (
    <div className="min-h-screen bg-canvas">
      <a
        href="#portal-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-ink focus:shadow-lg"
      >
        {t("portal.nav.skipToContent")}
      </a>

      <PortalHeader
        profile={profile}
        pathname={location.pathname}
        signingOut={signingOut}
        onSignOut={handleLogout}
        onEmergency={() => setEmergencyOpen(true)}
      />

      <div className="mx-auto flex max-w-6xl">
        <PortalSideNavigation pathname={location.pathname} />

        <main
          id="portal-main"
          tabIndex={-1}
          className="min-w-0 flex-1 pb-24 focus:outline-none md:pb-10"
        >
          {portalUserReady ? children : <PortalSkeleton />}
        </main>
      </div>

      <PortalMobileNavigation
        pathname={location.pathname}
        profile={profile}
        signingOut={signingOut}
        onSignOut={handleLogout}
      />

      {emergencyOpen && <EmergencyHelp onClose={() => setEmergencyOpen(false)} />}
    </div>
  );
}
