import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  CalendarIcon,
  HeartIcon,
  BeakerIcon,
  EnvelopeIcon,
  BellIcon,
  ClipboardDocumentListIcon,
  PlusIcon,
  ArrowDownTrayIcon,
  ShieldCheckIcon,
  ChatBubbleLeftRightIcon,
  InformationCircleIcon,
  MapPinIcon,
  WifiIcon,
} from "@heroicons/react/24/outline";
import { useAuth } from "@/hooks/useAuth";
import {
  getPatientProfile,
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
const statusLabel: Record<VitalStatus, string> = {
  normal: "Normal",
  monitor: "Monitor",
  attention: "Attention",
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
          {statusLabel[status]}
        </span>
      </div>
      <p className="text-xl font-bold text-gray-900">{value}</p>
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
  const [state, setState] = useState<SupabaseDashboardState>({
    profile: null,
    vitals: [],
    medications: [],
    visits: [],
  });
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
      const profileRes = await getPatientProfile(user.id);
      if (profileRes.error || !profileRes.data) {
        setError(
          "Could not load your profile. Make sure your account is set up.",
        );
        setLoading(false);
        return;
      }

      const patientId = profileRes.data.id;
      const [vitalsResult, medsResult, visitsResult] = await Promise.all([
        getVitals(patientId),
        getMedications(patientId),
        getVisits(patientId),
      ]);

      setState({
        profile: profileRes.data,
        vitals: vitalsResult.data ?? [],
        medications: medsResult.data ?? [],
        visits: visitsResult.data ?? [],
      });
    } catch (err) {
      logger.error("[PatientDashboard] load error:", err);
      setError("An error occurred loading your information.");
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
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      {/* Welcome */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Welcome back, {profile.givenName}!
            </h1>
            <p className="text-gray-600 mt-1">
              Here's an overview of your health information.
            </p>
          </div>
          <span className="flex items-center gap-2 text-sm text-green-600">
            <WifiIcon className="w-4 h-4" />
            Connected · data saved
          </span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatTile
          icon={<CalendarIcon className="w-6 h-6 text-blue-600" />}
          bg="bg-blue-100"
          label="Visits"
          value={visits.length}
          to="/patient/appointments"
        />
        <StatTile
          icon={<HeartIcon className="w-6 h-6 text-red-600" />}
          bg="bg-red-100"
          label="Medications"
          value={medications.length}
          to="/patient/medications"
        />
        <StatTile
          icon={<BeakerIcon className="w-6 h-6 text-purple-600" />}
          bg="bg-purple-100"
          label="Vital Records"
          value={vitals.length}
          to="/patient/medical-history"
        />
      </div>

      {/* Vitals */}
      {latest && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">Latest Vitals</h2>
            <Link
              to="/patient/medical-history"
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              View History →
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {bpSys > 0 && bpDia > 0 && (
              <VitalCard
                label="Blood Pressure"
                value={`${bpSys}/${bpDia}`}
                unit="mmHg"
                status={bpStatus(bpSys)}
              />
            )}
            {latest.weightKg != null && (
              <VitalCard
                label="Weight"
                value={`${latest.weightKg}`}
                unit="kg"
                status="normal"
              />
            )}
            {latest.tempC != null && (
              <VitalCard
                label="Temperature"
                value={`${latest.tempC}°C`}
                unit="celsius"
                status={tempStatus(latest.tempC)}
              />
            )}
          </div>
          <p className="text-xs text-gray-500 mt-4">
            Recorded: {new Date(latest.takenAt).toLocaleDateString()}
          </p>
        </div>
      )}

      {/* Medications */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900">
            Active Medications
          </h2>
          <Link
            to="/patient/medications"
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            View All →
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
            No medications recorded yet.
          </p>
        )}
      </div>

      {/* Recent Visits */}
      {visits.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">Recent Visits</h2>
            <Link
              to="/patient/medical-history"
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              View All →
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
                    Diagnosis: {v.diagnosis}
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

      <QuickActions />
    </div>
  );
}

// ─── Offline (legacy) dashboard ───────────────────────────────────────────────

