import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  VideoCameraIcon,
  CalendarIcon,
  ClockIcon,
  UserIcon,
  XMarkIcon,
  ClipboardDocumentIcon,
  PhoneIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { PatientSearch } from "@/components/PatientSearch";
import type { Patient } from "@/db";
import * as logger from "@/lib/logger";
import { formatNigerianDate, formatNigerianDateTime } from "@/utils/dateFormat";
import {
  STAFF_NOT_REGISTERED_MESSAGE,
  TELEVISIT_DEFAULT_DURATION_MIN,
  canJoinTelevisit,
  cancelTelevisit,
  declineTelevisitRequest,
  getPatientContact,
  getPendingTelevisitRequests,
  getUpcomingTelevisits,
  isRegisteredStaffUser,
  isTelevisitServiceAvailable,
  loadPatientNames,
  notifyPatientTelevisitScheduled,
  preferredSlotToTime,
  scheduleTelevisit,
  updateTelevisitStatus,
  type Televisit,
  type TelevisitRequest,
  type TelevisitStatus,
} from "@/services/televisits";

const DURATION_OPTIONS = [15, 20, 30, 45, 60];

const STATUS_STYLES: Record<TelevisitStatus, string> = {
  scheduled: "bg-blue-100 text-blue-800",
  confirmed: "bg-indigo-100 text-indigo-800",
  arrived: "bg-teal-100 text-teal-800",
  "in-progress": "bg-yellow-100 text-yellow-800",
  completed: "bg-green-100 text-green-800",
  "no-show": "bg-orange-100 text-orange-800",
  cancelled: "bg-gray-100 text-gray-700",
};

interface ScheduleTarget {
  requestId?: string;
  patientId?: string;
  patientName?: string;
  date: string;
  time: string;
  reason: string;
}

interface ScheduleFormValues {
  requestId?: string;
  patientId: string;
  scheduledAt: Date;
  durationMinutes: number;
  reason: string;
  notes: string;
}

interface ScheduledResult {
  visit: Televisit;
  patientName: string;
  smsMessage: string;
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatPreferredDate(value: string): string {
  return formatNigerianDate(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00` : value,
  );
}

function slotLabel(slot?: string): string {
  switch (slot) {
    case "morning":
      return "Morning";
    case "afternoon":
      return "Afternoon";
    case "evening":
      return "Evening";
    default:
      return slot ?? "Any time";
  }
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function StatusPill({ status }: { status: TelevisitStatus }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
        STATUS_STYLES[status] ?? "bg-gray-100 text-gray-700"
      }`}
    >
      {status.replace("-", " ")}
    </span>
  );
}

interface ScheduleTelevisitModalProps {
  initial: ScheduleTarget;
  disabled: boolean;
  onClose: () => void;
  onSubmit: (values: ScheduleFormValues) => Promise<void>;
}

