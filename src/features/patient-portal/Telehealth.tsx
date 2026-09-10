import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { formatNigerianDate, formatTime } from "@/utils/dateFormat";
import {
  VideoCameraIcon,
  CalendarIcon,
  ClockIcon,
  UserIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import * as logger from "@/lib/logger";
import {
  TELEVISIT_JOIN_WINDOW_AFTER_MIN,
  canJoinTelevisit,
  cancelTelevisitRequest,
  getPatientTelevisitRequests,
  getPatientTelevisits,
  isTelevisitServiceAvailable,
  requestTelevisit,
  televisitJoinOpensAt,
} from "@/services/televisits";
import type {
  Televisit,
  TelevisitRequest,
  TelevisitRequestStatus,
  TelevisitStatus,
} from "@/services/televisits";

const JOIN_WINDOW_REFRESH_MS = 30000;

const ACTIVE_VISIT_STATUSES: TelevisitStatus[] = [
  "scheduled",
  "confirmed",
  "in-progress",
];

const OPEN_REQUEST_STATUSES: TelevisitRequestStatus[] = ["pending", "approved"];

function readPatientId(): string | null {
  try {
    const raw = localStorage.getItem("patient_portal_user");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { patientId?: string };
    return parsed.patientId || null;
  } catch {
    return null;
  }
}

function joinWindowClosesAt(visit: Televisit): Date {
  return new Date(
    visit.scheduledAt.getTime() +
      visit.durationMinutes * 60000 +
      TELEVISIT_JOIN_WINDOW_AFTER_MIN * 60000,
  );
}

function isUpcoming(visit: Televisit, now: Date): boolean {
  return (
    ACTIVE_VISIT_STATUSES.includes(visit.status) &&
    now.getTime() <= joinWindowClosesAt(visit).getTime()
  );
}

function visitStatusLabel(status: TelevisitStatus): string {
  switch (status) {
    case "in-progress":
      return "In progress";
    case "no-show":
      return "Missed";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

function visitStatusColor(status: TelevisitStatus): string {
  switch (status) {
    case "scheduled":
    case "confirmed":
      return "bg-blue-100 text-blue-800";
    case "arrived":
    case "in-progress":
      return "bg-green-100 text-green-800";
    case "completed":
      return "bg-gray-100 text-gray-800";
    case "no-show":
      return "bg-amber-100 text-amber-800";
    case "cancelled":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function requestStatusLabel(status: TelevisitRequestStatus): string {
  switch (status) {
    case "pending":
      return "Awaiting review";
    case "approved":
      return "Approved";
    case "declined":
      return "Declined";
    case "scheduled":
      return "Scheduled";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function requestStatusColor(status: TelevisitRequestStatus): string {
  switch (status) {
    case "pending":
      return "bg-amber-100 text-amber-800";
    case "approved":
    case "scheduled":
      return "bg-green-100 text-green-800";
    case "declined":
    case "cancelled":
      return "bg-red-100 text-red-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

function timeSlotLabel(slot?: string): string {
  switch (slot) {
    case "morning":
      return "Morning (8:00 AM - 12:00 PM)";
    case "afternoon":
      return "Afternoon (12:00 PM - 5:00 PM)";
    case "evening":
      return "Evening (5:00 PM - 8:00 PM)";
    default:
      return slot || "Any time";
  }
}

function preferredDateLabel(preferredDate: string): string {
  const [year, month, day] = preferredDate.split("-").map(Number);
  if (!year || !month || !day) return preferredDate;
  return formatNigerianDate(new Date(year, month - 1, day));
}

export function Telehealth() {
  const navigate = useNavigate();
  const [patientId, setPatientId] = useState<string | null>(null);
  const [available, setAvailable] = useState(isTelevisitServiceAvailable);
  const [visits, setVisits] = useState<Televisit[]>([]);
  const [requests, setRequests] = useState<TelevisitRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [now, setNow] = useState(() => new Date());

  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestReason, setRequestReason] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState("");

  useEffect(() => {
    const id = readPatientId();
    if (!id) {
      localStorage.removeItem("patient_portal_user");
      sessionStorage.removeItem("patient_session_token");
      navigate("/patient/login", { replace: true });
      return;
    }
    setPatientId(id);
  }, [navigate]);

  useEffect(() => {
    const update = () => setAvailable(isTelevisitServiceAvailable());
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(
      () => setNow(new Date()),
      JOIN_WINDOW_REFRESH_MS,
    );
    return () => window.clearInterval(timer);
  }, []);

  const loadData = useCallback(async () => {
    if (!patientId) return;
    if (!available) {
      setLoading(false);
      return;
    }
    setLoadError("");
    try {
      const [visitRows, requestRows] = await Promise.all([
        getPatientTelevisits(patientId),
        getPatientTelevisitRequests(patientId),
      ]);
      setVisits(visitRows);
      setRequests(requestRows);
    } catch (err) {
      logger.error("Error loading televisits:", err);
      setLoadError("We could not load your video visits. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [patientId, available]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleJoinCall = (visit: Televisit) => {
    if (!available || !visit.meetingLink || !canJoinTelevisit(visit, now)) {
      return;
    }
    window.open(visit.meetingLink, "_blank", "noopener,noreferrer");
  };

  const handleRequestSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!patientId || !available || submitting) return;

    setSubmitting(true);
    setRequestError("");
    try {
      await requestTelevisit({
        patientId,
        reason: requestReason.trim(),
        preferredDate,
        preferredTime: preferredTime || undefined,
      });
      setShowRequestModal(false);
      setRequestReason("");
      setPreferredDate("");
      setPreferredTime("");
      setSuccessMessage("Request sent. We will confirm by SMS.");
      await loadData();
    } catch (err) {
      logger.error("Error requesting televisit:", err);
      setRequestError("Failed to send your request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelRequest = async (requestId: string) => {
    if (!available || cancellingId) return;
    setCancellingId(requestId);
    setCancelError("");
    try {
      await cancelTelevisitRequest(requestId);
      setConfirmCancelId(null);
      setSuccessMessage("Your request has been cancelled.");
      await loadData();
    } catch (err) {
      logger.error("Error cancelling televisit request:", err);
      setCancelError("Failed to cancel the request. Please try again.");
    } finally {
      setCancellingId(null);
    }
  };

  const openRequestModal = () => {
    if (!available) return;
    setRequestError("");
    setSuccessMessage("");
    setShowRequestModal(true);
  };

  const upcomingVisits = visits
    .filter((v) => isUpcoming(v, now))
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  const pastVisits = visits.filter((v) => !isUpcoming(v, now));
  const openRequests = requests.filter((r) =>
    OPEN_REQUEST_STATUSES.includes(r.status),
  );
  const declinedRequests = requests.filter((r) => r.status === "declined");
  const hasAnything =
    upcomingVisits.length > 0 ||
    pastVisits.length > 0 ||
    openRequests.length > 0 ||
    declinedRequests.length > 0;

  const requestButtonClass = available
    ? "bg-blue-600 text-white hover:bg-blue-700"
    : "bg-gray-200 text-gray-500 cursor-not-allowed";

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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Telehealth</h1>
            <p className="text-gray-600 mt-2">
              Video visits with your healthcare providers
            </p>
          </div>
          <button
            type="button"
            onClick={openRequestModal}
            disabled={!available}
            className={`px-6 py-3 rounded-lg transition-colors font-medium flex items-center gap-2 ${requestButtonClass}`}
          >
            <CalendarIcon className="w-5 h-5" />
            Request Video Visit
          </button>
        </div>
      </div>

      {!available && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <ExclamationTriangleIcon className="w-6 h-6 text-amber-600 flex-shrink-0" />
          <div>
            <p className="font-semibold text-amber-900">
              Video visits need an internet connection.
            </p>
            <p className="text-sm text-amber-800 mt-1">
              You are currently offline, or this deployment is not connected to
              the online portal. Requesting, joining and cancelling video visits
              is unavailable until you are back online.
            </p>
          </div>
        </div>
      )}

      {successMessage && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <CheckCircleIcon className="w-6 h-6 text-green-600 flex-shrink-0" />
            <p className="text-sm text-green-800 mt-0.5">{successMessage}</p>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMessage("")}
            className="text-green-700 hover:text-green-900"
            aria-label="Dismiss"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
      )}

      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between gap-3">
          <p className="text-sm text-red-800">{loadError}</p>
          <button
            type="button"
            onClick={() => loadData()}
            className="text-sm font-medium text-red-700 hover:text-red-900"
          >
            Retry
          </button>
        </div>
      )}

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
                Private video room link sent to your phone by SMS
              </li>
            </ul>
          </div>
        </div>
      </div>

      {upcomingVisits.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-blue-50">
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <CalendarIcon className="w-6 h-6 text-blue-600" />
              Upcoming Video Visits
            </h2>
          </div>

          <div className="divide-y divide-gray-200">
            {upcomingVisits.map((visit) => {
              const canJoin = available && canJoinTelevisit(visit, now);
              const hasLink = Boolean(visit.meetingLink);

              return (
                <div
                  key={visit.id}
                  className="p-6 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                          <UserIcon className="w-6 h-6 text-blue-600" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900 text-lg">
                            Your doctor
                          </h3>
                          <p className="text-gray-600 text-sm">Video visit</p>
                        </div>
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-medium ${visitStatusColor(visit.status)}`}
                        >
                          {visitStatusLabel(visit.status)}
                        </span>
                      </div>

                      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                        <div className="flex items-center gap-2 text-gray-700">
                          <CalendarIcon className="w-4 h-4 text-gray-400" />
                          <span>{formatNigerianDate(visit.scheduledAt)}</span>
                        </div>
                        <div className="flex items-center gap-2 text-gray-700">
                          <ClockIcon className="w-4 h-4 text-gray-400" />
                          <span>
                            {formatTime(visit.scheduledAt)} (
                            {visit.durationMinutes} min)
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-gray-700">
                          <VideoCameraIcon className="w-4 h-4 text-gray-400" />
                          <span>Video Call</span>
                        </div>
                      </div>

                      {visit.reason && (
                        <div className="mt-3">
                          <p className="text-sm font-medium text-gray-700">
                            Reason: {visit.reason}
                          </p>
                        </div>
                      )}

                      {canJoin && hasLink && (
                        <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div>
                              <p className="font-semibold text-green-900">
                                Your visit is ready!
                              </p>
                              <p className="text-sm text-green-700">
                                Click below to join the video call
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleJoinCall(visit)}
                              className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium flex items-center gap-2"
                            >
                              <VideoCameraIcon className="w-5 h-5" />
                              Join Call
                            </button>
                          </div>
                        </div>
                      )}

                      {canJoin && !hasLink && (
                        <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-4">
                          <p className="text-sm text-amber-800">
                            The video room link is not ready yet. Please check
                            the SMS we sent you or contact the clinic.
                          </p>
                        </div>
                      )}

                      {!canJoin && (
                        <div className="mt-4">
                          <button
                            type="button"
                            disabled
                            className="px-6 py-3 bg-gray-200 text-gray-500 rounded-lg font-medium flex items-center gap-2 cursor-not-allowed"
                          >
                            <ClockIcon className="w-5 h-5" />
                            Join opens at{" "}
                            {formatTime(televisitJoinOpensAt(visit))}
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

      {(openRequests.length > 0 || declinedRequests.length > 0) && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <ClockIcon className="w-6 h-6 text-amber-600" />
              Your Requests
            </h2>
          </div>

          {cancelError && (
            <div className="mx-6 mt-4 bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-800">{cancelError}</p>
            </div>
          )}

          <div className="divide-y divide-gray-200">
            {[...openRequests, ...declinedRequests].map((request) => {
              const canCancel = request.status === "pending";
              const isConfirming = confirmCancelId === request.id;
              const isCancelling = cancellingId === request.id;

              return (
                <div
                  key={request.id}
                  className="p-6 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-[200px]">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="font-semibold text-gray-900">
                          Video visit request
                        </h3>
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-medium ${requestStatusColor(request.status)}`}
                        >
                          {requestStatusLabel(request.status)}
                        </span>
                      </div>

                      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-700">
                        <div className="flex items-center gap-2">
                          <CalendarIcon className="w-4 h-4 text-gray-400" />
                          <span>
                            Preferred:{" "}
                            {preferredDateLabel(request.preferredDate)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <ClockIcon className="w-4 h-4 text-gray-400" />
                          <span>{timeSlotLabel(request.preferredTime)}</span>
                        </div>
                      </div>

                      {request.reason && (
                        <p className="mt-3 text-sm text-gray-700">
                          <span className="font-medium">Reason:</span>{" "}
                          {request.reason}
                        </p>
                      )}

                      {request.status === "declined" && request.reviewNotes && (
                        <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3">
                          <p className="text-sm text-red-800">
                            <span className="font-medium">
                              Note from clinic:
                            </span>{" "}
                            {request.reviewNotes}
                          </p>
                        </div>
                      )}
                    </div>

                    {canCancel && !isConfirming && (
                      <button
                        type="button"
                        onClick={() => {
                          setCancelError("");
                          setConfirmCancelId(request.id);
                        }}
                        disabled={!available || Boolean(cancellingId)}
                        className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Cancel request
                      </button>
                    )}
                  </div>

                  {canCancel && isConfirming && (
                    <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <p className="text-sm text-amber-900 font-medium">
                        Cancel this video visit request?
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmCancelId(null)}
                          disabled={isCancelling}
                          className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-white transition-colors text-sm font-medium disabled:opacity-50"
                        >
                          Keep request
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCancelRequest(request.id)}
                          disabled={!available || isCancelling}
                          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium disabled:bg-gray-400 disabled:cursor-not-allowed"
                        >
                          {isCancelling ? "Cancelling..." : "Yes, cancel"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pastVisits.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-900">
              Past Video Visits
            </h2>
          </div>

          <div className="divide-y divide-gray-200">
            {pastVisits.map((visit) => (
              <div
                key={visit.id}
                className="p-6 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
                        <UserIcon className="w-6 h-6 text-gray-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">
                          Your doctor
                        </h3>
                        <p className="text-gray-600 text-sm">Video visit</p>
                      </div>
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-medium ${visitStatusColor(visit.status)}`}
                      >
                        {visitStatusLabel(visit.status)}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-600">
                      <div className="flex items-center gap-2">
                        <CalendarIcon className="w-4 h-4 text-gray-400" />
                        <span>{formatNigerianDate(visit.scheduledAt)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <ClockIcon className="w-4 h-4 text-gray-400" />
                        <span>{formatTime(visit.scheduledAt)}</span>
                      </div>
                      {visit.reason && (
                        <div>
                          <span className="font-medium">Reason:</span>{" "}
                          {visit.reason}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!hasAnything && (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <VideoCameraIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            No Video Visits Yet
          </h3>
          <p className="text-gray-600 mb-6">
            Request your first video visit with a healthcare provider
          </p>
          <button
            type="button"
            onClick={openRequestModal}
            disabled={!available}
            className={`px-6 py-3 rounded-lg transition-colors font-medium inline-flex items-center gap-2 ${requestButtonClass}`}
          >
            <CalendarIcon className="w-5 h-5" />
            Request Video Visit
          </button>
        </div>
      )}

      {showRequestModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-md w-full p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">
              Request a Video Visit
            </h2>

            <form onSubmit={handleRequestSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="televisit-reason"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  Reason for Consultation *
                </label>
                <textarea
                  id="televisit-reason"
                  value={requestReason}
                  onChange={(e) => setRequestReason(e.target.value)}
                  required
                  rows={3}
                  disabled={submitting}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Brief description of your health concern"
                />
              </div>

              <div>
                <label
                  htmlFor="televisit-date"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  Preferred Date *
                </label>
                <input
                  id="televisit-date"
                  type="date"
                  value={preferredDate}
                  onChange={(e) => setPreferredDate(e.target.value)}
                  required
                  disabled={submitting}
                  min={new Date().toISOString().split("T")[0]}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label
                  htmlFor="televisit-time"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  Preferred Time *
                </label>
                <select
                  id="televisit-time"
                  value={preferredTime}
                  onChange={(e) => setPreferredTime(e.target.value)}
                  required
                  disabled={submitting}
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
                  We will review your request and send the confirmed time and
                  video link to your phone by SMS.
                </p>
              </div>

              {requestError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-sm text-red-800">{requestError}</p>
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowRequestModal(false)}
                  disabled={submitting}
                  className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !available}
                  className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <CalendarIcon className="w-5 h-5" />
                      Submit Request
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
