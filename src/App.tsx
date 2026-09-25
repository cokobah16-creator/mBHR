import React from "react";
import { Suspense, lazy, useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Layout } from "@/components/Layout";
import RequireRoles from "@/components/RequireRoles";
import RequirePermission from "@/components/RequirePermission";
import Login from "@/pages/Login";
import FirstRunSetup from "@/pages/FirstRunSetup";
import { useAuthStore } from "@/stores/auth";
import { hasDevicePin } from "@/db/offlineAccess";
import { isStaffRole } from "@/auth/roles";
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";
import { Home } from "@/pages/Home";
import {
  startPortalSyncWorker,
  stopPortalSyncWorker,
} from "@/services/portalSyncWorker";
import { GlobalErrorBoundary } from "@/components/GlobalErrorBoundary";
import { supabase, isSupabaseEnabled } from "@/lib/supabaseClient";
import type { SupabaseClient, User as SupabaseUser } from "@supabase/supabase-js";
import { clearStoredSupabaseAuth } from "@/lib/supabaseAuthStorage";
import { fetchPortalAccessStatus } from "@/services/portalSignIn";
import type { PortalSignInCheck } from "@/services/portalAccessRules";
import { AuthCallback } from "@/components/AuthCallback";
import {
  PageSkeleton,
  PortalSkeleton,
  ScreenSkeleton,
} from "@/components/ui/Skeleton";

// Public legal pages
const PrivacyPolicy = lazy(() => import("@/pages/legal/PrivacyPolicy"));
const TermsOfUse = lazy(() => import("@/pages/legal/TermsOfUse"));

// Eager: the reset page must load before supabase-js strips the token from the
// URL, and services/passwordReset captures that URL when it is first imported.
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";

