import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { HeartIcon } from "@heroicons/react/24/outline";
import { useAuth } from "@/hooks/useAuth";
import { PortalHome, type NextAppointment } from "./PortalHome";
import { PortalSkeleton } from "@/components/ui/Skeleton";
import { getPatientAppointments } from "@/services/appointments";
import { useT } from "@/hooks/useT";
import {
  getPatientProfile,
  getPatientProfileByEmail,
  getVitals,
  getMedications,
  getVisits,
} from "@/services/patientService";
import type {
  PatientProfile,
  Vital,
  Medication,
  Visit,
} from "@/services/patientService";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
// Legacy offline dashboard
import { getPatientDashboard } from "@/services/patientPortalData";
import type { PatientDashboardData } from "@/types/patientPortal";
import * as logger from "@/lib/logger";

// ─── Types ────────────────────────────────────────────────────────────────────

type VitalStatus = "normal" | "monitor" | "attention";

function bpStatus(systolic: number): VitalStatus {
  if (systolic < 120) return "normal";
  if (systolic < 140) return "monitor";
  return "attention";
}

function tempStatus(temp: number): VitalStatus {
  if (temp >= 36.1 && temp <= 37.2) return "normal";
  if (temp <= 38.0) return "monitor";
  return "attention";
}

const statusColors: Record<VitalStatus, string> = {
  normal: "bg-green-100 text-green-800",
  monitor: "bg-yellow-100 text-yellow-800",
  attention: "bg-red-100 text-red-800",
};
const statusDot: Record<VitalStatus, string> = {
  normal: "bg-green-500",
  monitor: "bg-yellow-500",
  attention: "bg-red-500",
};
const statusLabelKey: Record<VitalStatus, string> = {
  normal: "portal.vital.status.normal",
  monitor: "portal.vital.status.monitor",
  attention: "portal.vital.status.attention",
};

function VitalCard({
  label,
  value,
  unit,
  status,
}: {
  label: string;
  value: string;
  unit: string;
  status: VitalStatus;
}) {
  const { t } = useT();
  return (
    <div className="bg-gray-50 rounded-lg p-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm text-gray-600">{label}</p>
        <span
          className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[status]}`}
        >
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${statusDot[status]}`}
          />
          {t(statusLabelKey[status])}
        </span>
      </div>
      <p className="text-h2 text-ink">{value}</p>
      <p className="text-xs text-gray-500">{unit}</p>
    </div>
  );
}

// ─── Online (Supabase) dashboard ──────────────────────────────────────────────

interface SupabaseDashboardState {
  profile: PatientProfile | null;
  vitals: Vital[];
  medications: Medication[];
  visits: Visit[];
}

