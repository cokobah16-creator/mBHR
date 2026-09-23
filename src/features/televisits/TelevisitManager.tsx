import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowPathIcon,
  CalendarIcon,
  ClipboardDocumentIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  InboxIcon,
  InformationCircleIcon,
  PhoneIcon,
  VideoCameraIcon,
  WifiIcon,
} from "@heroicons/react/24/outline";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { panelId, tabId } from "@/components/ui/tabIds";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { createAuditLog, generateId } from "@/db";
import * as logger from "@/lib/logger";
import {
  formatNigerianDate,
  formatNigerianDateTime,
  formatTime,
} from "@/utils/dateFormat";
import { updateAppointmentDetails } from "@/services/appointments";
import {
  STAFF_NOT_REGISTERED_MESSAGE,
  TELEVISIT_JOIN_WINDOW_BEFORE_MIN,
  canJoinTelevisit,
  declineTelevisitRequest,
  getPatientContact,
  getPendingTelevisitRequests,
  getTelevisitsBetween,
  getUpcomingTelevisits,
  isTelevisitServiceConfigured,
  notifyPatientTelevisitScheduled,
  preferredSlotToTime,
  resolveStaffAppUserId,
  scheduleTelevisit,
  televisitJoinOpensAt,
  type Televisit,
  type TelevisitRequest,
  type TelevisitStatus,
} from "@/services/televisits";
import { CancelAppointmentDialog } from "@/features/appointments/CancelAppointmentDialog";
import {
  StaffFacingError,
  addDays,
  canManageAppointments,
  describeActionError,
  notesWithCancellation,
  startOfDay,
  toDateInputValue,
} from "@/features/appointments/appointmentModel";
import {
  loadPatientLabels,
  patientPlaceholder,
  type PatientLabel,
} from "@/features/appointments/patientLabels";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { copyText } from "./clipboard";
import {
  ScheduleTelevisitDialog,
  type ScheduleFormValues,
  type ScheduleTarget,
} from "./ScheduleTelevisitDialog";
import { LinkDeliveryStatus, TelevisitLinkNotice } from "./TelevisitLinkNotice";
import {
  joinWindowLabel,
  joinWindowOf,
  linkDeliveryFrom,
  sendLinkLabel,
  televisitStatusMeta,
  type LinkDelivery,
} from "./televisitModel";

type TabKey = "requests" | "upcoming" | "recent";

const TABS_PREFIX = "televisits";
const RECENT_DAYS = 7;
const REFRESH_MS = 30000;

const isTabKey = (value: string): value is TabKey =>
  value === "requests" || value === "upcoming" || value === "recent";

type LoadState =
  | { status: "loading" }
  | { status: "idle" }
  | { status: "error"; message: string };

const errorName = (err: unknown) =>
  err instanceof Error ? err.name : typeof err;

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