function OfflineDashboard() {
  const [data, setData] = useState<PatientDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const portalUserStr = localStorage.getItem("patient_portal_user");
      if (!portalUserStr) {
        window.location.href = "/patient/login";
        return;
      }
      const portalUser = JSON.parse(portalUserStr);
      if (!portalUser.patientId || !portalUser.id) {
        localStorage.removeItem("patient_portal_user");
        sessionStorage.removeItem("patient_session_token");
        window.location.href = "/patient/login";
        return;
      }
      const activeProfileStr = localStorage.getItem("patient_active_profile");
      const activePatientId = activeProfileStr
        ? JSON.parse(activeProfileStr).patientId
        : portalUser.patientId;

      const dashboardData = await getPatientDashboard(
        portalUser.id,
        activePatientId,
      );
      if (dashboardData) {
        setData(dashboardData);
      } else {
        setError("Failed to load dashboard data.");
      }
    } catch (err) {
      logger.error("[PatientDashboard offline] load error:", err);
      setError("An error occurred loading your information.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <Spinner />;
  if (error) return <ErrorCard message={error} />;
  if (!data) return null;

  const { patient, upcomingAppointments, recentVitals, activeMedications } =
    data;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      {/* Welcome */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Welcome back, {patient.givenName}!
            </h1>
            <p className="text-gray-600 mt-1">
              Here's an overview of your health information.
            </p>
          </div>
          <span className="flex items-center gap-2 text-sm text-yellow-600">
            <WifiIcon className="w-4 h-4" />
            Offline mode
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatTile
          icon={<CalendarIcon className="w-6 h-6 text-blue-600" />}
          bg="bg-blue-100"
          label="Upcoming Appointments"
          value={upcomingAppointments.length}
          to="/patient/appointments"
        />
        <StatTile
          icon={<EnvelopeIcon className="w-6 h-6 text-green-600" />}
          bg="bg-green-100"
          label="Unread Messages"
          value={data.unreadMessages}
          to="/patient/messages"
        />
        <StatTile
          icon={<BellIcon className="w-6 h-6 text-yellow-600" />}
          bg="bg-yellow-100"
          label="Notifications"
          value={data.unreadNotifications}
          to="/patient/notifications"
        />
      </div>

      {/* Vitals */}
      {recentVitals && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">
            Recent Vitals
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {recentVitals.systolic && recentVitals.diastolic && (
              <VitalCard
                label="Blood Pressure"
                value={`${recentVitals.systolic}/${recentVitals.diastolic}`}
                unit="mmHg"
                status={bpStatus(recentVitals.systolic)}
              />
            )}
            {recentVitals.tempC && (
              <VitalCard
                label="Temperature"
                value={`${recentVitals.tempC}°C`}
                unit="celsius"
                status={tempStatus(recentVitals.tempC)}
              />
            )}
          </div>
        </div>
      )}

      {/* Medications */}
      {activeMedications.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">
            Active Medications
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

      <QuickActions />
    </div>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <p className="text-red-800">{message}</p>
      </div>
    </div>
  );
}

function StatTile({
  icon,
  bg,
  label,
  value,
  to,
}: {
  icon: ReactNode;
  bg: string;
  label: string;
  value: number;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition-shadow"
    >
      <div className="flex items-center gap-4">
        <div
          className={`w-12 h-12 ${bg} rounded-lg flex items-center justify-center`}
        >
          {icon}
        </div>
        <div>
          <p className="text-sm text-gray-600">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
        </div>
      </div>
    </Link>
  );
}

function QuickActions() {
  return (
    <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl shadow-sm p-6 text-white">
      <h2 className="text-xl font-bold mb-4">Quick Actions</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {[
          {
            to: "/patient/appointments",
            icon: <PlusIcon className="w-5 h-5" />,
            label: "Book Visit",
          },
          {
            to: "/patient/medical-history",
            icon: <ClipboardDocumentListIcon className="w-5 h-5" />,
            label: "View My Records",
          },
          {
            to: "/patient/messages",
            icon: <ChatBubbleLeftRightIcon className="w-5 h-5" />,
            label: "Talk to Health Worker",
          },
          {
            to: "/patient/medications",
            icon: <InformationCircleIcon className="w-5 h-5" />,
            label: "Get Medication Info",
          },
          {
            to: "/patient/outreach",
            icon: <MapPinIcon className="w-5 h-5" />,
            label: "Find Outreach Near Me",
          },
          {
            to: "/patient/export",
            icon: <ArrowDownTrayIcon className="w-5 h-5" />,
            label: "Download Records",
          },
          {
            to: "/patient/data-sharing",
            icon: <ShieldCheckIcon className="w-5 h-5" />,
            label: "Manage Data Sharing",
          },
        ].map(({ to, icon, label }) => (
          <Link
            key={to}
            to={to}
            className="flex items-center gap-3 bg-white/10 hover:bg-white/20 rounded-lg p-4 transition-colors min-h-[60px]"
          >
            {icon}
            <span className="font-medium">{label}</span>
          </Link>
        ))}
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
