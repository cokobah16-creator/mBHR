import { useEffect, useState } from "react";
import { formatNigerianDate } from "@/utils/dateFormat";
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
import { getPatientDashboard } from "@/services/patientPortalData";
import type { PatientDashboardData } from "@/types/patientPortal";
import * as logger from "@/lib/logger";

type VitalStatus = "normal" | "monitor" | "attention";

function vitalStatus(type: "systolic" | "diastolic" | "pulse" | "temp" | "spo2", value: number): VitalStatus {
  if (type === "systolic") {
    if (value < 120) return "normal";
    if (value < 140) return "monitor";
    return "attention";
  }
  if (type === "diastolic") {
    if (value < 80) return "normal";
    if (value < 90) return "monitor";
    return "attention";
  }
  if (type === "pulse") {
    if (value >= 60 && value <= 100) return "normal";
    if (value > 100 && value <= 120) return "monitor";
    return "attention";
  }
  if (type === "temp") {
    if (value >= 36.1 && value <= 37.2) return "normal";
    if (value > 37.2 && value <= 38.0) return "monitor";
    return "attention";
  }
  if (type === "spo2") {
    if (value > 95) return "normal";
    if (value >= 90) return "monitor";
    return "attention";
  }
  return "normal";
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

function VitalCard({ label, value, unit, status }: { label: string; value: string | number; unit: string; status: VitalStatus }) {
  return (
    <div className="bg-gray-50 rounded-lg p-4 relative">
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm text-gray-600">{label}</p>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColors[status]}`}>
          <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${statusDot[status]}`} />
          {status === "normal" ? "Normal" : status === "monitor" ? "Monitor" : "Attention"}
        </span>
      </div>
      <p className="text-xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{unit}</p>
    </div>
  );
}

function getSyncStatus(): { label: string; color: string } {
  const lastSync = localStorage.getItem("patient_last_sync");
  if (!lastSync) return { label: "Offline mode", color: "bg-gray-400" };
  const diffMs = Date.now() - new Date(lastSync).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return { label: "Just synced", color: "bg-green-500" };
  if (diffMin < 60) return { label: `Last synced ${diffMin} min ago`, color: "bg-green-500" };
  const diffHr = Math.floor(diffMin / 60);
  return { label: `Last synced ${diffHr}h ago`, color: "bg-yellow-500" };
}

export function PatientDashboard() {
  const [data, setData] = useState<PatientDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const syncStatus = getSyncStatus();

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    setLoading(true);
    setError("");
    try {
      const portalUserStr = localStorage.getItem("patient_portal_user");
      if (!portalUserStr) {
        logger.info("No portal user found in localStorage - redirecting to login");
        window.location.href = "/patient/login";
        return;
      }

      const portalUser = JSON.parse(portalUserStr);
      if (!portalUser.patientId || !portalUser.id) {
        logger.warn("Invalid portal user data - redirecting to login");
        localStorage.removeItem("patient_portal_user");
        localStorage.removeItem("patient_session_token");
        window.location.href = "/patient/login";
        return;
      }

      // Support caregiver active profile switching
      const activeProfileStr = localStorage.getItem("patient_active_profile");
      const activePatientId = activeProfileStr
        ? JSON.parse(activeProfileStr).patientId
        : portalUser.patientId;

      const dashboardData = await getPatientDashboard(portalUser.id, activePatientId);
      if (dashboardData) {
        setData(dashboardData);
      } else {
        setError("Failed to load dashboard data");
      }
    } catch (err) {
      logger.error("Error loading dashboard:", err);
      setError("An error occurred loading your information");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <p className="text-red-800">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const {
    patient,
    upcomingAppointments,
    recentVitals,
    activeMedications,
    unreadMessages,
    unreadNotifications,
    recentLabResults,
  } = data;

  const activeProfileStr = localStorage.getItem("patient_active_profile");
  const displayName = activeProfileStr
    ? JSON.parse(activeProfileStr).givenName
    : patient.givenName;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      {/* Welcome + sync status */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Welcome back, {displayName}!
            </h1>
            <p className="text-gray-600 mt-2">
              Here's an overview of your health information
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className={`inline-block w-2 h-2 rounded-full ${syncStatus.color}`} />
            <WifiIcon className="w-4 h-4" />
            <span>{syncStatus.label}</span>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Link
          to="/patient/appointments"
          className="bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition-shadow"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
              <CalendarIcon className="w-6 h-6 text-blue-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-gray-600">Upcoming Appointments</p>
              <p className="text-2xl font-bold text-gray-900">
                {upcomingAppointments.length}
              </p>
            </div>
          </div>
          {upcomingAppointments.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-sm text-gray-700 font-medium">
                Next: {formatNigerianDate(upcomingAppointments[0].scheduledAt)}
              </p>
              <p className="text-xs text-gray-500">
                {upcomingAppointments[0].appointmentType}
              </p>
            </div>
          )}
        </Link>

        <Link
          to="/patient/messages"
          className="bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition-shadow relative"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
              <EnvelopeIcon className="w-6 h-6 text-green-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-gray-600">Messages</p>
              <p className="text-2xl font-bold text-gray-900">{unreadMessages}</p>
              <p className="text-xs text-gray-500">unread</p>
            </div>
          </div>
          {unreadMessages > 0 && (
            <div className="absolute top-4 right-4 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
              <span className="text-xs text-white font-bold">{unreadMessages}</span>
            </div>
          )}
        </Link>

        <Link
          to="/patient/notifications"
          className="bg-white rounded-xl shadow-sm p-6 hover:shadow-md transition-shadow relative"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-yellow-100 rounded-lg flex items-center justify-center">
              <BellIcon className="w-6 h-6 text-yellow-600" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-gray-600">Notifications</p>
              <p className="text-2xl font-bold text-gray-900">{unreadNotifications}</p>
              <p className="text-xs text-gray-500">unread</p>
            </div>
          </div>
          {unreadNotifications > 0 && (
            <div className="absolute top-4 right-4 w-6 h-6 bg-yellow-500 rounded-full flex items-center justify-center">
              <span className="text-xs text-white font-bold">{unreadNotifications}</span>
            </div>
          )}
        </Link>
      </div>

      {/* Color-coded vitals */}
      {recentVitals && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">Recent Vitals</h2>
            <Link
              to="/patient/medical-history"
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              View History →
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {recentVitals.systolic && recentVitals.diastolic && (
              <VitalCard
                label="Blood Pressure"
                value={`${recentVitals.systolic}/${recentVitals.diastolic}`}
                unit="mmHg"
                status={vitalStatus("systolic", recentVitals.systolic)}
              />
            )}
            {recentVitals.pulseBpm && (
              <VitalCard
                label="Heart Rate"
                value={recentVitals.pulseBpm}
                unit="bpm"
                status={vitalStatus("pulse", recentVitals.pulseBpm)}
              />
            )}
            {recentVitals.tempC && (
              <VitalCard
                label="Temperature"
                value={`${recentVitals.tempC}°C`}
                unit="celsius"
                status={vitalStatus("temp", recentVitals.tempC)}
              />
            )}
            {recentVitals.spo2 && (
              <VitalCard
                label="O2 Saturation"
                value={`${recentVitals.spo2}%`}
                unit="SpO2"
                status={vitalStatus("spo2", recentVitals.spo2)}
              />
            )}
          </div>
          {recentVitals.takenAt && (
            <p className="text-xs text-gray-500 mt-4">
              Last recorded: {formatNigerianDate(recentVitals.takenAt)}
            </p>
          )}
        </div>
      )}

      {/* Medications + Labs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">Active Medications</h2>
            <Link
              to="/patient/medications"
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              View All →
            </Link>
          </div>
          {activeMedications.length > 0 ? (
            <div className="space-y-3">
              {activeMedications.slice(0, 3).map((med, idx) => (
                <div key={idx} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <HeartIcon className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900">{med.medicationName}</p>
                    <p className="text-sm text-gray-600">{med.dosage}</p>
                    <p className="text-xs text-gray-500">{med.directions}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">No active medications</p>
          )}
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">Recent Lab Results</h2>
            <Link
              to="/patient/labs"
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              View All →
            </Link>
          </div>
          {recentLabResults.length > 0 ? (
            <div className="space-y-3">
              {recentLabResults.map((result, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                      <BeakerIcon className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{result.testName}</p>
                      <p className="text-xs text-gray-500">
                        {formatNigerianDate(result.resultDate)}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-medium ${
                      result.interpretation === "normal"
                        ? "bg-green-100 text-green-800"
                        : result.interpretation === "abnormal"
                          ? "bg-yellow-100 text-yellow-800"
                          : "bg-red-100 text-red-800"
                    }`}
                  >
                    {result.interpretation}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-8">No recent lab results</p>
          )}
        </div>
      </div>

      {/* Quick Actions — 5 buttons from product spec */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl shadow-sm p-6 text-white">
        <h2 className="text-xl font-bold mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Link
            to="/patient/appointments"
            className="flex items-center gap-3 bg-white/10 hover:bg-white/20 rounded-lg p-4 transition-colors min-h-[60px]"
          >
            <PlusIcon className="w-6 h-6 flex-shrink-0" />
            <span className="font-medium">Book Visit</span>
          </Link>
          <Link
            to="/patient/medical-history"
            className="flex items-center gap-3 bg-white/10 hover:bg-white/20 rounded-lg p-4 transition-colors min-h-[60px]"
          >
            <ClipboardDocumentListIcon className="w-6 h-6 flex-shrink-0" />
            <span className="font-medium">View My Records</span>
          </Link>
          <Link
            to="/patient/messages"
            className="flex items-center gap-3 bg-white/10 hover:bg-white/20 rounded-lg p-4 transition-colors min-h-[60px]"
          >
            <ChatBubbleLeftRightIcon className="w-6 h-6 flex-shrink-0" />
            <span className="font-medium">Talk to Health Worker</span>
          </Link>
          <Link
            to="/patient/medications"
            className="flex items-center gap-3 bg-white/10 hover:bg-white/20 rounded-lg p-4 transition-colors min-h-[60px]"
          >
            <InformationCircleIcon className="w-6 h-6 flex-shrink-0" />
            <span className="font-medium">Get Medication Info</span>
          </Link>
          <Link
            to="/patient/outreach"
            className="flex items-center gap-3 bg-white/10 hover:bg-white/20 rounded-lg p-4 transition-colors min-h-[60px]"
          >
            <MapPinIcon className="w-6 h-6 flex-shrink-0" />
            <span className="font-medium">Find Outreach Near Me</span>
          </Link>
        </div>
      </div>

      {/* Health record download */}
      <div className="bg-gradient-to-r from-teal-600 to-teal-700 rounded-xl shadow-sm p-6 text-white">
        <div className="flex items-center gap-3 mb-4">
          <ArrowDownTrayIcon className="w-8 h-8" />
          <div>
            <h2 className="text-xl font-bold">Download My Health Record</h2>
            <p className="text-teal-100 text-sm">
              Export your complete medical history in FHIR format
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/patient/export"
            className="inline-flex items-center gap-2 bg-white text-teal-700 font-semibold px-6 py-3 rounded-lg hover:bg-teal-50 transition-colors"
          >
            <ArrowDownTrayIcon className="w-5 h-5" />
            Download Health Record
          </Link>
          <Link
            to="/patient/data-sharing"
            className="inline-flex items-center gap-2 bg-teal-500 text-white font-medium px-6 py-3 rounded-lg hover:bg-teal-400 transition-colors"
          >
            <ShieldCheckIcon className="w-5 h-5" />
            Manage Data Sharing
          </Link>
        </div>
      </div>
    </div>
  );
}