function SupabaseDashboard() {
  const { user } = useAuth();
  const { t } = useT();
  const [state, setState] = useState<SupabaseDashboardState>({
    profile: null,
    vitals: [],
    medications: [],
    visits: [],
  });
  const [nextAppointment, setNextAppointment] = useState<NextAppointment | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    setError("");
    try {
      // Load profile first so we have the patientId for subsequent queries
      let profileRes = await getPatientProfile(user.id);
      // Fallback: look up by email and auto-link auth_uid when lookup by uid fails
      if ((profileRes.error || !profileRes.data) && user.email) {
        profileRes = await getPatientProfileByEmail(user.id, user.email);
      }
      if (profileRes.error || !profileRes.data) {
        setError(t("portal.error.loadProfile"));
        setLoading(false);
        return;
      }

      const patientId = profileRes.data.id;
      const [vitalsResult, medsResult, visitsResult] = await Promise.all([
        getVitals(patientId),
        getMedications(patientId),
        getVisits(patientId),
      ]);

      // Best effort: the home screen still works if appointments fail to load.
      getPatientAppointments(patientId)
        .then((appts) => {
          const now = Date.now();
          const next = appts
            .filter(
              (a) =>
                (a.status === "scheduled" || a.status === "confirmed") &&
                new Date(a.scheduledAt).getTime() >= now,
            )
            .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];
          setNextAppointment(
            next
              ? {
                  scheduledAt: new Date(next.scheduledAt),
                  type: next.appointmentType,
                  televisit: next.visitMode === "televisit",
                  meetingLink: next.meetingLink,
                }
              : null,
          );
        })
        .catch(() => setNextAppointment(undefined));

      setState({
        profile: profileRes.data,
        vitals: vitalsResult.data ?? [],
        medications: medsResult.data ?? [],
        visits: visitsResult.data ?? [],
      });
    } catch (err) {
      logger.error("[PatientDashboard] load error:", err);
      setError(t("portal.error.loadInfo"));
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <Spinner />;
  if (error) return <ErrorCard message={error} />;

  const { profile, vitals, medications, visits } = state;
  if (!profile) return null;

  const latest = vitals[0] ?? null;
  const bpSys = latest?.systolic ?? 0;
  const bpDia = latest?.diastolic ?? 0;

  return (
    <div>
      <PortalHome name={profile.givenName} nextAppointment={nextAppointment} />
      <div className="mx-auto max-w-3xl space-y-5 px-4 pb-8">
      {/* Vitals */}
      {latest && (
        <div className="panel p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-h2 text-ink">
              {t("portal.section.latestVitals")}
            </h2>
            <Link
              to="/patient/medical-history"
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              {t("portal.viewHistory")} →
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {bpSys > 0 && bpDia > 0 && (
              <VitalCard
                label={t("portal.vital.bloodPressure")}
                value={`${bpSys}/${bpDia}`}
                unit={t("portal.vital.unit.mmHg")}
                status={bpStatus(bpSys)}
              />
            )}
            {latest.weightKg != null && (
              <VitalCard
                label={t("portal.vital.weight")}
                value={`${latest.weightKg}`}
                unit={t("portal.vital.unit.kg")}
                status="normal"
              />
            )}
            {latest.tempC != null && (
              <VitalCard
                label={t("portal.vital.temperature")}
                value={`${latest.tempC}°C`}
                unit={t("portal.vital.unit.celsius")}
                status={tempStatus(latest.tempC)}
              />
            )}
          </div>
          <p className="text-xs text-gray-500 mt-4">
            {t("portal.recorded")}:{" "}
            {new Date(latest.takenAt).toLocaleDateString()}
          </p>
        </div>
      )}

      {/* Medications */}
      <div className="panel p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-h2 text-ink">
            {t("portal.section.activeMedications")}
          </h2>
          <Link
            to="/patient/prescriptions"
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            {t("portal.viewAll")} →
          </Link>
        </div>
        {medications.length > 0 ? (
          <div className="space-y-3">
            {medications.slice(0, 3).map((med) => (
              <div
                key={med.id}
                className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg"
              >
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <HeartIcon className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">{med.itemName}</p>
                  <p className="text-sm text-gray-600">{med.dosage}</p>
                  <p className="text-xs text-gray-500">{med.directions}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-center py-8">
            {t("portal.noMedications")}
          </p>
        )}
      </div>

      {/* Recent Visits */}
      {visits.length > 0 && (
        <div className="panel p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-h2 text-ink">
              {t("portal.section.recentVisits")}
            </h2>
            <Link
              to="/patient/medical-history"
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              {t("portal.viewAll")} →
            </Link>
          </div>
          <div className="space-y-3">
            {visits.slice(0, 3).map((v) => (
              <div key={v.id} className="p-3 bg-gray-50 rounded-lg">
                <p className="text-sm font-medium text-gray-900">
                  {new Date(v.startedAt).toLocaleDateString()}
                </p>
                {v.diagnosis && (
                  <p className="text-xs text-gray-600 mt-1">
                    {t("portal.diagnosis")}: {v.diagnosis}
                  </p>
                )}
                {v.notes && (
                  <p className="text-xs text-gray-500 mt-0.5">{v.notes}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      </div>
    </div>
  );
}

// ─── Offline (legacy) dashboard ───────────────────────────────────────────────

function OfflineDashboard() {
  const navigate = useNavigate();
  const { t } = useT();
  const [data, setData] = useState<PatientDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const portalUserStr = localStorage.getItem("patient_portal_user");
      if (!portalUserStr) {
        navigate("/patient/login", { replace: true });
        return;
      }
      const portalUser = JSON.parse(portalUserStr);
      if (!portalUser.patientId || !portalUser.id) {
        localStorage.removeItem("patient_portal_user");
        sessionStorage.removeItem("patient_session_token");
        navigate("/patient/login", { replace: true });
        return;
      }
      const activeProfileStr = localStorage.getItem("patient_active_profile");
      const rawActivePatientId = activeProfileStr
        ? JSON.parse(activeProfileStr).patientId
        : portalUser.patientId;

      // Validate that the requested patient is owned by this portal user (IDOR guard)
      const ownedPatientIds: string[] = [
        portalUser.patientId,
        ...(portalUser.managedPatients || []).map(
          (m: { patientId: string }) => m.patientId,
        ),
      ];
      const activePatientId = ownedPatientIds.includes(rawActivePatientId)
        ? rawActivePatientId
        : portalUser.patientId;

      const dashboardData = await getPatientDashboard(
        portalUser.id,
        activePatientId,
      );
      if (dashboardData) {
        setData(dashboardData);
      } else {
        setError(t("portal.error.loadDashboard"));
      }
    } catch (err) {
      logger.error("[PatientDashboard offline] load error:", err);
      setError(t("portal.error.loadInfo"));
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <Spinner />;
  if (error) return <ErrorCard message={error} />;
  if (!data) return null;

  const { patient, upcomingAppointments, recentVitals, activeMedications } =
    data;

  const next = [...upcomingAppointments]
    .filter((a) => new Date(a.scheduledAt).getTime() >= Date.now())
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0];

  return (
    <div>
      <PortalHome
        name={patient.givenName}
        nextAppointment={next ? { scheduledAt: new Date(next.scheduledAt), type: next.appointmentType } : null}
        unreadMessages={data.unreadMessages}
      />
      <div className="mx-auto max-w-3xl space-y-5 px-4 pb-8">
        <p className="banner banner-warning text-caption" role="status">
          {t("portal.offlineMode")}
        </p>
      {/* Vitals */}
      {recentVitals && (
        <div className="panel p-5">
          <h2 className="text-h2 text-ink mb-4">
            {t("portal.section.recentVitals")}
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {recentVitals.systolic && recentVitals.diastolic && (
              <VitalCard
                label={t("portal.vital.bloodPressure")}
                value={`${recentVitals.systolic}/${recentVitals.diastolic}`}
                unit={t("portal.vital.unit.mmHg")}
                status={bpStatus(recentVitals.systolic)}
              />
            )}
            {recentVitals.tempC && (
              <VitalCard
                label={t("portal.vital.temperature")}
                value={`${recentVitals.tempC}°C`}
                unit={t("portal.vital.unit.celsius")}
                status={tempStatus(recentVitals.tempC)}
              />
            )}
          </div>
        </div>
      )}

      {/* Medications */}
      {activeMedications.length > 0 && (
        <div className="panel p-5">
          <h2 className="text-h2 text-ink mb-4">
            {t("portal.section.activeMedications")}
          </h2>
          <div className="space-y-3">
            {activeMedications.slice(0, 3).map((med, i) => (
              <div
                key={i}
                className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg"
              >
                <HeartIcon className="w-5 h-5 text-blue-600 mt-0.5" />
                <div>
                  <p className="font-medium text-gray-900">
                    {med.medicationName}
                  </p>
                  <p className="text-sm text-gray-600">{med.dosage}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      </div>
    </div>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function Spinner() {
  return <PortalSkeleton />;
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="banner banner-danger" role="alert">
        <p>{message}</p>
      </div>
    </div>
  );
}

// ─── Root export ──────────────────────────────────────────────────────────────

export function PatientDashboard() {
  const { user, loading } = useAuth();

  if (loading) return <Spinner />;

  // Use Supabase-backed dashboard when available and user is signed in
  if (isSupabaseEnabled && user) return <SupabaseDashboard />;

  // Fall back to legacy offline dashboard
  return <OfflineDashboard />;
}