// Core pages - loaded eagerly for initial navigation
const Dashboard = lazy(() =>
  import("@/pages/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const Register = lazy(() =>
  import("@/pages/Register").then((m) => ({ default: m.Register })),
);
const Patients = lazy(() =>
  import("@/pages/Patients").then((m) => ({ default: m.Patients })),
);
const SimpleRegister = lazy(() =>
  import("@/pages/SimpleRegister").then((m) => ({ default: m.SimpleRegister })),
);

// Patient detail and workflow pages
const PatientDetail = lazy(() =>
  import("@/pages/PatientDetail").then((m) => ({ default: m.PatientDetail })),
);
const Queue = lazy(() =>
  import("@/pages/Queue").then((m) => ({ default: m.Queue })),
);
const Vitals = lazy(() =>
  import("@/pages/Vitals").then((m) => ({ default: m.Vitals })),
);
const Consult = lazy(() =>
  import("@/pages/Consult").then((m) => ({ default: m.Consult })),
);

// Pharmacy pages
const Pharmacy = lazy(() =>
  import("@/pages/Pharmacy").then((m) => ({ default: m.Pharmacy })),
);
const PharmacyMenu = lazy(() => import("@/pages/PharmacyMenu"));
const PharmacyReports = lazy(() => import("@/pages/PharmacyReports"));
const OutreachReports = lazy(() => import("@/pages/OutreachReports"));
const PharmacyStock = lazy(() => import("@/features/pharmacy/PharmacyStock"));
const RxForm = lazy(() => import("@/features/pharmacy/RxForm"));
const Dispense = lazy(() => import("@/features/pharmacy/Dispense"));
const SMSReminders = lazy(() => import("@/pages/SMSReminders"));

// Labs and appointments (Sprint 5 features)
const LabResultsDashboard = lazy(() =>
  import("@/features/labs/LabResultsDashboard").then((m) => ({
    default: m.LabResultsDashboard,
  })),
);
const AppointmentCalendar = lazy(() =>
  import("@/features/appointments/AppointmentCalendar").then((m) => ({
    default: m.AppointmentCalendar,
  })),
);
const TelevisitManager = lazy(() =>
  import("@/features/televisits/TelevisitManager").then((m) => ({
    default: m.TelevisitManager,
  })),
);

// Portal admin pages
const PortalDashboard = lazy(() =>
  import("@/pages/admin/PortalDashboard").then((m) => ({
    default: m.PortalDashboard,
  })),
);
const PortalMigration = lazy(() =>
  import("@/pages/admin/PortalMigration").then((m) => ({
    default: m.PortalMigration,
  })),
);
const BulkPortalMigration = lazy(() =>
  import("@/pages/admin/BulkPortalMigration").then((m) => ({
    default: m.BulkPortalMigration,
  })),
);
const EmailDiagnostics = lazy(() => import("@/pages/admin/EmailDiagnostics"));
const ConflictDashboard = lazy(() => import("@/pages/admin/ConflictDashboard"));
const AdminSettings = lazy(() => import("@/pages/admin/Settings"));
const AdminHome = lazy(() => import("@/pages/admin/AdminHome"));
const FhirExport = lazy(() => import("@/pages/admin/FhirExport"));

// Patient Portal components
const PatientPortalLanding = lazy(() =>
  import("@/features/patient-portal/PatientPortalLanding").then((m) => ({
    default: m.PatientPortalLanding,
  })),
);
const PatientLogin = lazy(() =>
  import("@/features/patient-portal/PatientLogin").then((m) => ({
    default: m.PatientLogin,
  })),
);
const PatientRegister = lazy(() =>
  import("@/features/patient-portal/PatientRegister").then((m) => ({
    default: m.PatientRegister,
  })),
);
const PatientPortalLayout = lazy(() =>
  import("@/features/patient-portal/PatientPortalLayout").then((m) => ({
    default: m.PatientPortalLayout,
  })),
);
const PatientDashboard = lazy(() =>
  import("@/features/patient-portal/PatientDashboard").then((m) => ({
    default: m.PatientDashboard,
  })),
);
const MedicalHistory = lazy(() =>
  import("@/features/patient-portal/MedicalHistory").then((m) => ({
    default: m.MedicalHistory,
  })),
);
const VisitDetail = lazy(() =>
  import("@/features/patient-portal/VisitDetail").then((m) => ({
    default: m.VisitDetail,
  })),
);
const AppointmentRequest = lazy(() =>
  import("@/features/patient-portal/AppointmentRequest").then((m) => ({
    default: m.AppointmentRequest,
  })),
);
const BillingPayments = lazy(() =>
  import("@/features/patient-portal/BillingPayments").then((m) => ({
    default: m.BillingPayments,
  })),
);
const PreVisitForms = lazy(() =>
  import("@/features/patient-portal/PreVisitForms").then((m) => ({
    default: m.PreVisitForms,
  })),
);
const PrescriptionRefills = lazy(() =>
  import("@/features/patient-portal/PrescriptionRefills").then((m) => ({
    default: m.PrescriptionRefills,
  })),
);
const Telehealth = lazy(() =>
  import("@/features/patient-portal/Telehealth").then((m) => ({
    default: m.Telehealth,
  })),
);
const UpdatePHR = lazy(() =>
  import("@/features/patient-portal/UpdatePHR").then((m) => ({
    default: m.UpdatePHR,
  })),
);
const SecureMessaging = lazy(() =>
  import("@/features/patient-portal/SecureMessaging").then((m) => ({
    default: m.SecureMessaging,
  })),
);
const ManageAccount = lazy(() =>
  import("@/features/patient-portal/ManageAccount").then((m) => ({
    default: m.ManageAccount,
  })),
);
const LabResults = lazy(() =>
  import("@/features/patient-portal/LabResults").then((m) => ({
    default: m.LabResults,
  })),
);
const MedicalConditions = lazy(() =>
  import("@/features/patient-portal/MedicalConditions").then((m) => ({
    default: m.MedicalConditions,
  })),
);
const DocumentUpload = lazy(() =>
  import("@/features/patient-portal/DocumentUpload").then((m) => ({
    default: m.DocumentUpload,
  })),
);
const Referrals = lazy(() =>
  import("@/features/patient-portal/Referrals").then((m) => ({
    default: m.Referrals,
  })),
);
const OutreachFinder = lazy(() =>
  import("@/features/patient-portal/OutreachFinder").then((m) => ({
    default: m.OutreachFinder,
  })),
);
const CaregiverSetup = lazy(() =>
  import("@/features/patient-portal/CaregiverSetup").then((m) => ({
    default: m.CaregiverSetup,
  })),
);
const HealthDataExport = lazy(() =>
  import("@/features/patient-portal/HealthDataExport").then((m) => ({
    default: m.HealthDataExport,
  })),
);
const DataSharingPreferences = lazy(() =>
  import("@/features/patient-portal/DataSharingPreferences").then((m) => ({
    default: m.DataSharingPreferences,
  })),
);

// Inventory and gamification
const Inventory = lazy(() =>
  import("@/pages/Inventory").then((m) => ({ default: m.Inventory })),
);
const RestockGame = lazy(() => import("@/features/inventory/RestockGame"));
const PrizeShop = lazy(() => import("@/features/inventory/PrizeShop"));

// Queue/ticket management
const QueueBoard = lazy(() => import("@/features/tickets/QueueBoard"));
const TicketIssuer = lazy(() => import("@/features/tickets/TicketIssuer"));
const PublicDisplay = lazy(() => import("@/features/tickets/PublicDisplay"));

// Gamification features
const GameHub = lazy(() =>
  import("@/components/GameHub").then((m) => ({ default: m.GameHub })),
);
const QuestBoard = lazy(() =>
  import("@/components/QuestBoard").then((m) => ({ default: m.QuestBoard })),
);
const Leaderboard = lazy(() => import("@/features/gamification/Leaderboard"));
const QueueMaestro = lazy(() => import("@/features/gamification/QueueMaestro"));
const KnowledgeBlitz = lazy(
  () => import("@/features/gamification/KnowledgeBlitz"),
);
const VitalsPrecisionGame = lazy(
  () => import("@/features/vitals/VitalsPrecisionGame"),
);
const ApprovalInbox = lazy(
  () => import("@/features/gamification/ApprovalInbox"),
);

// Triage features
const TriageSprint = lazy(() => import("@/features/triage/TriageSprint"));
const QuickTriage = lazy(() => import("@/features/triage/QuickTriage"));

// Analytics (admin only)
const AnalyticsDashboard = lazy(
  () => import("@/features/analytics/AnalyticsDashboard"),
);

// Admin
const Users = lazy(() =>
  import("@/pages/Users").then((m) => ({ default: m.Users })),
);

// Staff patient records (Supabase-backed)
const StaffPatientDashboard = lazy(() =>
  import("@/pages/staff/StaffPatientDashboard").then((m) => ({
    default: m.StaffPatientDashboard,
  })),
);

// Doctor features
const DoctorDashboard = lazy(() =>
  import("@/pages/DoctorDashboard").then((m) => ({
    default: m.DoctorDashboard,
  })),
);

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, currentUser, logout } = useAuthStore();
  // A session for an account without a staff role (for example one kept
  // from an older version of the app) never opens the staff workspace.
  const notStaff = isAuthenticated && !!currentUser && !isStaffRole(currentUser.role);

  useEffect(() => {
    if (notStaff) void logout();
  }, [notStaff, logout]);

  if (!isAuthenticated || notStaff) {
    return <Navigate to="/" replace />;
  }

  // Signed in online but no PIN on this device yet: enrollment comes first
  // (the login page shows it), so the device always works offline for
  // whoever is using it.
  if (currentUser && !hasDevicePin(currentUser)) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function HealthDataExportWrapper() {
  const portalUserStr = localStorage.getItem("patient_portal_user");
  const portalUser = portalUserStr ? JSON.parse(portalUserStr) : null;
  const patientId = portalUser?.patientId || "";
  return <HealthDataExport patientId={patientId} />;
}

