import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ArrowPathIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  VideoCameraIcon,
} from "@heroicons/react/24/outline";
import { supabase } from "@/lib/supabase";
import * as logger from "@/lib/logger";
import { getPatientAppointments } from "@/services/appointments";
import { cancelTelevisitRequest as cancelPortalRequest } from "@/services/televisits";
import type { Appointment } from "@/services/appointments";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PortalNotice, PortalPage } from "./PortalPage";
import {
  appointmentRequestStatusInfo,
  appointmentStatusInfo,
  formatPortalDate,
  formatPortalLongDate,
  formatPortalTime,
  upcomingAppointments,
} from "./portalStatus";
import { clearPortalSession, readPortalUser } from "./portalSession";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useT } from "@/hooks/useT";
import { localIsoDate } from "./account/outreachCache";
import { Skeleton } from "@/components/ui/Skeleton";

// Stored values stay in English (the clinic reads them); labels are translated.
const appointmentTypes: { value: string; key: string }[] = [
  { value: "General Consultation", key: "portal.appt.type.general" },
  { value: "Follow-up Visit", key: "portal.appt.type.followUp" },
  { value: "Chronic Disease Management", key: "portal.appt.type.chronic" },
  { value: "Immunization", key: "portal.appt.type.immunization" },
  { value: "Health Screening", key: "portal.appt.type.screening" },
  { value: "Prenatal Care", key: "portal.appt.type.prenatal" },
  { value: "Pediatric Care", key: "portal.appt.type.pediatric" },
  { value: "Mental Health", key: "portal.appt.type.mentalHealth" },
  { value: "Injury Assessment", key: "portal.appt.type.injury" },
  { value: "Other", key: "portal.appt.type.other" },
];

const timeSlots: { value: string; key: string }[] = [
  { value: "Morning (8am - 12pm)", key: "portal.appt.slot.morning" },
  { value: "Afternoon (12pm - 4pm)", key: "portal.appt.slot.afternoon" },
  { value: "Evening (4pm - 7pm)", key: "portal.appt.slot.evening" },
  { value: "Any time", key: "portal.appt.slot.any" },
];

/** The translation key for a stored type or time slot, when it is a known one. */
function storedLabelKey(value: string | null | undefined): string | undefined {
  return [...appointmentTypes, ...timeSlots].find((o) => o.value === value)?.key;
}

const appointmentSchema = z.object({
  appointmentType: z.string().min(1, "portal.appt.err.type"),
  preferredDate1: z
    .string()
    .min(1, "portal.appt.err.date"),
  preferredTime1: z.string().optional(),
  preferredDate2: z.string().optional(),
  preferredTime2: z.string().optional(),
  preferredDate3: z.string().optional(),
  preferredTime3: z.string().optional(),
  reason: z
    .string()
    .min(10, "portal.appt.err.reasonShort")
    .max(500, "portal.appt.err.reasonLong"),
  notes: z
    .string()
    .max(1000, "portal.appt.err.notesLong")
    .optional(),
});

type AppointmentForm = z.infer<typeof appointmentSchema>;

const EMPTY_FORM: AppointmentForm = {
  appointmentType: "",
  preferredDate1: "",
  preferredTime1: "",
  preferredDate2: "",
  preferredTime2: "",
  preferredDate3: "",
  preferredTime3: "",
  reason: "",
  notes: "",
};

interface AppointmentRequestRow {
  id: string;
  appointment_type: string;
  preferred_date_1: string;
  preferred_time_1?: string | null;
  reason?: string | null;
  status: string;
  review_notes?: string | null;
  visit_mode?: string | null;
  created_at: string;
}

const REQUESTS_SHOWN = 10;

// Only the columns this page shows: never the clinic's own working fields.
const REQUEST_COLUMNS =
  "id, appointment_type, preferred_date_1, preferred_time_1, reason, status, review_notes, visit_mode, created_at";

function OverviewSkeleton() {
  return (
    <div className="panel space-y-3 p-4" aria-hidden>
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-4 w-64 max-w-full" />
      <Skeleton className="h-4 w-40" />
    </div>
  );
}

