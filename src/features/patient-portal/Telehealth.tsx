import { useEffect, useState } from "react";
import { formatNigerianDate, formatTime } from "@/utils/dateFormat";
import {
  VideoCameraIcon,
  CalendarIcon,
  ClockIcon,
  UserIcon,
  PhoneIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import * as logger from "@/lib/logger";

interface TelehealthAppointment {
  id: string;
  providerId: string;
  providerName: string;
  providerSpecialty: string;
  scheduledAt: Date;
  duration: number;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  meetingLink?: string;
  reason: string;
  notes?: string;
}

export function Telehealth() {
  const [appointments, setAppointments] = useState<TelehealthAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestReason, setRequestReason] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [preferredTime, setPreferredTime] = useState("");

  useEffect(() => {
    loadAppointments();
  }, []);

  const loadAppointments = async () => {
    setLoading(true);
    try {
      const portalUser = JSON.parse(
        localStorage.getItem("patient_portal_user") || "{}",
      );
      if (!portalUser.patientId) {
        logger.error("No patient ID found");
        return;
      }

      // Mock data - replace with actual API calls
      const mockAppointments: TelehealthAppointment[] = [
        {
          id: "tele-1",
          providerId: "doc-1",
          providerName: "Dr. Adeyemi",
          providerSpecialty: "General Practice",
          scheduledAt: new Date("2025-11-02T10:00:00"),
          duration: 30,
          status: "scheduled",
          meetingLink: "https://meet.example.com/tele-1",
          reason: "Follow-up consultation",
          notes: "Please have your blood pressure readings ready",
        },
        {
          id: "tele-2",
          providerId: "doc-2",
          providerName: "Dr. Okafor",
          providerSpecialty: "Cardiology",
          scheduledAt: new Date("2025-10-20T14:00:00"),
          duration: 30,
          status: "completed",
          reason: "Hypertension check-up",
        },
      ];

      setAppointments(mockAppointments);
    } catch (err) {
      logger.error("Error loading telehealth appointments:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinCall = (appointment: TelehealthAppointment) => {
    if (appointment.meetingLink) {
      // In production, this would open the video conferencing platform
      alert(
        `Joining video call with ${appointment.providerName}...\n\nIn production, this would launch the video conferencing interface.`,
      );
      window.open(appointment.meetingLink, "_blank");
    }
  };

  const handleRequestAppointment = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      // Mock submission - replace with actual API call
      await new Promise((resolve) => setTimeout(resolve, 1500));

      alert(
        "Telehealth appointment request submitted! We will contact you within 24 hours to confirm.",
      );
      setShowRequestModal(false);
      setRequestReason("");
      setPreferredDate("");
      setPreferredTime("");
    } catch (err) {
      logger.error("Request error:", err);
      alert("Failed to submit request. Please try again.");
    }
  };

  const canJoinCall = (appointment: TelehealthAppointment) => {
    if (appointment.status !== "scheduled") return false;

    const now = new Date();
    const appointmentTime = new Date(appointment.scheduledAt);
    const timeDiff = appointmentTime.getTime() - now.getTime();
    const minutesUntil = timeDiff / (1000 * 60);

    // Allow joining 10 minutes before scheduled time
    return minutesUntil <= 10 && minutesUntil >= -30;
  };

  const getStatusColor = (status: TelehealthAppointment["status"]) => {
    switch (status) {
      case "scheduled":
        return "bg-blue-100 text-blue-800";
      case "in_progress":
        return "bg-green-100 text-green-800";
      case "completed":
        return "bg-gray-100 text-gray-800";
      case "cancelled":
        return "bg-red-100 text-red-800";
    }
  };

  const upcomingAppointments = appointments.filter(
    (a) => a.status === "scheduled" && new Date(a.scheduledAt) >= new Date(),
  );
  const pastAppointments = appointments.filter(
    (a) => a.status === "completed" || new Date(a.scheduledAt) < new Date(),
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      <div className="bg-white rounded-xl shadow-sm p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Telehealth</h1>
            <p className="text-gray-600 mt-2">
              Virtual video consultations with your healthcare providers
            </p>
          </div>
          <button
            onClick={() => setShowRequestModal(true)}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center gap-2"
          >
            <CalendarIcon className="w-5 h-5" />
            Request Appointment
          </button>
        </div>
      </div>

      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl shadow-sm p-6 border border-blue-100">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <VideoCameraIcon className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 text-lg">
              Benefits of Telehealth
            </h3>
            <ul className="mt-2 space-y-2 text-sm text-gray-700">
              <li className="flex items-center gap-2">
                <CheckCircleIcon className="w-4 h-4 text-green-600" />
                Consult with doctors from the comfort of your home
              </li>
              <li className="flex items-center gap-2">
                <CheckCircleIcon className="w-4 h-4 text-green-600" />
                No travel time or waiting rooms
              </li>
              <li className="flex items-center gap-2">
                <CheckCircleIcon className="w-4 h-4 text-green-600" />
                Convenient for follow-up appointments
              </li>
              <li className="flex items-center gap-2">
                <CheckCircleIcon className="w-4 h-4 text-green-600" />
                Secure, HIPAA-compliant video calls
              </li>
            </ul>
          </div>
        </div>
      </div>

      {upcomingAppointments.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-blue-50">
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <CalendarIcon className="w-6 h-6 text-blue-600" />
              Upcoming Appointments
            </h2>
          </div>

          <div className="divide-y divide-gray-200">
            {upcomingAppointments.map((appointment) => {
              const canJoin = canJoinCall(appointment);

              return (
                <div
                  key={appointment.id}
                  className="p-6 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                          <UserIcon className="w-6 h-6 text-blue-600" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900 text-lg">
                            {appointment.providerName}
                          </h3>
                          <p className="text-gray-600 text-sm">
                            {appointment.providerSpecialty}
                          </p>
                        </div>
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(appointment.status)}`}
                        >
                          {appointment.status.charAt(0).toUpperCase() +
                            appointment.status.slice(1).replace("_", " ")}
                        </span>
                      </div>

                      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                        <div className="flex items-center gap-2 text-gray-700">
                          <CalendarIcon className="w-4 h-4 text-gray-400" />
                          <span>
                            {formatNigerianDate(appointment.scheduledAt)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-gray-700">
                          <ClockIcon className="w-4 h-4 text-gray-400" />
                          <span>
                            {formatTime(appointment.scheduledAt)} (
                            {appointment.duration} min)
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-gray-700">
                          <VideoCameraIcon className="w-4 h-4 text-gray-400" />
                          <span>Video Call</span>
                        </div>
                      </div>

                      <div className="mt-3">
                        <p className="text-sm font-medium text-gray-700">
                          Reason: {appointment.reason}
                        </p>
                        {appointment.notes && (
                          <p className="text-sm text-gray-600 mt-1">
                            {appointment.notes}
                          </p>
                        )}
                      </div>

                      {canJoin && (
                        <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-semibold text-green-900">
                                Your appointment is ready!
                              </p>
                              <p className="text-sm text-green-700">
                                Click below to join the video call
                              </p>
                            </div>
                            <button
                              onClick={() => handleJoinCall(appointment)}
                              className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium flex items-center gap-2"
                            >
                              <VideoCameraIcon className="w-5 h-5" />
                              Join Call
                            </button>
                          </div>
                        </div>
                      )}

                      {!canJoin && appointment.status === "scheduled" && (
                        <div className="mt-4">
                          <button
                            disabled
                            className="px-6 py-3 bg-gray-200 text-gray-500 rounded-lg font-medium flex items-center gap-2 cursor-not-allowed"
                          >
                            <ClockIcon className="w-5 h-5" />
                            Join Call (Available 10 min before)
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pastAppointments.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-900">
              Past Appointments
            </h2>
          </div>

          <div className="divide-y divide-gray-200">
            {pastAppointments.map((appointment) => (
              <div
                key={appointment.id}
                className="p-6 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
                        <UserIcon className="w-6 h-6 text-gray-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">
                          {appointment.providerName}
                        </h3>
                        <p className="text-gray-600 text-sm">
                          {appointment.providerSpecialty}
                        </p>
                      </div>
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(appointment.status)}`}
                      >
                        {appointment.status.charAt(0).toUpperCase() +
                          appointment.status.slice(1)}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-600">
                      <div className="flex items-center gap-2">
                        <CalendarIcon className="w-4 h-4 text-gray-400" />
                        <span>
                          {formatNigerianDate(appointment.scheduledAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <ClockIcon className="w-4 h-4 text-gray-400" />
                        <span>{formatTime(appointment.scheduledAt)}</span>
                      </div>
                      <div>
                        <span className="font-medium">Reason:</span>{" "}
                        {appointment.reason}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {upcomingAppointments.length === 0 && pastAppointments.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <VideoCameraIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            No Telehealth Appointments
          </h3>
          <p className="text-gray-600 mb-6">
            Request your first virtual consultation with a healthcare provider
          </p>
          <button
            onClick={() => setShowRequestModal(true)}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium inline-flex items-center gap-2"
          >
            <CalendarIcon className="w-5 h-5" />
            Request Appointment
          </button>
        </div>
      )}

      {showRequestModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Request Telehealth Appointment
            </h2>

            <form onSubmit={handleRequestAppointment} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Reason for Consultation *
                </label>
                <textarea
                  value={requestReason}
                  onChange={(e) => setRequestReason(e.target.value)}
                  required
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Brief description of your health concern"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Preferred Date *
                </label>
                <input
                  type="date"
                  value={preferredDate}
                  onChange={(e) => setPreferredDate(e.target.value)}
                  required
                  min={new Date().toISOString().split("T")[0]}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Preferred Time *
                </label>
                <select
                  value={preferredTime}
                  onChange={(e) => setPreferredTime(e.target.value)}
                  required
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select time</option>
                  <option value="morning">Morning (8:00 AM - 12:00 PM)</option>
                  <option value="afternoon">
                    Afternoon (12:00 PM - 5:00 PM)
                  </option>
                  <option value="evening">Evening (5:00 PM - 8:00 PM)</option>
                </select>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                  We will review your request and contact you within 24 hours to
                  confirm your appointment time.
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowRequestModal(false)}
                  className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                >
                  <CalendarIcon className="w-5 h-5" />
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