function DataSharingWrapper() {
  const portalUserStr = localStorage.getItem("patient_portal_user");
  const portalUser = portalUserStr ? JSON.parse(portalUserStr) : null;
  const patientId = portalUser?.patientId || "";
  return <DataSharingPreferences patientId={patientId} />;
}

/** How long a restored portal sign-in waits for the server's access check. */
const PORTAL_ACCESS_CHECK_TIMEOUT_MS = 8000;

/** The server's portal access answer, or "unavailable" when it is slow. */
async function portalAccessWithin(
  client: SupabaseClient,
  ms: number,
): Promise<PortalSignInCheck> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<PortalSignInCheck>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "unavailable" }), ms);
  });
  try {
    return await Promise.race([fetchPortalAccessStatus(client), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Staff and the patient portal share one Supabase sign-in in this browser.
 * True when the restored sign-in is the staff member signed in on this
 * device, whose online sign-in (and sync) must not be ended by the portal.
 */
function isSignedInStaff(user: Pick<SupabaseUser, "id" | "email">): boolean {
  const { isAuthenticated, currentUser } = useAuthStore.getState();
  if (!isAuthenticated || !currentUser) return false;
  if (currentUser.id === user.id) return true;
  const staffEmail = currentUser.email?.trim().toLowerCase();
  return !!staffEmail && staffEmail === user.email?.trim().toLowerCase();
}

/**
 * Forget the portal patient kept in this browser (the same keys the portal's
 * log out clears). Storage may be blocked: nothing to clear then.
 */
function clearStoredPortalUser(): void {
  try {
    localStorage.removeItem("patient_portal_user");
    localStorage.removeItem("patient_active_profile");
    sessionStorage.removeItem("patient_session_token");
  } catch {
    // Storage blocked.
  }
}

function PatientProtectedRoute({ children }: { children: React.ReactNode }) {
  const [isValidating, setIsValidating] = React.useState(true);
  const [isValid, setIsValid] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;

    const validateSession = async () => {
      // 1. If Supabase is configured, trust the Supabase session first
      if (isSupabaseEnabled && supabase) {
        const client = supabase;
        const { data } = await client.auth.getSession();
        if (!mounted) return;
        if (data.session) {
          // Portal access is the server's decision. A sign-in restored from
          // this browser is checked again when the device is online. Offline,
          // or when the server cannot be reached, the portal keeps working
          // from this device's copy (the server's RLS still guards its data).
          const online =
            typeof navigator === "undefined" || navigator.onLine !== false;
          if (online) {
            const access = await portalAccessWithin(
              client,
              PORTAL_ACCESS_CHECK_TIMEOUT_MS,
            );
            if (!mounted) return;
            if (access.kind === "not_enabled" || access.kind === "not_linked") {
              // The server answered that access is off (or there is no clinic
              // record): end this portal sign-in on the device, as a refused
              // sign-in does, and go back to the login page.
              if (!isSignedInStaff(data.session.user)) {
                await client.auth.signOut().catch(() => undefined);
                clearStoredSupabaseAuth();
              }
              clearStoredPortalUser();
              if (!mounted) return;
              setIsValid(false);
              setIsValidating(false);
              return;
            }
          }
          setIsValid(true);
          setIsValidating(false);
          return;
        }
        // No Supabase session — redirect to login
        setIsValid(false);
        setIsValidating(false);
        return;
      }

      // 2. Offline fallback: validate session token (stored in sessionStorage for XSS safety)
      const sessionToken = sessionStorage.getItem("patient_session_token");
      const portalUser = localStorage.getItem("patient_portal_user");

      if (!sessionToken || !portalUser) {
        if (!mounted) return;
        setIsValid(false);
        setIsValidating(false);
        return;
      }

      try {
        const { validateAndRefreshPatientSession } =
          await import("@/utils/sessionManager");

        const result = await validateAndRefreshPatientSession(sessionToken);
        if (!mounted) return;

        if (!result.valid) {
          sessionStorage.removeItem("patient_session_token");
          localStorage.removeItem("patient_portal_user");
          setIsValid(false);
          setIsValidating(false);
          return;
        }

        setIsValid(true);
        setIsValidating(false);
      } catch (err) {
        // Error name only: messages can carry patient data.
        console.error(
          "[PatientProtectedRoute] Exception during validation:",
          err instanceof Error ? err.name : "unknown",
        );
        if (!mounted) return;
        sessionStorage.removeItem("patient_session_token");
        localStorage.removeItem("patient_portal_user");
        setIsValid(false);
        setIsValidating(false);
      }
    };

    validateSession();
    return () => {
      mounted = false;
    };
  }, []);

  if (isValidating) {
    return (
      <ScreenSkeleton label="Checking your sign-in" />
    );
  }

  if (!isValid) {
    return <Navigate to="/patient/login" replace />;
  }

  return <>{children}</>;
}

function App() {
  useEffect(() => {
    // Start background portal sync worker
    startPortalSyncWorker();
    return () => stopPortalSyncWorker();
  }, []);

  return (
    <GlobalErrorBoundary>
      <ErrorBoundary>
        <PWAInstallPrompt />
        <Routes>
          {/* Public Routes - Must be defined before catch-all */}
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/privacy"
            element={
              <Suspense fallback={<ScreenSkeleton />}>
                <PrivacyPolicy />
              </Suspense>
            }
          />
          <Route
            path="/terms"
            element={
              <Suspense fallback={<ScreenSkeleton />}>
                <TermsOfUse />
              </Suspense>
            }
          />

          {/* First-run administrator setup. Eagerly imported: a freshly
              installed device may be offline, and this is the only route that
              can produce a usable PIN. Self-guards once any user exists. */}
          <Route path="/setup" element={<FirstRunSetup />} />

          {/* Supabase auth email-confirmation redirect */}
          <Route path="/auth/callback" element={<AuthCallback />} />

          {/* Password recovery (Supabase accounts: online staff + patient portal) */}
          <Route
            path="/forgot-password"
            element={<ForgotPassword audience="staff" />}
          />
          <Route path="/reset-password" element={<ResetPassword />} />

          {/* Patient Portal Routes */}
          <Route path="/patient" element={<PatientPortalLanding />} />
          <Route path="/patient/login" element={<PatientLogin />} />
          <Route path="/patient/register" element={<PatientRegister />} />
          <Route
            path="/patient/forgot-password"
            element={<ForgotPassword audience="patient" />}
          />
          <Route
            path="/patient/*"
            element={
              <PatientProtectedRoute>
                <Suspense fallback={<PortalSkeleton />}>
                  <PatientPortalLayout>
                    <Suspense fallback={<PortalSkeleton />}>
                    <Routes>
                      <Route path="/dashboard" element={<PatientDashboard />} />
                      <Route
                        path="/medical-history"
                        element={<MedicalHistory />}
                      />
                      <Route path="/visit/:visitId" element={<VisitDetail />} />
                      <Route
                        path="/appointments"
                        element={<AppointmentRequest />}
                      />
                      <Route
                        path="/appointments/request"
                        element={<AppointmentRequest />}
                      />
                      <Route path="/billing" element={<BillingPayments />} />
                      <Route path="/forms" element={<PreVisitForms />} />
                      <Route
                        path="/prescriptions"
                        element={<PrescriptionRefills />}
                      />
                      <Route path="/telehealth" element={<Telehealth />} />
                      <Route path="/update-phr" element={<UpdatePHR />} />
                      <Route path="/messages" element={<SecureMessaging />} />
                      <Route path="/account" element={<ManageAccount />} />
                      <Route path="/lab-results" element={<LabResults />} />
                      <Route
                        path="/conditions"
                        element={<MedicalConditions />}
                      />
                      <Route path="/documents" element={<DocumentUpload />} />
                      <Route path="/referrals" element={<Referrals />} />
                      <Route
                        path="/export"
                        element={<HealthDataExportWrapper />}
                      />
                      <Route
                        path="/data-sharing"
                        element={<DataSharingWrapper />}
                      />
                      <Route path="/outreach" element={<OutreachFinder />} />
                      <Route
                        path="/caregiver/add"
                        element={<CaregiverSetup />}
                      />
                      <Route
                        path="/"
                        element={<Navigate to="/patient/dashboard" replace />}
                      />
                    </Routes>
                    </Suspense>
                  </PatientPortalLayout>
                </Suspense>
              </PatientProtectedRoute>
            }
          />

          {/* Waiting-room display: full screen, outside the staff shell, but
              still behind staff sign-in. Shows ticket numbers only. */}
          <Route
            path="/display"
            element={
              <ProtectedRoute>
                <Suspense fallback={<ScreenSkeleton label="Loading display" />}>
                  <PublicDisplay />
                </Suspense>
              </ProtectedRoute>
            }
          />

          {/* Staff Routes - catch-all for authenticated routes */}
          <Route
            path="*"
            element={
              <ProtectedRoute>
                <Layout>
                  {/* Suspense sits inside the shell so the header, site
                      context and navigation stay put while a page loads. */}
                  <Suspense fallback={<PageSkeleton />}>
                    <Routes>
                      <Route path="/dashboard" element={<Dashboard />} />
                      <Route
                        path="/staff/patients"
                        element={
                          <RequireRoles
                            roles={["doctor", "nurse", "admin", "volunteer", "registration_lead"]}
                          >
                            <StaffPatientDashboard />
                          </RequireRoles>
                        }
                      />
                      <Route
                        path="/doctor/dashboard"
                        element={
                          <RequireRoles roles={["doctor", "admin"]}>
                            <DoctorDashboard />
                          </RequireRoles>
                        }
                      />
                      <Route
                        path="/register"
                        element={
                          <RequirePermission permission="register">
                            <Register />
                          </RequirePermission>
                        }
                      />
                      <Route path="/patients" element={<Patients />} />
                      <Route path="/patients/:id" element={<PatientDetail />} />
                      <Route path="/queue" element={<Queue />} />
                      <Route path="/inventory" element={<Inventory />} />
                      <Route path="/users" element={<Users />} />
                      <Route
                        path="/vitals"
                        element={
                          <RequirePermission permission="vitals">
                            <Vitals />
                          </RequirePermission>
                        }
                      />
                      <Route
                        path="/vitals/:visitId"
                        element={
                          <RequirePermission permission="vitals">
                            <Vitals />
                          </RequirePermission>
                        }
                      />
                      <Route
                        path="/consult"
                        element={
                          <RequirePermission permission="consult">
                            <Consult />
                          </RequirePermission>
                        }
                      />
                      <Route
                        path="/consult/:visitId"
                        element={
                          <RequirePermission permission="consult">
                            <Consult />
                          </RequirePermission>
                        }
                      />
                      <Route
                        path="/pharmacy"
                        element={
                          <RequirePermission permission="dispense">
                            <Pharmacy />
                          </RequirePermission>
                        }
                      />
                      <Route
                        path="/pharmacy/:visitId"
                        element={
                          <RequirePermission permission="dispense">
                            <Pharmacy />
                          </RequirePermission>
                        }
                      />

                      {/* New MBHR Features */}
                      <Route
                        path="/inv/game"
                        element={
                          <RequirePermission permission="inventory">
                            <RestockGame />
                          </RequirePermission>
                        }
                      />
                      <Route
                        path="/inv/prizes"
                        element={
                          <RequireRoles roles={["volunteer", "registration_lead", "nurse", "pharmacist", "admin"]}>
                            <PrizeShop />
                          </RequireRoles>
                        }
                      />
                      <Route
                        path="/rx/stock"
                        element={
                          <RequireRoles roles={["pharmacist", "admin"]}>
                            <PharmacyStock />
                          </RequireRoles>
                        }
                      />
                      <Route
                        path="/rx/new"
                        element={
                          <RequireRoles roles={["doctor", "nurse", "admin"]}>
                            <RxForm />
                          </RequireRoles>
                        }
                      />
                      <Route
                        path="/rx/dispense"
                        element={
                          <RequireRoles roles={["pharmacist", "admin"]}>
                            <Dispense />
                          </RequireRoles>
                        }
                      />
                      <Route
                        path="/tickets/queue"
                        element={
                          <RequireRoles roles={["nurse", "doctor", "admin"]}>
                            <QueueBoard />
                          </RequireRoles>
                        }
                      />
                      <Route
                        path="/tickets/issue"
                        element={
                          <RequireRoles
                            roles={["volunteer", "registration_lead", "nurse", "doctor", "admin"]}
                          >
                            <TicketIssuer />
                          </RequireRoles>
                        }
                      />
                      <Route
                        path="/inv/leaderboard"
                        element={
                          <RequireRoles roles={["volunteer", "registration_lead", "nurse", "pharmacist", "admin"]}>
                            <Leaderboard />
                          </RequireRoles>
                        }
                      />
                      <Route path="/quests" element={<QuestBoard />} />
                      <Route
                        path="/games/queue-maestro"
                        element={
                          <RequireRoles roles={["volunteer", "registration_lead", "nurse", "admin"]}>
                            <QueueMaestro />
                          </RequireRoles>
                        }
                      />
                      <Route path="/games" element={<GameHub />} />
                      <Route
                        path="/games/vitals-precision"
                        element={
                          <RequireRoles roles={["volunteer", "registration_lead", "nurse", "admin"]}>
                            <VitalsPrecisionGame />
                          </RequireRoles>
                        }
                      />
                      <Route
                        path="/games/knowledge-blitz"
                        element={
                          <RequireRoles roles={["volunteer", "registration_lead", "nurse", "admin"]}>
                            <KnowledgeBlitz />
                          </RequireRoles>
                        }
                      />
                      <Route
                        path="/games/triage-sprint"
                        element={
                          <RequireRoles roles={["nurse", "doctor", "admin"]}>
                            <TriageSprint />
                          </RequireRoles>
                        }
                      />
                      <Route
                        path="/games/vitals-precision-enhanced"
                        element={<Navigate to="/games/vitals-precision" replace />}
                      />
                      <Route
                        path="/analytics"
                        element={
                          <RequireRoles roles={["admin"]}>
                            <AnalyticsDashboard />
                          </RequireRoles>
                        }
                      />
                      <Route path="/admin" element={<AdminHome />} />
                      <Route
                        path="/admin/fhir-export"
                        element={
                          <RequirePermission permission="export">
                            <FhirExport />
                          </RequirePermission>
                        }
                      />
                      <Route
                        path="/admin/approvals"
                        element={
                          <RequireRoles roles={["admin"]}>
                            <ApprovalInbox />
                          </RequireRoles>
                        }
                      />
                      <Route
                        path="/admin/portal-dashboard"
                        element={
                          <RequireRoles roles={["admin"]}>
                            <PortalDashboard />
                          </RequireRoles>
                        }
                      />
                      <Route
                        path="/admin/portal-migration"
                        element={
                          <RequireRoles roles={["admin"]}>
                            <PortalMigration />
                          </RequireRoles>
                        }
                      />
                      <Route
                        path="/admin/bulk-portal-migration"
                        element={
                          <RequireRoles roles={["admin"]}>
                            <BulkPortalMigration />
                          </RequireRoles>
                        }
                      />
                      <Route
                        path="/admin/email-diagnostics"
                        element={
                          <RequireRoles roles={["admin"]}>
                            <EmailDiagnostics />
                          </RequireRoles>
                        }
                      />
                      <Route
                        path="/admin/conflicts"
                        element={
                          <RequireRoles
                            roles={["admin", "doctor", "nurse", "lead_clinician", "auditor"]}
                          >
                            <ConflictDashboard />
                          </RequireRoles>
                        }
                      />
                      <Route
                        path="/admin/settings"
                        element={
                          <RequireRoles roles={["admin"]}>
                            <AdminSettings />
                          </RequireRoles>
                        }
                      />
                      <Route
                        path="/simple/register"
                        element={
                          <RequirePermission permission="register">
                            <SimpleRegister />
                          </RequirePermission>
                        }
                      />
                      {/* "/pharmacy" is the visit dispensing screen (above); the
                          task menu has its own path so it is reachable. */}
                      <Route path="/pharmacy/menu" element={<PharmacyMenu />} />
                      <Route
                        path="/pharmacy/reports"
                        element={
                          <RequireRoles roles={["pharmacist", "admin"]}>
                            <PharmacyReports />
                          </RequireRoles>
                        }
                      />
                      <Route
                        path="/pharmacy/sms-reminders"
                        element={
                          <RequireRoles roles={["pharmacist", "admin"]}>
                            <SMSReminders />
                          </RequireRoles>
                        }
                      />
                      <Route
                        path="/reports/outreach"
                        element={
                          <RequireRoles roles={["admin", "doctor", "nurse"]}>
                            <OutreachReports />
                          </RequireRoles>
                        }
                      />
                      <Route
                        path="/labs"
                        element={
                          /* Matches the server's lab_orders/lab_results policies
                             (doctor, nurse, admin); widen both together.
                             Patients never read lab_results directly: a result
                             reaches the portal only through portal_my_lab_results
                             after it is reviewed and released (migration
                             20260925100500). */
                          <RequireRoles roles={["doctor", "nurse", "admin"]}>
                            <LabResultsDashboard />
                          </RequireRoles>
                        }
                      />
                      <Route
                        path="/appointments"
                        element={
                          <RequireRoles
                            roles={["doctor", "nurse", "volunteer", "registration_lead", "admin"]}
                          >
                            <AppointmentCalendar createdBy="" />
                          </RequireRoles>
                        }
                      />
                      <Route
                        path="/televisits"
                        element={
                          <RequireRoles roles={["doctor", "nurse", "admin"]}>
                            <TelevisitManager />
                          </RequireRoles>
                        }
                      />
                      <Route
                        path="/triage/quick"
                        element={
                          <RequireRoles roles={["nurse", "doctor", "admin"]}>
                            <QuickTriage onComplete={() => {}} />
                          </RequireRoles>
                        }
                      />
                    </Routes>
                  </Suspense>
                </Layout>
              </ProtectedRoute>
            }
          />
        </Routes>
      </ErrorBoundary>
    </GlobalErrorBoundary>
  );
}

export default App;