export function AppointmentRequest() {
  const { t } = useT();
  const pageDescription = t("portal.appt.description");
  const label = (value: string | null | undefined) => {
    const k = storedLabelKey(value);
    return k ? t(k) : value ?? "";
  };
  const navigate = useNavigate();
  const location = useLocation();
  const online = useOnlineStatus();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const successRef = useRef<HTMLDivElement>(null);

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [requests, setRequests] = useState<AppointmentRequestRow[]>([]);
  const [overviewLoading, setOverviewLoading] = useState(!!supabase);
  const [overviewLoaded, setOverviewLoaded] = useState(false);
  const [overviewError, setOverviewError] = useState("");
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState("");
  const [cancelled, setCancelled] = useState(false);

  const form = useForm<AppointmentForm>({
    resolver: zodResolver(appointmentSchema),
    defaultValues: EMPTY_FORM,
  });
  const { errors } = form.formState;

  // Today on this phone's calendar (not UTC, which is a day behind before 1am WAT).
  const minDate = localIsoDate();
  const isRequestRoute = location.pathname.endsWith("/request");

  const loadOverview = useCallback(async () => {
    if (!supabase) return;
    const portalUser = readPortalUser();
    if (!portalUser || !portalUser.patientId) {
      setOverviewLoading(false);
      return;
    }
    setOverviewLoading(true);
    setOverviewError("");
    try {
      const [appts, requestRes] = await Promise.all([
        getPatientAppointments(portalUser.patientId),
        supabase
          .from("patient_appointment_requests")
          .select(REQUEST_COLUMNS)
          .eq("patient_id", portalUser.patientId)
          .order("created_at", { ascending: false })
          .limit(REQUESTS_SHOWN),
      ]);
      if (requestRes.error) throw requestRes.error;
      setAppointments(upcomingAppointments(appts));
      setRequests((requestRes.data || []) as AppointmentRequestRow[]);
      setOverviewLoaded(true);
    } catch (err) {
      logger.error(
        "Error loading appointments:",
        err instanceof Error ? err.name : "unknown",
      );
      // Offline, the "You are offline" notice already explains it.
      setOverviewError(navigator.onLine ? "portal.appt.loadFailed" : "");
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  // Try once even when offline (this phone may have kept a copy from the last
  // time it was online), then reload when the connection comes back.
  const attempted = useRef(false);

  useEffect(() => {
    if (!supabase) {
      setOverviewLoading(false);
      return;
    }
    if (!online && attempted.current) return;
    attempted.current = true;
    loadOverview();
  }, [online, loadOverview]);

  useEffect(() => {
    if (success) successRef.current?.focus();
  }, [success]);

  // Only a request still waiting for the clinic can be cancelled; the
  // server refuses anything else and the page then says so.
  const handleCancelRequest = async (requestId: string) => {
    if (!navigator.onLine || cancellingId) return;
    setCancellingId(requestId);
    setCancelError("");
    setCancelled(false);
    try {
      await cancelPortalRequest(requestId);
      setConfirmCancelId(null);
      setCancelled(true);
      await loadOverview();
    } catch (err) {
      logger.error(
        "Error cancelling appointment request:",
        err instanceof Error ? err.name : "unknown",
      );
      setCancelError("portal.appt.cancelFailed");
    } finally {
      setCancellingId(null);
    }
  };

  const handleSubmit = async (data: AppointmentForm) => {
    if (!supabase) return;
    if (!navigator.onLine) {
      setError("portal.appt.offlineNotSent");
      return;
    }
    setLoading(true);
    setError("");

    try {
      const portalUser = readPortalUser();
      if (!portalUser) {
        navigate("/patient/login", { replace: true });
        return;
      }
      if (!portalUser.patientId) {
        clearPortalSession();
        navigate("/patient/login", { replace: true });
        return;
      }

      const { error: insertError } = await supabase
        .from("patient_appointment_requests")
        .insert({
          patient_id: portalUser.patientId,
          appointment_type: data.appointmentType,
          preferred_date_1: data.preferredDate1,
          preferred_time_1: data.preferredTime1 || null,
          preferred_date_2: data.preferredDate2 || null,
          preferred_time_2: data.preferredTime2 || null,
          preferred_date_3: data.preferredDate3 || null,
          preferred_time_3: data.preferredTime3 || null,
          reason: data.reason,
          notes: data.notes || null,
          status: "pending",
        });

      if (insertError) {
        logger.error(
          "Error creating appointment request:",
          insertError instanceof Error ? insertError.name : "insert failed",
        );
        setError("portal.appt.notSent");
        return;
      }

      form.reset(EMPTY_FORM);
      setSuccess(true);
      loadOverview();
    } catch (err) {
      logger.error(
        "Error in appointment request:",
        err instanceof Error ? err.name : "unknown",
      );
      setError("portal.appt.notSent");
    } finally {
      setLoading(false);
    }
  };

  if (!supabase) {
    return (
      <PortalPage title={t("portal.appt.title")} description={pageDescription}>
        <PortalNotice tone="info" title={t("portal.appt.notConnectedTitle")}>
          {t("portal.appt.notConnected")}
        </PortalNotice>
        <Link to="/patient/dashboard" className="btn-secondary">
          {t("portal.visits.goHome")}
        </Link>
      </PortalPage>
    );
  }

  const fieldClass = "input-field";
  const describe = (name: keyof AppointmentForm & string) =>
    errors[name] ? `${name}-error` : undefined;
  const reasonDescribedBy = ["reason-count", errors.reason && "reason-error"]
    .filter(Boolean)
    .join(" ");

  const overview = (
    <>
      {!online && (
        <PortalNotice tone="offline" title={t("portal.visits.offlineTitle")}>
          {overviewLoaded
            ? t("portal.appt.offlineStale")
            : t("portal.appt.offlineEmpty")}
        </PortalNotice>
      )}

      {overviewError && (
        <PortalNotice
          tone="danger"
          action={
            online ? (
              <button
                type="button"
                onClick={loadOverview}
                className="btn-secondary"
              >
                <ArrowPathIcon className="h-5 w-5" aria-hidden />
                {t("portal.error.retry")}
              </button>
            ) : undefined
          }
        >
          {t(overviewError)}
        </PortalNotice>
      )}

      <section className="panel" aria-labelledby="upcoming-title">
        <div className="panel-header">
          <h2 id="upcoming-title" className="panel-title">
            {t("portal.appt.upcoming")}
          </h2>
        </div>
        {overviewLoading && !overviewLoaded ? (
          <div className="p-4">
            <span role="status" className="sr-only">
              {t("portal.state.loading.appointments")}
            </span>
            <OverviewSkeleton />
          </div>
        ) : !overviewLoaded ? (
          <p className="panel-body text-body text-ink-muted">
            {t("portal.appt.notLoaded")}
          </p>
        ) : appointments.length === 0 ? (
          <EmptyState
            icon={CalendarDaysIcon}
            title={t("portal.appt.noUpcomingTitle")}
            description={t("portal.appt.noUpcomingBody")}
          />
        ) : (
          <ul className="divide-y divide-line">
            {appointments.map((appt, idx) => {
              const status = appointmentStatusInfo(appt.status);
              const video = appt.visitMode === "televisit";
              return (
                <li key={appt.id ?? idx} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-h3 text-ink">
                        {formatPortalLongDate(appt.scheduledAt)}
                      </p>
                      <p className="text-body tabular-nums text-ink-secondary">
                        {formatPortalTime(appt.scheduledAt)}
                        {appt.durationMinutes
                          ? ` · ${t("portal.appt.minutes", { count: appt.durationMinutes })}`
                          : ""}
                      </p>
                      <p className="mt-1 flex items-center gap-1.5 text-body text-ink-secondary">
                        {video && (
                          <VideoCameraIcon
                            className="h-4 w-4 shrink-0"
                            aria-hidden
                          />
                        )}
                        {video ? t("portal.home.videoVisit") : label(appt.appointmentType)}
                      </p>
                    </div>
                    <StatusBadge tone={status.tone} icon>
                      {status.label}
                    </StatusBadge>
                  </div>
                  {video && (
                    <Link
                      to="/patient/telehealth"
                      className="mt-2 inline-flex min-h-touch-target items-center text-label text-primary-fg underline-offset-2 hover:underline"
                    >
                      {t("portal.appt.openVideo")}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="panel" aria-labelledby="requests-title">
        <div className="panel-header">
          <h2 id="requests-title" className="panel-title">
            {t("portal.appt.requests")}
          </h2>
          {requests.length >= REQUESTS_SHOWN && (
            <span className="text-caption text-ink-muted">
              {t("portal.appt.latestShown", { count: REQUESTS_SHOWN })}
            </span>
          )}
        </div>
        {overviewLoading && !overviewLoaded ? (
          <div className="p-4">
            <OverviewSkeleton />
          </div>
        ) : !overviewLoaded ? (
          <p className="panel-body text-body text-ink-muted">
            {t("portal.appt.notLoaded")}
          </p>
        ) : requests.length === 0 ? (
          <p className="panel-body text-body text-ink-muted">
            {t("portal.appt.noRequests")}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {cancelled && (
              <li className="p-4">
                <PortalNotice tone="success">{t("portal.appt.cancelled")}</PortalNotice>
              </li>
            )}
            {cancelError && (
              <li className="p-4">
                <PortalNotice tone="danger">{t(cancelError)}</PortalNotice>
              </li>
            )}
            {requests.map((req) => {
              const status = appointmentRequestStatusInfo(req.status);
              const video = req.visit_mode === "televisit";
              const canCancel = req.status === "pending";
              const isConfirming = confirmCancelId === req.id;
              const isCancelling = cancellingId === req.id;
              return (
                <li key={req.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-body font-medium text-ink">
                        {video ? t("portal.home.videoVisit") : label(req.appointment_type)}
                      </p>
                      <p className="text-body text-ink-secondary">
                        {t("portal.appt.preferred", { date: formatPortalDate(req.preferred_date_1) })}
                        {req.preferred_time_1
                          ? ` · ${label(req.preferred_time_1)}`
                          : ""}
                      </p>
                      <p className="text-caption text-ink-muted">
                        {t("portal.appt.sentOn", { date: formatPortalDate(req.created_at) })}
                      </p>
                    </div>
                    <StatusBadge tone={status.tone} icon>
                      {status.label}
                    </StatusBadge>
                  </div>
                  {req.review_notes && (
                    <p className="mt-2 rounded-md bg-surface-sunken p-3 text-body text-ink">
                      <span className="text-ink-muted">
                        {t("portal.appt.clinicNote")}{" "}
                      </span>
                      {req.review_notes}
                    </p>
                  )}
                  {canCancel && !isConfirming && (
                    <button
                      type="button"
                      onClick={() => {
                        setCancelError("");
                        setCancelled(false);
                        setConfirmCancelId(req.id);
                      }}
                      disabled={!online || Boolean(cancellingId)}
                      className="btn-secondary mt-3"
                    >
                      {t("portal.appt.cancelRequest")}
                    </button>
                  )}
                  {canCancel && isConfirming && (
                    <div className="mt-3 flex flex-col gap-3 rounded-md border border-warning-line bg-warning-soft p-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-body font-medium text-warning-fg">
                        {t("portal.appt.cancelConfirm")}
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
                          onClick={() => handleCancelRequest(req.id)}
                          disabled={!online || isCancelling}
                          className="btn-danger"
                        >
                          {isCancelling ? t("portal.appt.cancelling") : t("portal.appt.yesCancel")}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );

  const formSection = success ? (
    <div
      ref={successRef}
      tabIndex={-1}
      className="panel focus:outline-none"
      role="status"
    >
      <div className="panel-body flex items-start gap-3">
        <CheckCircleIcon
          className="h-6 w-6 shrink-0 text-success"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-h2 text-ink">{t("portal.appt.sentTitle")}</h2>
          <p className="mt-1 text-body text-ink-secondary">
            {t("portal.appt.sentBody")}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setSuccess(false);
                setError("");
              }}
              className="btn-secondary"
            >
              {t("portal.appt.askAnother")}
            </button>
            <Link to="/patient/dashboard" className="btn-secondary">
              {t("portal.appt.backHome")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  ) : (
    <form
      onSubmit={form.handleSubmit(handleSubmit)}
      className="panel"
      aria-labelledby="request-form-title"
      noValidate
    >
      <div className="panel-header">
        <h2 id="request-form-title" className="panel-title">
          {t("portal.medicines.askAppointment")}
        </h2>
      </div>
      <div className="panel-body space-y-5">
        {!online && (
          <PortalNotice tone="offline">
            {t("portal.appt.offlineForm")}
          </PortalNotice>
        )}

        <div>
          <label htmlFor="appointmentType" className="field-label">
            {t("portal.appt.typeLabel")}
          </label>
          <select
            {...form.register("appointmentType")}
            id="appointmentType"
            className={fieldClass}
            disabled={loading}
            aria-invalid={errors.appointmentType ? true : undefined}
            aria-describedby={describe("appointmentType")}
          >
            <option value="">{t("portal.appt.typePlaceholder")}</option>
            {appointmentTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {t(type.key)}
              </option>
            ))}
          </select>
          {errors.appointmentType && (
            <p id="appointmentType-error" className="field-error">
              {t(errors.appointmentType.message ?? "")}
            </p>
          )}
        </div>

        <fieldset className="space-y-4 border-t border-line pt-5">
          <legend className="text-h3 text-ink">{t("portal.appt.daysLegend")}</legend>
          <p className="text-body text-ink-muted">
            {t("portal.appt.daysHint")}
          </p>

          {([1, 2, 3] as const).map((n) => {
            const dateField = `preferredDate${n}` as const;
            const timeField = `preferredTime${n}` as const;

            return (
              <div key={n} className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor={dateField} className="field-label">
                    {t(`portal.appt.choice${n}Date`)}
                  </label>
                  <input
                    {...form.register(dateField)}
                    type="date"
                    id={dateField}
                    min={minDate}
                    className={fieldClass}
                    disabled={loading}
                    aria-invalid={errors[dateField] ? true : undefined}
                    aria-describedby={describe(dateField)}
                  />
                  {errors[dateField] && (
                    <p id={`${dateField}-error`} className="field-error">
                      {t(errors[dateField]?.message ?? "")}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor={timeField} className="field-label">
                    {t(`portal.appt.choice${n}Time`)}
                  </label>
                  <select
                    {...form.register(timeField)}
                    id={timeField}
                    className={fieldClass}
                    disabled={loading}
                  >
                    <option value="">{t("portal.appt.slot.any")}</option>
                    {timeSlots.map((slot) => (
                      <option key={slot.value} value={slot.value}>
                        {t(slot.key)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </fieldset>

        <div className="space-y-4 border-t border-line pt-5">
          <div>
            <label htmlFor="reason" className="field-label">
              {t("portal.appt.reasonLabel")}
            </label>
            <textarea
              {...form.register("reason")}
              id="reason"
              rows={4}
              className={`${fieldClass} resize-none`}
              disabled={loading}
              aria-invalid={errors.reason ? true : undefined}
              aria-describedby={reasonDescribedBy}
            />
            {errors.reason && (
              <p id="reason-error" className="field-error">
                {t(errors.reason.message ?? "")}
              </p>
            )}
            <p id="reason-count" className="field-hint">
              {t("portal.appt.reasonHint", { count: form.watch("reason")?.length || 0 })}
            </p>
          </div>

          <div>
            <label htmlFor="notes" className="field-label">
              {t("portal.appt.notesLabel")}
            </label>
            <textarea
              {...form.register("notes")}
              id="notes"
              rows={3}
              className={`${fieldClass} resize-none`}
              disabled={loading}
              aria-invalid={errors.notes ? true : undefined}
              aria-describedby={describe("notes")}
            />
            {errors.notes && (
              <p id="notes-error" className="field-error">
                {t(errors.notes.message ?? "")}
              </p>
            )}
          </div>
        </div>

        <PortalNotice tone="info">
          {t("portal.appt.notABooking")}
        </PortalNotice>

        {error && <PortalNotice tone="danger">{t(error)}</PortalNotice>}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={loading || !online}
            className="btn-primary"
          >
            {loading ? t("portal.appt.sending") : t("portal.appt.send")}
          </button>
          <button
            type="button"
            onClick={() => navigate("/patient/dashboard")}
            className="btn-secondary"
            disabled={loading}
          >
            {t("portal.conditions.cancel")}
          </button>
        </div>
      </div>
    </form>
  );

  return (
    <PortalPage title={t("portal.appt.title")} description={pageDescription}>
      {isRequestRoute ? (
        <>
          {formSection}
          {overview}
        </>
      ) : (
        <>
          {overview}
          {formSection}
        </>
      )}
    </PortalPage>
  );
}