function ListSkeleton({ label }: { label: string }) {
  return (
    <div>
      <span role="status" className="sr-only">
        {label}
      </span>
      <div className="divide-y divide-line" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2 px-4 py-4">
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-3 w-72 max-w-full" />
            <Skeleton className="h-3 w-40" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TelevisitManager() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const { push } = useToast();
  const online = useOnlineStatus();
  const configured = isTelevisitServiceConfigured();

  const [tab, setTab] = useState<TabKey>("requests");
  const [requests, setRequests] = useState<TelevisitRequest[]>([]);
  const [visits, setVisits] = useState<Televisit[]>([]);
  const [recent, setRecent] = useState<Televisit[] | null>([]);
  const [labels, setLabels] = useState<Map<string, PatientLabel>>(
    () => new Map(),
  );
  const [loadState, setLoadState] = useState<LoadState>({
    status: "loading",
  });
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [scheduleTarget, setScheduleTarget] = useState<ScheduleTarget | null>(
    null,
  );
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineNote, setDeclineNote] = useState("");
  const [declineError, setDeclineError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Record<string, LinkDelivery>>(
    {},
  );
  const [lastBooked, setLastBooked] = useState<{
    visit: Televisit;
    patientName: string;
  } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Televisit | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [staffAppUserId, setStaffAppUserId] = useState<
    string | null | undefined
  >(undefined);
  const requestRef = useRef(0);
  const wasOnline = useRef(online);

  const userId = currentUser?.id;
  const role = currentUser?.role;
  const myName = currentUser?.fullName;
  const canManage = canManageAppointments(role);

  const load = useCallback(
    async (initial: boolean) => {
      if (!configured) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        // Keep whatever was loaded; the offline banner explains.
        setLoadState({ status: "idle" });
        return;
      }
      const request = ++requestRef.current;
      if (initial) setLoadState({ status: "loading" });
      try {
        const today = startOfDay(new Date());
        const [pending, upcoming, past] = await Promise.all([
          getPendingTelevisitRequests(),
          getUpcomingTelevisits(),
          // Recent visits are secondary: a failure here leaves the rest usable.
          getTelevisitsBetween(
            addDays(today, -RECENT_DAYS),
            addDays(today, 1),
          ).catch((err) => {
            logger.warn(
              "[TelevisitManager] Recent televisits failed to load:",
              errorName(err),
            );
            return null;
          }),
        ]);
        const names = await loadPatientLabels([
          ...pending.map((r) => r.patientId),
          ...upcoming.map((v) => v.patientId),
          ...(past ?? []).map((v) => v.patientId),
        ]);
        if (request !== requestRef.current) return;
        const upcomingIds = new Set(upcoming.map((v) => v.id));
        setRequests(pending);
        setVisits(upcoming);
        setRecent(past ? past.filter((v) => !upcomingIds.has(v.id)) : null);
        setLabels(names);
        setLoadedAt(new Date());
        setLoadState({ status: "idle" });
      } catch (err) {
        if (request !== requestRef.current) return;
        logger.error(
          "[TelevisitManager] Failed to load televisits:",
          errorName(err),
        );
        setLoadState({
          status: "error",
          message:
            "The televisit lists could not be loaded from the online service. Check the connection, then try again.",
        });
      }
    },
    [configured],
  );

  useEffect(() => {
    void load(true);
    const interval = setInterval(() => void load(false), REFRESH_MS);
    return () => clearInterval(interval);
  }, [load]);

  // Reload as soon as the connection comes back.
  useEffect(() => {
    if (online && !wasOnline.current) void load(false);
    wasOnline.current = online;
  }, [online, load]);

  useEffect(() => {
    if (!userId || !configured || !online) return;
    let active = true;
    resolveStaffAppUserId(userId)
      .then((resolved) => {
        if (active) setStaffAppUserId(resolved);
      })
      .catch((err) => {
        logger.error(
          "[TelevisitManager] Staff registration check failed:",
          errorName(err),
        );
      });
    return () => {
      active = false;
    };
  }, [userId, configured, online]);

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), REFRESH_MS);
    return () => clearInterval(tick);
  }, []);

  const nameOf = (patientId: string) =>
    labels.get(patientId)?.name || patientPlaceholder(patientId);

  const patientName = (patientId: string) => {
    const label = labels.get(patientId);
    const name = label?.name || patientPlaceholder(patientId);
    return label?.onDevice ? (
      <Link
        to={`/patients/${patientId}`}
        className="text-primary-fg underline decoration-primary-line underline-offset-2 hover:decoration-primary-fg"
      >
        {name}
      </Link>
    ) : (
      name
    );
  };

  const notify = (
    tone: "success" | "info" | "warning" | "error",
    title: string,
    body?: string,
  ) => push({ id: generateId(), tone, title, body });

  const audit = (action: string, entityId: string) => {
    if (!role) return;
    void createAuditLog(role, action, "televisit", entityId).catch(
      () => undefined,
    );
  };

  // Checked before every write, not only by hiding buttons.
  const writeBlockReason = (): string | null => {
    const user = useAuthStore.getState().currentUser;
    if (!user) return "Sign in to manage televisits.";
    if (!canManageAppointments(user.role)) {
      return "Your role can view televisits but not change them.";
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return "This device is offline. Televisits are managed online; connect to the internet, then try again.";
    }
    return null;
  };

  const assertCanWrite = (): boolean => {
    const reason = writeBlockReason();
    if (reason) notify("warning", "Nothing was changed", reason);
    return reason === null;
  };

  const providerNameFor = (visit: Televisit) =>
    visit.providerId && visit.providerId === staffAppUserId
      ? myName
      : undefined;

  /**
   * Sends the meeting link by SMS and records exactly what happened.
   * `announce` adds a toast (off when the booking notice shows the result);
   * `providerName` names the clinician in the SMS when already known.
   */
  const sendLink = async (
    visit: Televisit,
    options: { announce?: boolean; providerName?: string } = {},
  ) => {
    const { announce = true } = options;
    if (!assertCanWrite()) return;
    setDeliveries((d) => ({ ...d, [visit.id]: { state: "sending" } }));
    let delivery: LinkDelivery;
    try {
      const contact = await getPatientContact(visit.patientId);
      if (!contact) {
        delivery = linkDeliveryFrom({ kind: "no-contact" }, new Date());
      } else {
        const result = await notifyPatientTelevisitScheduled(
          visit,
          contact,
          options.providerName ?? providerNameFor(visit),
        );
        delivery = linkDeliveryFrom(
          {
            kind: "result",
            sent: result.sent,
            error: result.error,
            to: contact.fullName || nameOf(visit.patientId),
          },
          new Date(),
        );
      }
    } catch (err) {
      delivery = linkDeliveryFrom(
        {
          kind: "result",
          sent: false,
          error: err instanceof Error ? err.message : undefined,
          to: "",
        },
        new Date(),
      );
    }
    setDeliveries((d) => ({ ...d, [visit.id]: delivery }));
    if (!announce) return;
    if (delivery.state === "sent") {
      notify("success", "Link sent by SMS", `To ${delivery.to}.`);
    } else if (delivery.state === "failed") {
      notify("warning", "Link not sent by SMS", delivery.reason);
    }
  };

  const copyLink = async (link?: string) => {
    if (!link) {
      notify(
        "warning",
        "No meeting link",
        "This televisit has no meeting link.",
      );
      return;
    }
    const ok = await copyText(link);
    if (ok) notify("success", "Link copied");
    else
      notify("warning", "Could not copy the link", `Copy it by hand: ${link}`);
  };

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
    const blocked = writeBlockReason();
    if (blocked) throw new StaffFacingError(blocked);
    const staffId =
      staffAppUserId ?? (userId ? await resolveStaffAppUserId(userId) : null);
    if (!staffId) throw new StaffFacingError(STAFF_NOT_REGISTERED_MESSAGE);

    const visit = await scheduleTelevisit({
      patientId: values.patientId,
      providerId: staffId,
      scheduledAt: values.scheduledAt,
      durationMinutes: values.durationMinutes,
      reason: values.reason,
      notes: values.notes || undefined,
      createdBy: staffId,
      requestId: values.requestId,
    });
    audit("televisit_scheduled", visit.id);

    const name = values.patientName || nameOf(values.patientId);
    notify(
      "success",
      "Televisit booked",
      `${name} · ${formatNigerianDateTime(visit.scheduledAt)}`,
    );
    setLastBooked({ visit, patientName: name });
    setScheduleTarget(null);
    if (staffId !== staffAppUserId) setStaffAppUserId(staffId);
    void load(false);
    // The signed-in clinician is the provider of a televisit booked here.
    void sendLink(visit, { announce: false, providerName: myName });
  };

  const confirmDecline = async (request: TelevisitRequest) => {
    // Shown next to the decline button, where the person is looking.
    const blocked = writeBlockReason();
    if (blocked || !userId) {
      setDeclineError(blocked ?? "Sign in to manage televisits.");
      return;
    }
    setBusyId(request.id);
    setDeclineError(null);
    try {
      // reviewed_by references the online staff directory, so resolve the
      // directory id first; the local id is the fallback it always used.
      const reviewer =
        staffAppUserId ??
        (await resolveStaffAppUserId(userId).catch(() => null)) ??
        userId;
      await declineTelevisitRequest(
        request.id,
        reviewer,
        declineNote.trim() || undefined,
      );
      // The service reports success even when row-level security changed
      // nothing, so check the request really left the pending list.
      const stillPending = await getPendingTelevisitRequests()
        .then((list) => list.some((r) => r.id === request.id))
        .catch(() => false);
      if (stillPending) {
        throw new StaffFacingError(
          "The request was not declined: the online service did not accept the change. It is still pending. Ask an admin to check that your account can review requests.",
        );
      }
      audit("televisit_request_declined", request.id);
      notify(
        "success",
        "Request declined",
        `${nameOf(request.patientId)}'s request was declined. The patient sees this when they next open the portal; no SMS is sent.`,
      );
      setDecliningId(null);
      setDeclineNote("");
      await load(false);
    } catch (err) {
      setDeclineError(
        describeActionError(
          err,
          "The request was not declined. Check the connection, then try again.",
        ),
      );
    } finally {
      setBusyId(null);
    }
  };

  const changeStatus = async (visit: Televisit, status: TelevisitStatus) => {
    if (!assertCanWrite()) return;
    setBusyId(visit.id);
    try {
      await updateAppointmentDetails(visit.id, { status });
      audit(`televisit_${status}`, visit.id);
      notify(
        "success",
        "Televisit updated",
        `${nameOf(visit.patientId)}: ${televisitStatusMeta(status).label}.`,
      );
      await load(false);
    } catch (err) {
      notify(
        "error",
        "Televisit not updated",
        describeActionError(
          err,
          "The change was not saved. Check the connection, then try again.",
        ),
      );
    } finally {
      setBusyId(null);
    }
  };

  const confirmCancel = async (reason: string) => {
    const visit = cancelTarget;
    if (!visit) return;
    // Shown inside the dialog: a toast would sit behind the modal.
    const blocked = writeBlockReason();
    if (blocked) {
      setCancelError(blocked);
      return;
    }
    setBusyId(visit.id);
    setCancelError(null);
    try {
      const notes = notesWithCancellation(visit.notes, reason);
      await updateAppointmentDetails(
        visit.id,
        notes ? { status: "cancelled", notes } : { status: "cancelled" },
      );
      audit("televisit_cancelled", visit.id);
      setCancelTarget(null);
      if (lastBooked?.visit.id === visit.id) setLastBooked(null);
      notify(
        "success",
        "Televisit cancelled",
        `${nameOf(visit.patientId)} · ${formatNigerianDateTime(visit.scheduledAt)}. The patient has not been told; let them know.`,
      );
      await load(false);
    } catch (err) {
      setCancelError(
        describeActionError(
          err,
          "The televisit was not cancelled. Check the connection, then try again.",
        ),
      );
    } finally {
      setBusyId(null);
    }
  };

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  if (!configured) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Televisits"
          description="Video visit requests from the patient portal and upcoming calls."
        />
        <section className="panel">
          <EmptyState
            icon={VideoCameraIcon}
            title="Televisits are not set up on this device"
            description="Televisits need the online patient portal service and an internet connection. Registration, vitals, consultation and pharmacy keep working offline."
          />
        </section>
      </div>
    );
  }

  const writeBlocked = !canManage || !online;
  const upcomingToday = visits.filter((v) =>
    isSameLocalDay(v.scheduledAt, now),
  ).length;
  const neverLoaded = loadedAt === null;
  const initialLoading = loadState.status === "loading" && neverLoaded;

  const tabs: TabItem<TabKey>[] = [
    {
      id: "requests",
      label: "Requests",
      badge: neverLoaded ? undefined : requests.length,
    },
    {
      id: "upcoming",
      label: "Upcoming",
      badge: neverLoaded ? undefined : visits.length,
    },
    { id: "recent", label: `Past ${RECENT_DAYS} days` },
  ];

  const notLoadedState = () => {
    if (initialLoading) {
      return <ListSkeleton label="Loading televisits" />;
    }
    if (!online) {
      return (
        <EmptyState
          icon={WifiIcon}
          title="Not loaded: this device is offline"
          description="Televisit requests and calls are kept online. They will load when the connection returns."
        />
      );
    }
    return (
      <EmptyState
        icon={ExclamationTriangleIcon}
        title="Televisits not loaded"
        description={
          loadState.status === "error"
            ? loadState.message
            : "The lists have not loaded yet."
        }
        action={
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void load(true)}
          >
            <ArrowPathIcon className="h-4 w-4" aria-hidden />
            Try again
          </button>
        }
      />
    );
  };

  const renderRequests = () => {
    if (neverLoaded) return notLoadedState();
    if (requests.length === 0) {
      return (
        <EmptyState
          icon={InboxIcon}
          title="No pending requests"
          description="Video visit requests that patients send from the portal appear here."
        />
      );
    }
    return (
      <ul className="divide-y divide-line">
        {requests.map((request) => {
          const isDeclining = decliningId === request.id;
          const isBusy = busyId === request.id;
          const name = nameOf(request.patientId);
          return (
            <li key={request.id} className="px-4 py-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 space-y-1">
                  <h2 className="text-h3 text-ink">
                    {patientName(request.patientId)}
                  </h2>
                  <p className="flex flex-wrap gap-x-4 gap-y-1 text-body text-ink-secondary">
                    <span className="inline-flex items-center gap-1">
                      <CalendarIcon className="h-4 w-4" aria-hidden />
                      <span className="sr-only">Preferred date:</span>
                      {formatPreferredDate(request.preferredDate)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <ClockIcon className="h-4 w-4" aria-hidden />
                      <span className="sr-only">Preferred time:</span>
                      {slotLabel(request.preferredTime)}
                    </span>
                  </p>
                  {request.reason && (
                    <p className="text-body text-ink">
                      <span className="text-ink-muted">Reason:</span>{" "}
                      {request.reason}
                    </p>
                  )}
                  {request.notes && (
                    <p className="text-body text-ink">
                      <span className="text-ink-muted">Notes:</span>{" "}
                      {request.notes}
                    </p>
                  )}
                  <p className="text-caption text-ink-muted">
                    Requested {formatNigerianDateTime(request.createdAt)}
                  </p>
                </div>

                {canManage && (
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    <button
                      type="button"
                      onClick={() => openScheduleFromRequest(request)}
                      disabled={writeBlocked || isBusy}
                      className="btn-primary px-4"
                      aria-label={`Book a televisit for ${name}`}
                    >
                      Book
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDecliningId(isDeclining ? null : request.id);
                        setDeclineNote("");
                        setDeclineError(null);
                      }}
                      disabled={writeBlocked || isBusy}
                      className="btn-secondary px-4"
                      aria-expanded={isDeclining}
                      aria-controls={
                        isDeclining ? `decline-${request.id}` : undefined
                      }
                    >
                      {isDeclining ? "Keep request" : "Decline"}
                    </button>
                  </div>
                )}
              </div>

              {isDeclining && (
                <div
                  id={`decline-${request.id}`}
                  className="mt-4 space-y-2 rounded-md border border-line bg-surface-sunken p-3"
                >
                  <label
                    htmlFor={`decline-note-${request.id}`}
                    className="field-label"
                  >
                    Note to the patient (optional)
                  </label>
                  <textarea
                    id={`decline-note-${request.id}`}
                    value={declineNote}
                    onChange={(e) => setDeclineNote(e.target.value)}
                    className="input-field"
                    rows={2}
                    placeholder="e.g. Please book an in-person visit for this concern."
                  />
                  <p className="field-hint">
                    The patient sees the request as declined in the portal. No
                    SMS is sent.
                  </p>
                  {declineError && (
                    <div className="banner banner-danger" role="alert">
                      <ExclamationTriangleIcon
                        className="h-5 w-5 shrink-0"
                        aria-hidden
                      />
                      <span>{declineError}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => void confirmDecline(request)}
                      disabled={writeBlocked || isBusy}
                      className="btn-danger"
                    >
                      {isBusy ? "Declining…" : `Decline ${name}'s request`}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  const joinControl = (visit: Televisit, joinable: boolean) => {
    if (joinable && online && visit.meetingLink) {
      return (
        <a
          href={visit.meetingLink}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary px-4"
        >
          <VideoCameraIcon className="h-4 w-4" aria-hidden />
          Join call
          <span className="sr-only">
            {" "}
            with {nameOf(visit.patientId)} (opens in a new tab)
          </span>
        </a>
      );
    }
    return (
      <button type="button" disabled className="btn-secondary px-4">
        <VideoCameraIcon className="h-4 w-4" aria-hidden />
        Join call
      </button>
    );
  };

  const joinHint = (visit: Televisit, joinable: boolean, opensAt: Date) => {
    if (!visit.meetingLink) return "This televisit has no meeting link.";
    if (!online) return "Joining needs the internet. This device is offline.";
    if (joinable) {
      return "The call opens in a new tab. mBHR cannot see whether it connects: if it does not, copy the link into the browser or phone the patient.";
    }
    if (now.getTime() < opensAt.getTime()) {
      return `You can join from ${formatTime(opensAt)}, ${TELEVISIT_JOIN_WINDOW_BEFORE_MIN} minutes before the start.`;
    }
    if (visit.status === "in-progress") {
      return "The join window has closed. Mark the visit complete once it is over.";
    }
    return "The join window has closed. If the call did not take place, mark it a no-show.";
  };

  const renderVisit = (visit: Televisit, past: boolean) => {
    const meta = televisitStatusMeta(visit.status);
    const joinable = canJoinTelevisit(visit, now);
    const opensAt = televisitJoinOpensAt(visit);
    const windowState = joinWindowOf(visit.status, joinable, opensAt, now);
    const windowBadge = joinWindowLabel(windowState, opensAt);
    const isBusy = busyId === visit.id;
    const delivery = deliveries[visit.id];
    const inProgress = visit.status === "in-progress";
    // "arrived" (checked in from the appointment calendar) only appears in
    // the past list; it stays open so someone can close it.
    const open =
      visit.status === "scheduled" ||
      visit.status === "confirmed" ||
      visit.status === "arrived" ||
      visit.status === "in-progress";
    const name = nameOf(visit.patientId);
    const disabled = writeBlocked || isBusy;

    return (
      <li key={visit.id} className="space-y-3 px-4 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-h3 text-ink">
                {patientName(visit.patientId)}
              </h2>
              <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
              {open && windowBadge && (
                <StatusBadge tone={windowBadge.tone}>
                  {windowBadge.label}
                </StatusBadge>
              )}
            </div>
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-body text-ink-secondary">
              <span className="inline-flex items-center gap-1">
                <CalendarIcon className="h-4 w-4" aria-hidden />
                {formatNigerianDateTime(visit.scheduledAt)}
              </span>
              <span className="inline-flex items-center gap-1">
                <ClockIcon className="h-4 w-4" aria-hidden />
                {visit.durationMinutes} min
              </span>
            </p>
            {visit.reason && (
              <p className="text-body text-ink">
                <span className="text-ink-muted">Reason:</span> {visit.reason}
              </p>
            )}
            <LinkDeliveryStatus delivery={delivery} />
          </div>

          {!past && (
            <div className="flex flex-wrap gap-2 md:justify-end">
              {joinControl(visit, joinable)}
              <button
                type="button"
                onClick={() => void copyLink(visit.meetingLink)}
                disabled={!visit.meetingLink}
                className="btn-secondary px-3"
                aria-label={`Copy link: meeting link for ${name}`}
              >
                <ClipboardDocumentIcon className="h-4 w-4" aria-hidden />
                Copy link
              </button>
              {canManage && (
                <button
                  type="button"
                  onClick={() => void sendLink(visit)}
                  disabled={
                    disabled ||
                    !visit.meetingLink ||
                    delivery?.state === "sending"
                  }
                  className="btn-secondary px-3"
                  aria-label={`${sendLinkLabel(delivery)}: ${name}`}
                >
                  <PhoneIcon className="h-4 w-4" aria-hidden />
                  {sendLinkLabel(delivery)}
                </button>
              )}
            </div>
          )}
        </div>

        {!past && (
          <p className="text-caption text-ink-muted">
            {joinHint(visit, joinable, opensAt)}
          </p>
        )}

        {canManage && open && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            {!past && !inProgress && (
              <button
                type="button"
                onClick={() => void changeStatus(visit, "in-progress")}
                disabled={disabled}
                className="btn-secondary px-3"
              >
                Start
              </button>
            )}
            {(inProgress || past) && (
              <button
                type="button"
                onClick={() => void changeStatus(visit, "completed")}
                disabled={disabled}
                className="btn-secondary px-3"
              >
                {past ? "Mark ended" : "Complete"}
              </button>
            )}
            {!inProgress && (
              <button
                type="button"
                onClick={() => void changeStatus(visit, "no-show")}
                disabled={disabled}
                className="btn-ghost disabled:cursor-not-allowed disabled:opacity-50"
              >
                Mark no-show
              </button>
            )}
            {!past && (
              <button
                type="button"
                onClick={() => {
                  setCancelError(null);
                  setCancelTarget(visit);
                }}
                disabled={disabled}
                className="btn-ghost text-danger-fg hover:text-danger-fg disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
            )}
            {isBusy && (
              <span className="self-center text-caption text-ink-muted">
                Saving…
              </span>
            )}
          </div>
        )}
      </li>
    );
  };

  const renderUpcoming = () => {
    if (neverLoaded) return notLoadedState();
    if (visits.length === 0) {
      return (
        <EmptyState
          icon={VideoCameraIcon}
          title="No upcoming video visits"
          description={
            canManage
              ? "Book one from a patient's request, or with “Book televisit”."
              : "Televisits booked by clinicians appear here."
          }
        />
      );
    }
    return (
      <ul className="divide-y divide-line">
        {visits.map((visit) => renderVisit(visit, false))}
      </ul>
    );
  };

  const renderRecent = () => {
    if (neverLoaded) return notLoadedState();
    if (recent === null) {
      return (
        <EmptyState
          icon={ExclamationTriangleIcon}
          title="Past televisits not loaded"
          description="The list of recent televisits could not be loaded. The other tabs are up to date."
          action={
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void load(false)}
            >
              <ArrowPathIcon className="h-4 w-4" aria-hidden />
              Try again
            </button>
          }
        />
      );
    }
    if (recent.length === 0) {
      return (
        <EmptyState
          icon={VideoCameraIcon}
          title={`No televisits in the past ${RECENT_DAYS} days`}
          description="Ended, missed and cancelled video visits appear here."
        />
      );
    }
    return (
      <ul className="divide-y divide-line">
        {recent.map((visit) => renderVisit(visit, true))}
      </ul>
    );
  };

  const blockedReasonForDialog = !canManage
    ? "Your role can view televisits but not book them."
    : !online
      ? "This device is offline. Televisits are booked online, so connect to the internet first."
      : staffAppUserId === null
        ? STAFF_NOT_REGISTERED_MESSAGE
        : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Televisits"
        description="Review video visit requests from the patient portal and run upcoming calls."
        actions={
          canManage ? (
            <button
              type="button"
              onClick={openScheduleFromHeader}
              disabled={writeBlocked || staffAppUserId === null}
              className="btn-primary"
            >
              <VideoCameraIcon className="h-5 w-5" aria-hidden />
              Book televisit
            </button>
          ) : null
        }
      />

      {!online && (
        <div className="banner banner-warning" role="status">
          <WifiIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <span>
            {loadedAt
              ? `This device is offline. The lists below were loaded at ${formatTime(loadedAt)} and may be out of date. Booking, joining calls and sending links need the internet.`
              : "This device is offline. Televisits need the internet: requests and calls will load when the connection returns."}
          </span>
        </div>
      )}

      {staffAppUserId === null && canManage && (
        <div className="banner banner-warning" role="status">
          <ExclamationTriangleIcon
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden
          />
          <span>{STAFF_NOT_REGISTERED_MESSAGE}</span>
        </div>
      )}

      {!canManage && (
        <div className="banner banner-info" role="note">
          <InformationCircleIcon
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden
          />
          <span>
            You can view televisits. Booking and updating them needs a nurse,
            doctor or admin account.
          </span>
        </div>
      )}

      {loadState.status === "error" && !neverLoaded && (
        <div className="banner banner-warning" role="alert">
          <ExclamationTriangleIcon
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden
          />
          <p className="min-w-0 flex-1">
            {loadState.message}{" "}
            {loadedAt
              ? `Showing the lists loaded at ${formatTime(loadedAt)}.`
              : ""}
          </p>
          <button
            type="button"
            className="btn-secondary px-3"
            onClick={() => void load(false)}
          >
            Try again
          </button>
        </div>
      )}

      {lastBooked && (
        <TelevisitLinkNotice
          headline={`Televisit booked for ${lastBooked.patientName} on ${formatNigerianDateTime(lastBooked.visit.scheduledAt)}.`}
          link={lastBooked.visit.meetingLink}
          delivery={deliveries[lastBooked.visit.id]}
          canSend={canManage && online}
          sendBlockedReason={
            !online ? "Sending needs the internet." : undefined
          }
          onSend={() =>
            void sendLink(lastBooked.visit, {
              announce: false,
              providerName: myName,
            })
          }
          onCopy={() => void copyLink(lastBooked.visit.meetingLink)}
          onDismiss={() => setLastBooked(null)}
        />
      )}

      {!neverLoaded && (
        <dl className="grid max-w-md grid-cols-2 gap-3">
          <div className="panel p-3">
            <dt className="section-label">Pending requests</dt>
            <dd className="text-stat tabular-nums text-ink">
              {requests.length}
            </dd>
          </div>
          <div className="panel p-3">
            <dt className="section-label">Open televisits today</dt>
            <dd className="text-stat tabular-nums text-ink">{upcomingToday}</dd>
          </div>
        </dl>
      )}

      <section className="panel overflow-hidden" aria-label="Televisits">
        <Tabs
          tabs={tabs}
          active={tab}
          onChange={(id) => {
            if (isTabKey(id)) setTab(id);
          }}
          idPrefix={TABS_PREFIX}
          label="Televisit lists"
          className="px-2"
        />
        <div
          role="tabpanel"
          id={panelId(TABS_PREFIX, tab)}
          aria-labelledby={tabId(TABS_PREFIX, tab)}
        >
          {tab === "requests" && renderRequests()}
          {tab === "upcoming" && renderUpcoming()}
          {tab === "recent" && renderRecent()}
        </div>
      </section>

      {scheduleTarget && (
        <ScheduleTelevisitDialog
          initial={scheduleTarget}
          blockedReason={blockedReasonForDialog}
          onClose={() => setScheduleTarget(null)}
          onSubmit={handleSchedule}
        />
      )}

      {cancelTarget && (
        <CancelAppointmentDialog
          title={`Cancel the televisit with ${nameOf(cancelTarget.patientId)}?`}
          summary={
            <p>
              Video visit on {formatNigerianDateTime(cancelTarget.scheduledAt)}{" "}
              ({cancelTarget.durationMinutes} min).
            </p>
          }
          consequences={[
            "It is marked Cancelled and leaves the upcoming list for all staff.",
            "The patient is not sent a message. Let them know another way.",
            "The video link is no longer shown in mBHR, but the patient may still have it by SMS.",
          ]}
          confirmLabel="Cancel televisit"
          keepLabel="Keep televisit"
          busy={busyId === cancelTarget.id}
          error={cancelError}
          onConfirm={(reason) => void confirmCancel(reason)}
          onClose={() => setCancelTarget(null)}
        />
      )}
    </div>
  );
}
