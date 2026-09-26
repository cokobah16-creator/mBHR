import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  VideoCameraIcon,
  CalendarDaysIcon,
  ClockIcon,
  XMarkIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import * as logger from "@/lib/logger";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  TELEVISIT_JOIN_WINDOW_AFTER_MIN,
  TELEVISIT_JOIN_WINDOW_BEFORE_MIN,
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
import { PortalListSkeleton, PortalNotice, PortalPage } from "./PortalPage";
import { localIsoDate } from "./account/outreachCache";
import {
  appointmentRequestStatusInfo,
  appointmentStatusInfo,
  formatPortalDate,
  formatPortalLongDate,
  formatPortalTime,
} from "./portalStatus";

const JOIN_WINDOW_REFRESH_MS = 30000;

const ACTIVE_VISIT_STATUSES: TelevisitStatus[] = [
  "scheduled",
  "confirmed",
  "in-progress",
];

const OPEN_REQUEST_STATUSES: TelevisitRequestStatus[] = ["pending", "approved"];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "unknown";
}

export function Telehealth() {
  const navigate = useNavigate();
  const [patientId, setPatientId] = useState<string | null>(null);
  const [available, setAvailable] = useState(isTelevisitServiceAvailable);
  const [visits, setVisits] = useState<Televisit[]>([]);
  const [requests, setRequests] = useState<TelevisitRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
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

  const dialogRef = useRef<HTMLDivElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const submittingRef = useRef(false);

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
      setLoaded(true);
    } catch (err) {
      logger.error("Error loading televisits:", errorName(err));
      setLoadError("We could not load your video visits. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [patientId, available]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);

  const closeRequestModal = useCallback(() => {
    if (submittingRef.current) return;
    setShowRequestModal(false);
  }, []);

  // Request dialog: focus the first field, keep Tab inside, Escape closes,
  // and focus goes back to the button that opened it.
  useEffect(() => {
    if (!showRequestModal) return;
    const opener = openerRef.current;
    reasonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRequestModal();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const items = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [showRequestModal, closeRequestModal]);

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
      setSuccessMessage(
        "Request sent. The clinic team will review it. When they book a time, it will show on this page.",
      );
      await loadData();
    } catch (err) {
      logger.error("Error requesting televisit:", errorName(err));
      setRequestError(
        "Your request was not sent. Check your connection and try again.",
      );
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
      logger.error("Error cancelling televisit request:", errorName(err));
      setCancelError(
        "The request was not cancelled. Check your connection and try again.",
      );
    } finally {
      setCancellingId(null);
    }
  };

  const openRequestModal = (e?: { currentTarget: HTMLElement }) => {
    if (!available) return;
    openerRef.current = e?.currentTarget ?? null;
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

  if (loading) {
    return <PortalListSkeleton label="Loading your video visits" rows={3} />;
  }

  const requestButton = (
    <button
      type="button"
      onClick={openRequestModal}
      disabled={!available}
      className="btn-primary"
    >
      <CalendarDaysIcon className="h-5 w-5" aria-hidden />
      Ask for a video visit
    </button>
  );

  return (
    <PortalPage
      title="Video visits"
      description="Talk to a health worker by video from your phone. Visits the clinic books for you show here."
      actions={requestButton}
    >
      {!available && (
        <PortalNotice
          tone={isSupabaseEnabled ? "offline" : "info"}
          title={
            isSupabaseEnabled
              ? "You are offline"
              : "Video visits are not available here"
          }
        >
          {isSupabaseEnabled
            ? loaded
              ? "You are seeing what was loaded before the connection dropped. Asking for, joining and cancelling video visits need an internet connection."
              : "Video visits need an internet connection. Connect to see, ask for, join or cancel them."
            : "This portal is not connected to the clinic's online system, so video visits cannot be used here."}
        </PortalNotice>
      )}

      {successMessage && (
        <div className="banner banner-success" role="status">
          <p className="min-w-0 flex-1">{successMessage}</p>
          <button
            type="button"
            onClick={() => setSuccessMessage("")}
            className="btn-ghost -my-2 -mr-2"
            aria-label="Dismiss message"
          >
            <XMarkIcon className="h-5 w-5" aria-hidden />
          </button>
        </div>
      )}

      {loadError && (
        <PortalNotice
          tone="danger"
          action={
            <button
              type="button"
              onClick={() => loadData()}
              className="btn-secondary"
            >
              <ArrowPathIcon className="h-5 w-5" aria-hidden />
              Try again
            </button>
          }
        >
          {loadError}
        </PortalNotice>
      )}

      {upcomingVisits.length > 0 && (
        <section className="panel" aria-labelledby="tv-upcoming">
          <div className="panel-header">
            <h2 id="tv-upcoming" className="panel-title">
              Upcoming video visits
            </h2>
          </div>
          <ul className="divide-y divide-line">
            {upcomingVisits.map((visit) => {
              const canJoin = available && canJoinTelevisit(visit, now);
              const hasLink = Boolean(visit.meetingLink);
              const status = appointmentStatusInfo(visit.status);

              return (
                <li key={visit.id} className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-h3 text-ink">
                        {formatPortalLongDate(visit.scheduledAt)}
                      </p>
                      <p className="flex items-center gap-1.5 text-body tabular-nums text-ink-secondary">
                        <ClockIcon className="h-4 w-4 shrink-0" aria-hidden />
                        {formatPortalTime(visit.scheduledAt)} ·{" "}
                        {visit.durationMinutes} minutes
                      </p>
                    </div>
                    <StatusBadge tone={status.tone} icon>
                      {status.label}
                    </StatusBadge>
                  </div>

                  {visit.reason && (
                    <p className="text-body text-ink-secondary">
                      <span className="text-ink-muted">Reason: </span>
                      {visit.reason}
                    </p>
                  )}

                  {canJoin && hasLink && (
                    <div className="flex flex-col gap-3 rounded-lg border border-success-line bg-success-soft p-4 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-body text-success-fg">
                        <span className="font-medium">
                          Your video visit is open.
                        </span>{" "}
                        Join now to talk to the health worker.
                      </p>
                      <button
                        type="button"
                        onClick={() => handleJoinCall(visit)}
                        className="btn-primary"
                      >
                        <VideoCameraIcon className="h-5 w-5" aria-hidden />
                        Join video visit
                      </button>
                    </div>
                  )}

                  {canJoin && !hasLink && (
                    <PortalNotice tone="warning">
                      The link for this video visit is not ready yet. Refresh
                      this page closer to the time, or send the clinic a
                      message.
                    </PortalNotice>
                  )}

                  {!canJoin && (
                    <div>
                      <button type="button" disabled className="btn-secondary">
                        <ClockIcon className="h-5 w-5" aria-hidden />
                        {available
                          ? `Join opens at ${formatPortalTime(televisitJoinOpensAt(visit))}`
                          : "Joining needs an internet connection"}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {(openRequests.length > 0 || declinedRequests.length > 0) && (
        <section className="panel" aria-labelledby="tv-requests">
          <div className="panel-header">
            <h2 id="tv-requests" className="panel-title">
              Your requests
            </h2>
          </div>

          {cancelError && (
            <div className="px-4 pt-4">
              <PortalNotice tone="danger">{cancelError}</PortalNotice>
            </div>
          )}

          <ul className="divide-y divide-line">
            {[...openRequests, ...declinedRequests].map((request) => {
              const canCancel = request.status === "pending";
              const isConfirming = confirmCancelId === request.id;
              const isCancelling = cancellingId === request.id;
              const status = appointmentRequestStatusInfo(request.status);

              return (
                <li key={request.id} className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-body font-medium text-ink">
                        Video visit request
                      </p>
                      <p className="text-body text-ink-secondary">
                        Preferred: {formatPortalDate(request.preferredDate)} ·{" "}
                        {timeSlotLabel(request.preferredTime)}
                      </p>
                    </div>
                    <StatusBadge tone={status.tone} icon>
                      {status.label}
                    </StatusBadge>
                  </div>

                  {request.reason && (
                    <p className="text-body text-ink-secondary">
                      <span className="text-ink-muted">Reason: </span>
                      {request.reason}
                    </p>
                  )}

                  {request.status === "declined" && request.reviewNotes && (
                    <p className="rounded-md bg-surface-sunken p-3 text-body text-ink">
                      <span className="text-ink-muted">
                        Note from the clinic:{" "}
                      </span>
                      {request.reviewNotes}
                    </p>
                  )}

                  {canCancel && !isConfirming && (
                    <button
                      type="button"
                      onClick={() => {
                        setCancelError("");
                        setConfirmCancelId(request.id);
                      }}
                      disabled={!available || Boolean(cancellingId)}
                      className="btn-secondary"
                    >
                      Cancel request
                    </button>
                  )}

                  {canCancel && isConfirming && (
                    <div className="flex flex-col gap-3 rounded-md border border-warning-line bg-warning-soft p-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-body font-medium text-warning-fg">
                        Cancel this video visit request?
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmCancelId(null)}
                          disabled={isCancelling}
                          className="btn-secondary"
                        >
                          Keep request
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCancelRequest(request.id)}
                          disabled={!available || isCancelling}
                          className="btn-danger"
                        >
                          {isCancelling ? "Cancelling…" : "Yes, cancel"}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {pastVisits.length > 0 && (
        <section className="panel" aria-labelledby="tv-past">
          <div className="panel-header">
            <h2 id="tv-past" className="panel-title">
              Past video visits
            </h2>
          </div>
          <ul className="divide-y divide-line">
            {pastVisits.map((visit) => {
              const status = appointmentStatusInfo(visit.status);
              return (
                <li key={visit.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-body font-medium text-ink">
                        {formatPortalDate(visit.scheduledAt)} ·{" "}
                        {formatPortalTime(visit.scheduledAt)}
                      </p>
                      {visit.reason && (
                        <p className="text-body text-ink-secondary">
                          <span className="text-ink-muted">Reason: </span>
                          {visit.reason}
                        </p>
                      )}
                    </div>
                    <StatusBadge tone={status.tone} icon>
                      {status.label}
                    </StatusBadge>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!hasAnything && available && !loadError && (
        <div className="panel">
          <EmptyState
            icon={VideoCameraIcon}
            title="No video visits yet"
            description="Ask for a video visit and the clinic team will review it. When they book a time, it will show here."
            action={requestButton}
          />
        </div>
      )}

      <section className="panel" aria-labelledby="tv-how">
        <div className="panel-header">
          <h2 id="tv-how" className="panel-title">
            How video visits work
          </h2>
        </div>
        <ol className="panel-body list-decimal space-y-1.5 pl-9 text-body text-ink-secondary">
          <li>Ask for a video visit and choose a day that suits you.</li>
          <li>The clinic team reviews your request.</li>
          <li>When they book a time, it shows on this page.</li>
          <li>
            The Join button opens {TELEVISIT_JOIN_WINDOW_BEFORE_MIN} minutes
            before the start time. You need a phone with internet and a
            camera.
          </li>
        </ol>
      </section>

      {showRequestModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
          <div
            className="absolute inset-0 bg-ink/50"
            onClick={closeRequestModal}
            aria-hidden
          />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="tv-request-title"
            className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-surface p-5 shadow-2xl sm:rounded-2xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 id="tv-request-title" className="text-h1 text-ink">
                Ask for a video visit
              </h2>
              <button
                type="button"
                onClick={closeRequestModal}
                disabled={submitting}
                className="btn-ghost -mr-2 -mt-1"
                aria-label="Close"
              >
                <XMarkIcon className="h-6 w-6" aria-hidden />
              </button>
            </div>

            <form onSubmit={handleRequestSubmit} className="space-y-4">
              <div>
                <label htmlFor="televisit-reason" className="field-label">
                  Reason for the video visit (required)
                </label>
                <textarea
                  ref={reasonRef}
                  id="televisit-reason"
                  value={requestReason}
                  onChange={(e) => setRequestReason(e.target.value)}
                  required
                  rows={3}
                  disabled={submitting}
                  aria-describedby="televisit-reason-hint"
                  className="input-field"
                />
                <p id="televisit-reason-hint" className="field-hint">
                  A short description of your health concern.
                </p>
              </div>

              <div>
                <label htmlFor="televisit-date" className="field-label">
                  Preferred day (required)
                </label>
                <input
                  id="televisit-date"
                  type="date"
                  value={preferredDate}
                  onChange={(e) => setPreferredDate(e.target.value)}
                  required
                  disabled={submitting}
                  min={localIsoDate()}
                  className="input-field"
                />
              </div>

              <div>
                <label htmlFor="televisit-time" className="field-label">
                  Preferred time (required)
                </label>
                <select
                  id="televisit-time"
                  value={preferredTime}
                  onChange={(e) => setPreferredTime(e.target.value)}
                  required
                  disabled={submitting}
                  className="input-field"
                >
                  <option value="">Select time</option>
                  <option value="morning">Morning (8:00 AM - 12:00 PM)</option>
                  <option value="afternoon">
                    Afternoon (12:00 PM - 5:00 PM)
                  </option>
                  <option value="evening">Evening (5:00 PM - 8:00 PM)</option>
                </select>
              </div>

              <PortalNotice tone="info">
                This is a request, not a booking. The clinic team will review
                it, and the booked time will show on this page.
              </PortalNotice>

              {requestError && (
                <PortalNotice tone="danger">{requestError}</PortalNotice>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeRequestModal}
                  disabled={submitting}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !available}
                  className="btn-primary flex-1"
                >
                  {submitting ? "Sending…" : "Send request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PortalPage>
  );
}
