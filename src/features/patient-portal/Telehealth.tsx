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
import { useT } from "@/hooks/useT";
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

const TIME_SLOTS = ["morning", "afternoon", "evening"] as const;

function timeSlotLabel(
  t: (key: string, fallback?: string) => string,
  slot?: string,
): string {
  if ((TIME_SLOTS as readonly string[]).includes(slot ?? "")) {
    return t(`portal.tv.slot.${slot}`);
  }
  return slot || t("portal.tv.slot.any");
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "unknown";
}

export function Telehealth() {
  const navigate = useNavigate();
  const { t } = useT();
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
      setLoadError("portal.tv.loadFailed");
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
      setSuccessMessage(t("portal.tv.sent"));
      await loadData();
    } catch (err) {
      logger.error("Error requesting televisit:", errorName(err));
      setRequestError(t("portal.tv.notSent"));
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
      setSuccessMessage(t("portal.tv.cancelled"));
      await loadData();
    } catch (err) {
      logger.error("Error cancelling televisit request:", errorName(err));
      setCancelError(t("portal.tv.cancelFailed"));
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
    return <PortalListSkeleton label={t("portal.tv.loading")} rows={3} />;
  }

  const requestButton = (
    <button
      type="button"
      onClick={openRequestModal}
      disabled={!available}
      className="btn-primary"
    >
      <CalendarDaysIcon className="h-5 w-5" aria-hidden />
      {t("portal.tv.ask")}
    </button>
  );

  return (
    <PortalPage
      title={t("portal.tv.title")}
      description={t("portal.tv.description")}
      actions={requestButton}
    >
      {!available && (
        <PortalNotice
          tone={isSupabaseEnabled ? "offline" : "info"}
          title={
            isSupabaseEnabled
              ? t("portal.tv.offlineTitle")
              : t("portal.tv.notConnectedTitle")
          }
        >
          {isSupabaseEnabled
            ? loaded
              ? t("portal.tv.offlineStale")
              : t("portal.tv.offlineEmpty")
            : t("portal.tv.notConnected")}
        </PortalNotice>
      )}

      {successMessage && (
        <div className="banner banner-success" role="status">
          <p className="min-w-0 flex-1">{successMessage}</p>
          <button
            type="button"
            onClick={() => setSuccessMessage("")}
            className="btn-ghost -my-2 -mr-2"
            aria-label={t("portal.tv.dismiss")}
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
              {t("portal.error.retry")}
            </button>
          }
        >
          {t(loadError)}
        </PortalNotice>
      )}

      {upcomingVisits.length > 0 && (
        <section className="panel" aria-labelledby="tv-upcoming">
          <div className="panel-header">
            <h2 id="tv-upcoming" className="panel-title">
              {t("portal.tv.upcoming")}
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
                        {t("portal.appt.minutes", { count: visit.durationMinutes })}
                      </p>
                    </div>
                    <StatusBadge tone={status.tone} icon>
                      {status.label}
                    </StatusBadge>
                  </div>

                  {visit.reason && (
                    <p className="text-body text-ink-secondary">
                      <span className="text-ink-muted">{t("portal.tv.reason")} </span>
                      {visit.reason}
                    </p>
                  )}

                  {canJoin && hasLink && (
                    <div className="flex flex-col gap-3 rounded-lg border border-success-line bg-success-soft p-4 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-body text-success-fg">
                        <span className="font-medium">
                          {t("portal.tv.openNow")}
                        </span>{" "}
                        {t("portal.tv.joinNowHint")}
                      </p>
                      <button
                        type="button"
                        onClick={() => handleJoinCall(visit)}
                        className="btn-primary"
                      >
                        <VideoCameraIcon className="h-5 w-5" aria-hidden />
                        {t("portal.tv.join")}
                      </button>
                    </div>
                  )}

                  {canJoin && !hasLink && (
                    <PortalNotice tone="warning">
                      {t("portal.tv.linkNotReady")}
                    </PortalNotice>
                  )}

                  {!canJoin && (
                    <div>
                      <button type="button" disabled className="btn-secondary">
                        <ClockIcon className="h-5 w-5" aria-hidden />
                        {available
                          ? t("portal.tv.joinOpensAt", {
                              time: formatPortalTime(televisitJoinOpensAt(visit)),
                            })
                          : t("portal.tv.joinNeedsInternet")}
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
              {t("portal.appt.requests")}
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
                        {t("portal.tv.request")}
                      </p>
                      <p className="text-body text-ink-secondary">
                        {t("portal.appt.preferred", {
                          date: formatPortalDate(request.preferredDate),
                        })}{" "}
                        · {timeSlotLabel(t, request.preferredTime)}
                      </p>
                    </div>
                    <StatusBadge tone={status.tone} icon>
                      {status.label}
                    </StatusBadge>
                  </div>

                  {request.reason && (
                    <p className="text-body text-ink-secondary">
                      <span className="text-ink-muted">{t("portal.tv.reason")} </span>
                      {request.reason}
                    </p>
                  )}

                  {request.status === "declined" && request.reviewNotes && (
                    <p className="rounded-md bg-surface-sunken p-3 text-body text-ink">
                      <span className="text-ink-muted">
                        {t("portal.appt.clinicNote")}{" "}
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
                      {t("portal.appt.cancelRequest")}
                    </button>
                  )}

                  {canCancel && isConfirming && (
                    <div className="flex flex-col gap-3 rounded-md border border-warning-line bg-warning-soft p-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-body font-medium text-warning-fg">
                        {t("portal.tv.cancelConfirm")}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmCancelId(null)}
                          disabled={isCancelling}
                          className="btn-secondary"
                        >
                          {t("portal.appt.keepRequest")}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCancelRequest(request.id)}
                          disabled={!available || isCancelling}
                          className="btn-danger"
                        >
                          {isCancelling
                            ? t("portal.appt.cancelling")
                            : t("portal.appt.yesCancel")}
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
              {t("portal.tv.past")}
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
                          <span className="text-ink-muted">{t("portal.tv.reason")} </span>
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
            title={t("portal.tv.emptyTitle")}
            description={t("portal.tv.emptyBody")}
            action={requestButton}
          />
        </div>
      )}

      <section className="panel" aria-labelledby="tv-how">
        <div className="panel-header">
          <h2 id="tv-how" className="panel-title">
            {t("portal.tv.howTitle")}
          </h2>
        </div>
        <ol className="panel-body list-decimal space-y-1.5 pl-9 text-body text-ink-secondary">
          <li>{t("portal.tv.how1")}</li>
          <li>{t("portal.tv.how2")}</li>
          <li>{t("portal.tv.how3")}</li>
          <li>
            {t("portal.tv.how4", {
              count: TELEVISIT_JOIN_WINDOW_BEFORE_MIN,
            })}
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
                {t("portal.tv.ask")}
              </h2>
              <button
                type="button"
                onClick={closeRequestModal}
                disabled={submitting}
                className="btn-ghost -mr-2 -mt-1"
                aria-label={t("portal.tv.close")}
              >
                <XMarkIcon className="h-6 w-6" aria-hidden />
              </button>
            </div>

            <form onSubmit={handleRequestSubmit} className="space-y-4">
              <div>
                <label htmlFor="televisit-reason" className="field-label">
                  {t("portal.tv.reasonLabel")}
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
                  {t("portal.tv.reasonHint")}
                </p>
              </div>

              <div>
                <label htmlFor="televisit-date" className="field-label">
                  {t("portal.tv.dayLabel")}
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
                  {t("portal.tv.timeLabel")}
                </label>
                <select
                  id="televisit-time"
                  value={preferredTime}
                  onChange={(e) => setPreferredTime(e.target.value)}
                  required
                  disabled={submitting}
                  className="input-field"
                >
                  <option value="">{t("portal.tv.timePlaceholder")}</option>
                  {TIME_SLOTS.map((slot) => (
                    <option key={slot} value={slot}>
                      {t(`portal.tv.slot.${slot}`)}
                    </option>
                  ))}
                </select>
              </div>

              <PortalNotice tone="info">
                {t("portal.tv.notABooking")}
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
                  {t("action.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={submitting || !available}
                  className="btn-primary flex-1"
                >
                  {submitting ? t("portal.appt.sending") : t("portal.appt.send")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </PortalPage>
  );
}