function ScheduleTelevisitModal({
  initial,
  disabled,
  onClose,
  onSubmit,
}: ScheduleTelevisitModalProps) {
  const fixedPatient = Boolean(initial.requestId && initial.patientId);
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(
    initial.patientId
      ? {
          id: initial.patientId,
          name: initial.patientName ?? initial.patientId,
        }
      : null,
  );
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [duration, setDuration] = useState(TELEVISIT_DEFAULT_DURATION_MIN);
  const [reason, setReason] = useState(initial.reason);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const today = toDateInputValue(new Date());

  const handlePatientSelect = (selected: Patient) => {
    setPatient({
      id: selected.id,
      name: `${selected.givenName} ${selected.familyName}`.trim(),
    });
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (disabled) return;
    if (!patient) {
      setError("Select a patient.");
      return;
    }
    if (!date || !time) {
      setError("Choose a date and a time.");
      return;
    }
    const scheduledAt = new Date(`${date}T${time}`);
    if (isNaN(scheduledAt.getTime())) {
      setError("The date or time is invalid.");
      return;
    }
    if (scheduledAt.getTime() <= Date.now()) {
      setError("Choose a time in the future.");
      return;
    }
    if (!reason.trim()) {
      setError("Enter a reason for the visit.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        requestId: initial.requestId,
        patientId: patient.id,
        scheduledAt,
        durationMinutes: duration,
        reason: reason.trim(),
        notes: notes.trim(),
      });
    } catch (err) {
      setError(errorMessage(err, "Could not schedule the televisit."));
      setSubmitting(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-40"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="schedule-televisit-title"
          className="pointer-events-auto w-full max-w-lg bg-white rounded-lg shadow-xl max-h-full overflow-y-auto"
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h2
              id="schedule-televisit-title"
              className="text-lg font-semibold text-gray-900"
            >
              Schedule televisit
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Patient
              </label>
              {fixedPatient && patient ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900">
                  <UserIcon className="h-4 w-4 text-gray-500" />
                  <span>{patient.name}</span>
                </div>
              ) : (
                <>
                  <PatientSearch
                    onPatientSelect={handlePatientSelect}
                    placeholder="Search by name or phone..."
                  />
                  {patient && (
                    <p className="mt-1 text-xs text-gray-600">
                      Selected: {patient.name}
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="televisit-date"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Date
                </label>
                <input
                  id="televisit-date"
                  type="date"
                  min={today}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="input-field"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="televisit-time"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Time
                </label>
                <input
                  id="televisit-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="input-field"
                  required
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="televisit-duration"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Duration
              </label>
              <select
                id="televisit-duration"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="input-field"
              >
                {DURATION_OPTIONS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} minutes
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="televisit-reason"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Reason
              </label>
              <input
                id="televisit-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="input-field"
                placeholder="e.g. Follow-up on blood pressure"
                required
              />
            </div>

            <div>
              <label
                htmlFor="televisit-notes"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Notes (optional)
              </label>
              <textarea
                id="televisit-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="input-field"
                rows={3}
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={disabled || submitting}
                className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? "Scheduling..." : "Schedule & send link"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

export function TelevisitManager() {
  const { currentUser } = useAuthStore();
  const toast = useToast();
  const [requests, setRequests] = useState<TelevisitRequest[]>([]);
  const [visits, setVisits] = useState<Televisit[]>([]);
  const [patientNames, setPatientNames] = useState<Map<string, string>>(
    new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [scheduleTarget, setScheduleTarget] = useState<ScheduleTarget | null>(
    null,
  );
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineNote, setDeclineNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lastScheduled, setLastScheduled] = useState<ScheduledResult | null>(
    null,
  );
  const [staffRegistered, setStaffRegistered] = useState<boolean | null>(null);

  const userId = currentUser?.id;
  const providerName = currentUser?.fullName;
  const actionsDisabled = !userId;
  const available = isTelevisitServiceAvailable();

  const notify = (title: string, body?: string) => {
    toast.push({ id: Date.now().toString(), title, body });
  };

  const load = useCallback(async (isInitial = false) => {
    if (!isTelevisitServiceAvailable()) {
      if (isInitial) setLoading(false);
      return;
    }
    try {
      if (isInitial) setLoading(true);
      const [pending, upcoming] = await Promise.all([
        getPendingTelevisitRequests(),
        getUpcomingTelevisits(),
      ]);
      const patientIds = [
        ...pending.map((r) => r.patientId),
        ...upcoming.map((v) => v.patientId),
      ];
      const names =
        patientIds.length > 0
          ? await loadPatientNames(patientIds)
          : new Map<string, string>();
      setRequests(pending);
      setVisits(upcoming);
      setPatientNames(names);
    } catch (err) {
      logger.error("[TelevisitManager] Failed to load televisits:", err);
    } finally {
      if (isInitial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(true);
    const interval = setInterval(() => load(false), 30000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (!userId || !isTelevisitServiceAvailable()) return;
    let active = true;
    isRegisteredStaffUser(userId)
      .then((registered) => {
        if (active) setStaffRegistered(registered);
      })
      .catch((err) => {
        logger.error(
          "[TelevisitManager] Staff registration check failed:",
          err,
        );
      });
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(tick);
  }, []);

  const nameOf = (patientId: string) =>
    patientNames.get(patientId) || patientId;

  const openScheduleFromHeader = () => {
    setScheduleTarget({
      date: toDateInputValue(new Date()),
      time: "",
      reason: "",
    });
  };

  const openScheduleFromRequest = (request: TelevisitRequest) => {
    setScheduleTarget({
      requestId: request.id,
      patientId: request.patientId,
      patientName: nameOf(request.patientId),
      date: request.preferredDate,
      time: preferredSlotToTime(request.preferredTime),
      reason: request.reason ?? "",
    });
  };

  const handleSchedule = async (values: ScheduleFormValues) => {
    if (!userId) {
      throw new Error("You must be signed in to schedule a televisit.");
    }
    const visit = await scheduleTelevisit({
      patientId: values.patientId,
      providerId: userId,
      scheduledAt: values.scheduledAt,
      durationMinutes: values.durationMinutes,
      reason: values.reason,
      notes: values.notes || undefined,
      createdBy: userId,
      requestId: values.requestId,
    });

    let smsSent = false;
    let smsMessage: string;
    let patientName = nameOf(values.patientId);
    const contact = await getPatientContact(values.patientId);
    if (contact) {
      if (contact.fullName) patientName = contact.fullName;
      const result = await notifyPatientTelevisitScheduled(
        visit,
        contact,
        providerName,
      );
      smsSent = result.sent;
      smsMessage = result.sent
        ? "SMS sent to the patient."
        : `SMS not sent: ${result.error ?? "unknown error"}. Share the link manually.`;
    } else {
      smsMessage = "Patient contact not found. Share the link manually.";
    }

    notify(
      smsSent
        ? "Televisit scheduled — SMS sent"
        : "Televisit scheduled — SMS not sent",
      `${smsMessage}${visit.meetingLink ? ` Link: ${visit.meetingLink}` : ""}`,
    );
    setLastScheduled({ visit, patientName, smsMessage });
    setScheduleTarget(null);
    await load();
  };

  const confirmDecline = async (request: TelevisitRequest) => {
    if (!userId) return;
    setBusyId(request.id);
    try {
      await declineTelevisitRequest(
        request.id,
        userId,
        declineNote.trim() || undefined,
      );
      notify("Request declined", `${nameOf(request.patientId)} was declined.`);
      setDecliningId(null);
      setDeclineNote("");
      await load();
    } catch (err) {
      notify(
        "Could not decline request",
        errorMessage(err, "Please try again."),
      );
    } finally {
      setBusyId(null);
    }
  };

  const joinCall = (visit: Televisit) => {
    if (!visit.meetingLink) {
      notify("No meeting link", "This televisit has no meeting link.");
      return;
    }
    window.open(visit.meetingLink, "_blank", "noopener,noreferrer");
  };

  const copyLink = async (link?: string) => {
    if (!link) {
      notify("No meeting link", "This televisit has no meeting link.");
      return;
    }
    if (!navigator.clipboard) {
      notify("Could not copy link", link);
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      notify("Link copied", link);
    } catch {
      notify("Could not copy link", link);
    }
  };

  const resendSms = async (visit: Televisit) => {
    setBusyId(visit.id);
    try {
      const contact = await getPatientContact(visit.patientId);
      if (!contact) {
        notify("SMS not sent", "Patient contact not found.");
        return;
      }
      const result = await notifyPatientTelevisitScheduled(
        visit,
        contact,
        providerName,
      );
      if (result.sent) {
        notify("SMS sent", `Meeting link sent to ${contact.fullName}.`);
      } else {
        notify(
          "SMS not sent",
          `${result.error ?? "Unknown error"}. Share the link manually.`,
        );
      }
    } finally {
      setBusyId(null);
    }
  };

  const changeStatus = async (visit: Televisit, status: TelevisitStatus) => {
    setBusyId(visit.id);
    try {
      if (status === "cancelled") {
        await cancelTelevisit(visit.id);
      } else {
        await updateTelevisitStatus(visit.id, status);
      }
      notify(
        "Televisit updated",
        `${nameOf(visit.patientId)} marked ${status.replace("-", " ")}.`,
      );
      await load();
    } catch (err) {
      notify(
        "Could not update televisit",
        errorMessage(err, "Please try again."),
      );
    } finally {
      setBusyId(null);
    }
  };

  if (!available) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Televisits</h1>
          <p className="text-gray-600">
            Video visit requests and upcoming calls
          </p>
        </div>
        <div className="w-full bg-yellow-50 border border-yellow-200 rounded-lg p-6 flex items-start gap-3">
          <ExclamationTriangleIcon className="h-6 w-6 text-yellow-600 flex-shrink-0" />
          <div>
            <h2 className="font-semibold text-yellow-800">
              Televisits are unavailable
            </h2>
            <p className="text-sm text-yellow-700 mt-1">
              Televisits need the online portal (Supabase) and an internet
              connection.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading televisits...</p>
        </div>
      </div>
    );
  }

  const upcomingToday = visits.filter((v) =>
    isSameLocalDay(v.scheduledAt, now),
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Televisits</h1>
          <p className="text-gray-600">
            Review patient video visit requests and manage upcoming calls
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={openScheduleFromHeader}
            disabled={actionsDisabled}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <VideoCameraIcon className="h-5 w-5" />
            <span className="font-medium">Schedule televisit</span>
          </button>
          <div className="flex items-center space-x-4 bg-white rounded-lg shadow-sm p-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">
                {requests.length}
              </div>
              <div className="text-xs text-gray-600">Pending requests</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {upcomingToday}
              </div>
              <div className="text-xs text-gray-600">Today</div>
            </div>
          </div>
        </div>
      </div>

      {staffRegistered === false && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
          {STAFF_NOT_REGISTERED_MESSAGE}
        </div>
      )}

      {lastScheduled && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <CheckCircleIcon className="h-6 w-6 text-green-600 flex-shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold text-green-800">
                Televisit scheduled for {lastScheduled.patientName} on{" "}
                {formatNigerianDateTime(lastScheduled.visit.scheduledAt)}
              </p>
              <p className="text-sm text-green-700 mt-1">
                {lastScheduled.smsMessage}
              </p>
              {lastScheduled.visit.meetingLink && (
                <p className="text-sm text-green-900 mt-1 break-all">
                  {lastScheduled.visit.meetingLink}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => copyLink(lastScheduled.visit.meetingLink)}
              className="btn-secondary text-sm flex items-center gap-1"
            >
              <ClipboardDocumentIcon className="h-4 w-4" />
              Copy link
            </button>
            <button
              type="button"
              onClick={() => setLastScheduled(null)}
              aria-label="Dismiss"
              className="p-2 rounded-lg text-green-700 hover:bg-green-100"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Pending requests ({requests.length})
        </h2>

        {requests.length === 0 ? (
          <div className="text-center py-10">
            <CheckCircleIcon className="h-12 w-12 text-green-500 mx-auto mb-3" />
            <p className="text-gray-600">No pending televisit requests.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {requests.map((request) => {
              const isDeclining = decliningId === request.id;
              const isBusy = busyId === request.id;
              return (
                <div
                  key={request.id}
                  className="border-2 border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-all"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <UserIcon className="h-5 w-5 text-gray-500 flex-shrink-0" />
                        <h3 className="text-lg font-semibold text-gray-900 truncate">
                          {nameOf(request.patientId)}
                        </h3>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                        <span className="flex items-center gap-1">
                          <CalendarIcon className="h-4 w-4" />
                          {formatPreferredDate(request.preferredDate)}
                        </span>
                        <span className="flex items-center gap-1">
                          <ClockIcon className="h-4 w-4" />
                          {slotLabel(request.preferredTime)}
                        </span>
                      </div>
                      {request.reason && (
                        <p className="mt-2 text-sm text-gray-900">
                          <span className="text-gray-600">Reason:</span>{" "}
                          {request.reason}
                        </p>
                      )}
                      {request.notes && (
                        <p className="mt-1 text-sm text-gray-900">
                          <span className="text-gray-600">Notes:</span>{" "}
                          {request.notes}
                        </p>
                      )}
                      <p className="mt-2 text-xs text-gray-500">
                        Requested {formatNigerianDateTime(request.createdAt)}
                      </p>
                    </div>

                    <div className="flex flex-wrap sm:flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => openScheduleFromRequest(request)}
                        disabled={actionsDisabled || isBusy}
                        className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Schedule
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDecliningId(isDeclining ? null : request.id);
                          setDeclineNote("");
                        }}
                        disabled={actionsDisabled || isBusy}
                        className="btn-secondary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isDeclining ? "Keep request" : "Decline"}
                      </button>
                    </div>
                  </div>

                  {isDeclining && (
                    <div className="mt-4 border-t border-gray-200 pt-4">
                      <label
                        htmlFor={`decline-note-${request.id}`}
                        className="block text-sm font-medium text-gray-700 mb-1"
                      >
                        Note to patient (optional)
                      </label>
                      <textarea
                        id={`decline-note-${request.id}`}
                        value={declineNote}
                        onChange={(e) => setDeclineNote(e.target.value)}
                        className="input-field"
                        rows={2}
                        placeholder="e.g. Please book an in-person visit for this concern."
                      />
                      <div className="mt-2 flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => confirmDecline(request)}
                          disabled={actionsDisabled || isBusy}
                          className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isBusy ? "Declining..." : "Confirm decline"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Upcoming video visits ({visits.length})
        </h2>

        {visits.length === 0 ? (
          <div className="text-center py-10">
            <VideoCameraIcon className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-600">No upcoming video visits.</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {visits.map((visit) => {
              const joinable = canJoinTelevisit(visit, now);
              const isBusy = busyId === visit.id;
              const inProgress = visit.status === "in-progress";
              return (
                <div
                  key={visit.id}
                  className={`border-2 rounded-lg p-4 transition-all ${
                    joinable
                      ? "border-green-300 bg-green-50"
                      : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold text-gray-900 truncate">
                          {nameOf(visit.patientId)}
                        </h3>
                        <StatusPill status={visit.status} />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                        <span className="flex items-center gap-1">
                          <CalendarIcon className="h-4 w-4" />
                          {formatNigerianDateTime(visit.scheduledAt)}
                        </span>
                        <span className="flex items-center gap-1">
                          <ClockIcon className="h-4 w-4" />
                          {visit.durationMinutes} min
                        </span>
                      </div>
                      {visit.reason && (
                        <p className="mt-2 text-sm text-gray-900">
                          <span className="text-gray-600">Reason:</span>{" "}
                          {visit.reason}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => joinCall(visit)}
                        disabled={!joinable || !visit.meetingLink}
                        title={
                          joinable
                            ? "Open the video call"
                            : "Join opens 10 minutes before the visit"
                        }
                        className="flex items-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <VideoCameraIcon className="h-4 w-4" />
                        Join call
                      </button>
                      <button
                        type="button"
                        onClick={() => copyLink(visit.meetingLink)}
                        className="btn-secondary text-sm flex items-center gap-1"
                      >
                        <ClipboardDocumentIcon className="h-4 w-4" />
                        Copy link
                      </button>
                      <button
                        type="button"
                        onClick={() => resendSms(visit)}
                        disabled={actionsDisabled || isBusy}
                        className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <PhoneIcon className="h-4 w-4" />
                        Resend SMS
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-200 pt-3">
                    {!inProgress && (
                      <button
                        type="button"
                        onClick={() => changeStatus(visit, "in-progress")}
                        disabled={actionsDisabled || isBusy}
                        className="px-3 py-1.5 rounded-lg text-sm bg-yellow-100 text-yellow-800 hover:bg-yellow-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Start
                      </button>
                    )}
                    {inProgress && (
                      <button
                        type="button"
                        onClick={() => changeStatus(visit, "completed")}
                        disabled={actionsDisabled || isBusy}
                        className="px-3 py-1.5 rounded-lg text-sm bg-green-100 text-green-800 hover:bg-green-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Complete
                      </button>
                    )}
                    {!inProgress && (
                      <button
                        type="button"
                        onClick={() => changeStatus(visit, "no-show")}
                        disabled={actionsDisabled || isBusy}
                        className="px-3 py-1.5 rounded-lg text-sm bg-orange-100 text-orange-800 hover:bg-orange-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        No-show
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => changeStatus(visit, "cancelled")}
                      disabled={actionsDisabled || isBusy}
                      className="px-3 py-1.5 rounded-lg text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {scheduleTarget && (
        <ScheduleTelevisitModal
          initial={scheduleTarget}
          disabled={actionsDisabled}
          onClose={() => setScheduleTarget(null)}
          onSubmit={handleSchedule}
        />
      )}
    </div>
  );
}
