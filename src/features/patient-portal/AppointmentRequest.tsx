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
import { Skeleton } from "@/components/ui/Skeleton";

const appointmentTypes = [
  "General Consultation",
  "Follow-up Visit",
  "Chronic Disease Management",
  "Immunization",
  "Health Screening",
  "Prenatal Care",
  "Pediatric Care",
  "Mental Health",
  "Injury Assessment",
  "Other",
];

const timeSlots = [
  "Morning (8am - 12pm)",
  "Afternoon (12pm - 4pm)",
  "Evening (4pm - 7pm)",
  "Any time",
];

const appointmentSchema = z.object({
  appointmentType: z.string().min(1, "Please select appointment type"),
  preferredDate1: z
    .string()
    .min(1, "Please select at least one preferred date"),
  preferredTime1: z.string().optional(),
  preferredDate2: z.string().optional(),
  preferredTime2: z.string().optional(),
  preferredDate3: z.string().optional(),
  preferredTime3: z.string().optional(),
  reason: z
    .string()
    .min(10, "Please provide a reason (at least 10 characters)")
    .max(500, "Reason must be less than 500 characters"),
  notes: z
    .string()
    .max(1000, "Notes must be less than 1000 characters")
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

const PAGE_DESCRIPTION =
  "See your booked appointments and ask the clinic for a new one. A request is not a booking: the clinic team will contact you to confirm a time.";

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

  const form = useForm<AppointmentForm>({
    resolver: zodResolver(appointmentSchema),
    defaultValues: EMPTY_FORM,
  });
  const { errors } = form.formState;

  const minDate = new Date().toISOString().split("T")[0];
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
          .select("*")
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
      setOverviewError(
        navigator.onLine
          ? "We could not load your appointments and requests. Please try again."
          : "",
      );
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

  const handleSubmit = async (data: AppointmentForm) => {
    if (!supabase) return;
    if (!navigator.onLine) {
      setError(
        "You are offline, so your request was not sent. Connect to the internet and try again.",
      );
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
        setError(
          "Your request was not sent. Check your connection and try again.",
        );
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
      setError(
        "Your request was not sent. Check your connection and try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  if (!supabase) {
    return (
      <PortalPage title="Appointments" description={PAGE_DESCRIPTION}>
        <PortalNotice tone="info" title="Appointments are not available here">
          This portal is not connected to the clinic&apos;s online system, so
          you cannot see or request appointments here. Ask the outreach team
          at your next visit.
        </PortalNotice>
        <Link to="/patient/dashboard" className="btn-secondary">
          Go to home
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
        <PortalNotice tone="offline" title="You are offline">
          {overviewLoaded
            ? "You are seeing the appointments loaded when this phone was last online. They may be out of date."
            : "Connect to the internet to see your appointments."}
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
                Try again
              </button>
            ) : undefined
          }
        >
          {overviewError}
        </PortalNotice>
      )}

      <section className="panel" aria-labelledby="upcoming-title">
        <div className="panel-header">
          <h2 id="upcoming-title" className="panel-title">
            Upcoming appointments
          </h2>
        </div>
        {overviewLoading && !overviewLoaded ? (
          <div className="p-4">
            <span role="status" className="sr-only">
              Loading your appointments
            </span>
            <OverviewSkeleton />
          </div>
        ) : !overviewLoaded ? (
          <p className="panel-body text-body text-ink-muted">
            Not loaded yet.
          </p>
        ) : appointments.length === 0 ? (
          <EmptyState
            icon={CalendarDaysIcon}
            title="No upcoming appointments"
            description="When the clinic books an appointment for you, it will show here."
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
                          ? ` · ${appt.durationMinutes} minutes`
                          : ""}
                      </p>
                      <p className="mt-1 flex items-center gap-1.5 text-body text-ink-secondary">
                        {video && (
                          <VideoCameraIcon
                            className="h-4 w-4 shrink-0"
                            aria-hidden
                          />
                        )}
                        {video ? "Video visit" : appt.appointmentType}
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
                      Open video visits
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
            Your requests
          </h2>
          {requests.length >= REQUESTS_SHOWN && (
            <span className="text-caption text-ink-muted">
              Latest {REQUESTS_SHOWN} shown
            </span>
          )}
        </div>
        {overviewLoading && !overviewLoaded ? (
          <div className="p-4">
            <OverviewSkeleton />
          </div>
        ) : !overviewLoaded ? (
          <p className="panel-body text-body text-ink-muted">
            Not loaded yet.
          </p>
        ) : requests.length === 0 ? (
          <p className="panel-body text-body text-ink-muted">
            You have not asked for an appointment in the portal yet.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {requests.map((req) => {
              const status = appointmentRequestStatusInfo(req.status);
              const video = req.visit_mode === "televisit";
              return (
                <li key={req.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-body font-medium text-ink">
                        {video ? "Video visit" : req.appointment_type}
                      </p>
                      <p className="text-body text-ink-secondary">
                        Preferred: {formatPortalDate(req.preferred_date_1)}
                        {req.preferred_time_1
                          ? ` · ${req.preferred_time_1}`
                          : ""}
                      </p>
                      <p className="text-caption text-ink-muted">
                        Sent on {formatPortalDate(req.created_at)}
                      </p>
                    </div>
                    <StatusBadge tone={status.tone} icon>
                      {status.label}
                    </StatusBadge>
                  </div>
                  {req.review_notes && (
                    <p className="mt-2 rounded-md bg-surface-sunken p-3 text-body text-ink">
                      <span className="text-ink-muted">
                        Note from the clinic:{" "}
                      </span>
                      {req.review_notes}
                    </p>
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
          <h2 className="text-h2 text-ink">Request sent to the clinic</h2>
          <p className="mt-1 text-body text-ink-secondary">
            This is not a booking yet. The clinic team will contact you to
            confirm a time. You can follow it under &quot;Your requests&quot;.
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
              Ask for another appointment
            </button>
            <Link to="/patient/dashboard" className="btn-secondary">
              Back to home
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
          Ask for an appointment
        </h2>
      </div>
      <div className="panel-body space-y-5">
        {!online && (
          <PortalNotice tone="offline">
            You are offline. You can fill in this form, but it can only be sent
            when you are connected to the internet.
          </PortalNotice>
        )}

        <div>
          <label htmlFor="appointmentType" className="field-label">
            Type of appointment (required)
          </label>
          <select
            {...form.register("appointmentType")}
            id="appointmentType"
            className={fieldClass}
            disabled={loading}
            aria-invalid={errors.appointmentType ? true : undefined}
            aria-describedby={describe("appointmentType")}
          >
            <option value="">Select appointment type</option>
            {appointmentTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          {errors.appointmentType && (
            <p id="appointmentType-error" className="field-error">
              {errors.appointmentType.message}
            </p>
          )}
        </div>

        <fieldset className="space-y-4 border-t border-line pt-5">
          <legend className="text-h3 text-ink">Days that suit you</legend>
          <p className="text-body text-ink-muted">
            Give up to 3 days. More choices make it easier for the clinic to
            find a time.
          </p>

          {([1, 2, 3] as const).map((n) => {
            const dateField = `preferredDate${n}` as const;
            const timeField = `preferredTime${n}` as const;
            const choice =
              n === 1 ? "First choice" : n === 2 ? "Second choice" : "Third choice";
            return (
              <div key={n} className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor={dateField} className="field-label">
                    {choice} date{n === 1 ? " (required)" : " (optional)"}
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
                      {errors[dateField]?.message}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor={timeField} className="field-label">
                    {choice} time of day
                  </label>
                  <select
                    {...form.register(timeField)}
                    id={timeField}
                    className={fieldClass}
                    disabled={loading}
                  >
                    <option value="">Any time</option>
                    {timeSlots.map((slot) => (
                      <option key={slot} value={slot}>
                        {slot}
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
              Reason for the visit (required)
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
                {errors.reason.message}
              </p>
            )}
            <p id="reason-count" className="field-hint">
              Describe how you feel or what you need. {form.watch("reason")?.length || 0} / 500
              characters
            </p>
          </div>

          <div>
            <label htmlFor="notes" className="field-label">
              Anything else the clinic should know (optional)
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
                {errors.notes.message}
              </p>
            )}
          </div>
        </div>

        <PortalNotice tone="info">
          This is a request, not a confirmed appointment. The clinic team will
          review it and contact you to confirm a time.
        </PortalNotice>

        {error && <PortalNotice tone="danger">{error}</PortalNotice>}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={loading || !online}
            className="btn-primary"
          >
            {loading ? "Sending…" : "Send request"}
          </button>
          <button
            type="button"
            onClick={() => navigate("/patient/dashboard")}
            className="btn-secondary"
            disabled={loading}
          >
            Cancel
          </button>
        </div>
      </div>
    </form>
  );

  return (
    <PortalPage title="Appointments" description={PAGE_DESCRIPTION}>
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
