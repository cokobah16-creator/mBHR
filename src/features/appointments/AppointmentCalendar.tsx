import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useMatch } from "react-router-dom";
import {
  ArrowPathIcon,
  BellIcon,
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  VideoCameraIcon,
  WifiIcon,
} from "@heroicons/react/24/outline";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { panelId, tabId } from "@/components/ui/tabIds";
import { createAuditLog, generateId } from "@/db";
import * as logger from "@/lib/logger";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { formatNigerianDateTime, formatTime } from "@/utils/dateFormat";
import {
  checkAvailability,
  createAppointment,
  getAppointmentsInRange,
  getUpcomingAppointments,
  isAppointmentServiceConfigured,
  updateAppointmentDetails,
  type Appointment,
  type AppointmentDetailsUpdate,
} from "@/services/appointments";
import {
  STAFF_NOT_REGISTERED_MESSAGE,
  TELEVISIT_APPOINTMENT_TYPE,
  generateMeetingLink,
  getPatientContact,
  notifyPatientTelevisitScheduled,
  resolveStaffAppUserId,
  type Televisit,
} from "@/services/televisits";
import { copyText } from "@/features/televisits/clipboard";
import { TelevisitLinkNotice } from "@/features/televisits/TelevisitLinkNotice";
import {
  linkDeliveryFrom,
  type LinkDelivery,
} from "@/features/televisits/televisitModel";
import { AppointmentFormDialog } from "./AppointmentFormDialog";
import { CancelAppointmentDialog } from "./CancelAppointmentDialog";
import {
  ACTION_LABEL,
  ACTION_TARGET_STATUS,
  APPOINTMENT_STATUSES,
  APPOINTMENT_STATUS_META,
  DEFAULT_FILTERS,
  OPEN_APPOINTMENT_STATUSES,
  StaffFacingError,
  addDays,
  availableActions,
  canManageAppointments,
  dayHeading,
  describeActionError,
  filterAppointments,
  groupByDay,
  hasActiveFilters,
  isCalendarView,
  isModeFilter,
  isStatusFilter,
  notesWithCancellation,
  parseDateInput,
  rangeForView,
  reminderInfo,
  shortDayLabel,
  startOfDay,
  statusMeta,
  timeRangeLabel,
  toDateInputValue,
  type AppointmentAction,
  type AppointmentFilters,
  type AppointmentFormValues,
  type CalendarView,
} from "./appointmentModel";
import {
  loadPatientLabels,
  patientPlaceholder,
  type PatientLabel,
} from "./patientLabels";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

interface AppointmentCalendarProps {
  /** Only show and default to this provider's appointments. */
  providerId?: string;
  /** Book new appointments for this patient. */
  patientId?: string;
  /** Local id of the staff member booking; resolved to their directory id. */
  createdBy: string;
  /**
   * "page" renders the page title; "panel" suits embedding in another page.
   * Defaults to "page" on /appointments and "panel" elsewhere.
   */
  variant?: "page" | "panel";
}

type StatusAction = Exclude<AppointmentAction, "edit" | "cancel">;

type LoadState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string; keptPrevious: boolean };

type FormState =
  | { mode: "create" }
  | { mode: "edit"; appointment: Appointment };

interface LinkNoticeState {
  appointment: Appointment;
  headline: string;
  providerName?: string;
  delivery?: LinkDelivery;
  notSentMessage?: string;
}

const VIEW_TABS: TabItem<CalendarView>[] = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "upcoming", label: "Upcoming" },
];

const TABS_PREFIX = "appointments";

const isTelevisitRow = (row: Appointment) =>
  row.appointmentType === TELEVISIT_APPOINTMENT_TYPE ||
  row.visitMode === "televisit" ||
  Boolean(row.meetingLink);

const toTelevisit = (row: Appointment): Televisit => ({
  id: row.id ?? "",
  patientId: row.patientId,
  providerId: row.providerId,
  scheduledAt: row.scheduledAt,
  durationMinutes: row.durationMinutes,
  status: row.status,
  reason: row.reason,
  notes: row.notes,
  meetingLink: row.meetingLink,
  createdBy: row.createdBy,
});

const errorName = (err: unknown) =>
  err instanceof Error ? err.name : typeof err;

function ListSkeleton() {
  return (
    <div>
      <span role="status" className="sr-only">
        Loading appointments
      </span>
      <div className="divide-y divide-line" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex gap-4 px-4 py-3">
            <Skeleton className="h-4 w-20" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-48 max-w-full" />
              <Skeleton className="h-3 w-72 max-w-full" />
            </div>
            <Skeleton className="hidden h-9 w-24 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function AppointmentCalendar({
  providerId,
  patientId,
  createdBy,
  variant,
}: AppointmentCalendarProps) {
  const onOwnRoute = useMatch("/appointments") !== null;
  const asPage = variant ? variant === "page" : onOwnRoute;
  const currentUser = useAuthStore((s) => s.currentUser);
  const role = currentUser?.role;
  const userId = currentUser?.id;
  const myName = currentUser?.fullName;
  const canManage = canManageAppointments(role);
  const { push } = useToast();
  const online = useOnlineStatus();
  const configured = isAppointmentServiceConfigured();

  const [view, setView] = useState<CalendarView>("day");
  const [day, setDay] = useState(() => toDateInputValue(new Date()));
  const [filters, setFilters] = useState<AppointmentFilters>(DEFAULT_FILTERS);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [labels, setLabels] = useState<Map<string, PatientLabel>>(
    () => new Map(),
  );
  const [loadState, setLoadState] = useState<LoadState>({
    status: "loading",
  });
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [staffId, setStaffId] = useState<string | null | undefined>(undefined);
  const [form, setForm] = useState<FormState | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [linkNotice, setLinkNotice] = useState<LinkNoticeState | null>(null);
  const [now, setNow] = useState(() => new Date());
  const requestRef = useRef(0);
  const loadedKeyRef = useRef<string | null>(null);
  const wasOnline = useRef(online);

  const load = useCallback(
    async (quiet: boolean) => {
      if (!configured) return;
      const request = ++requestRef.current;
      const key = `${view}|${day}|${providerId ?? ""}`;
      // A quiet refresh keeps the list on screen only if it belongs to the
      // range being viewed; otherwise a failure must not look like "none".
      const keepShown = quiet && loadedKeyRef.current === key;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        // No request is attempted offline. The offline banner says the list
        // shown may be out of date.
        setRefreshing(false);
        if (!keepShown) {
          loadedKeyRef.current = null;
          setAppointments([]);
          setLoadState({
            status: "error",
            keptPrevious: false,
            message:
              "This device is offline, so the schedule could not be loaded. It will load when the connection returns.",
          });
        }
        return;
      }
      if (quiet) setRefreshing(true);
      else setLoadState({ status: "loading" });
      try {
        let rows: Appointment[];
        if (view === "upcoming") {
          rows = await getUpcomingAppointments(providerId);
        } else {
          const { from, to } = rangeForView(
            view,
            parseDateInput(day) ?? new Date(),
          );
          rows = await getAppointmentsInRange(from, to, providerId);
        }
        const names = await loadPatientLabels(rows.map((r) => r.patientId));
        if (request !== requestRef.current) return;
        loadedKeyRef.current = key;
        setAppointments(rows);
        setLabels(names);
        setLoadedAt(new Date());
        setLoadState({ status: "ready" });
      } catch (err) {
        if (request !== requestRef.current) return;
        logger.error("[AppointmentCalendar] Load failed:", errorName(err));
        const offline =
          typeof navigator !== "undefined" && navigator.onLine === false;
        if (!keepShown) {
          loadedKeyRef.current = null;
          setAppointments([]);
        }
        setLoadState({
          status: "error",
          keptPrevious: keepShown,
          message: offline
            ? "This device is offline, so the schedule could not be loaded. It will load again when the connection returns."
            : "The schedule could not be loaded from the online service. Check the connection, then try again.",
        });
      } finally {
        if (request === requestRef.current) setRefreshing(false);
      }
    },
    [configured, view, day, providerId],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  // Reload when the connection comes back.
  useEffect(() => {
    if (online && !wasOnline.current) void load(true);
    wasOnline.current = online;
  }, [online, load]);

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(tick);
  }, []);

  // Appointments must be owned by a staff member in the online directory.
  useEffect(() => {
    if (!configured || !online || !canManage) return;
    let active = true;
    resolveStaffAppUserId(createdBy || userId)
      .then((id) => {
        if (active) setStaffId(id);
      })
      .catch((err) => {
        logger.warn(
          "[AppointmentCalendar] Staff directory check failed:",
          errorName(err),
        );
      });
    return () => {
      active = false;
    };
  }, [configured, online, canManage, createdBy, userId]);

  const nameOf = useCallback(
    (id: string) => labels.get(id)?.name || patientPlaceholder(id),
    [labels],
  );

  const visible = useMemo(
    () =>
      filterAppointments(appointments, filters, {
        isTelevisit: isTelevisitRow,
        nameOf,
      }),
    [appointments, filters, nameOf],
  );
  const groups = useMemo(() => groupByDay(visible), [visible]);

  const anchor = parseDateInput(day) ?? startOfDay(new Date());
  const todayKey = toDateInputValue(now);

  const notify = (
    tone: "success" | "info" | "warning" | "error",
    title: string,
    body?: string,
  ) => push({ id: generateId(), tone, title, body });

  const audit = (action: string, entityId: string) => {
    if (!role) return;
    void createAuditLog(role, action, "appointment", entityId).catch(
      () => undefined,
    );
  };

  // Permission and connection are checked here, before every write, not
  // only by hiding buttons.
  const writeBlockReason = (): string | null => {
    if (!canManageAppointments(useAuthStore.getState().currentUser?.role)) {
      return "Your role can view appointments but not change them.";
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return "This device is offline and appointments are saved online. Nothing was changed; connect to the internet, then try again.";
    }
    return null;
  };

  const assertCanWrite = (): boolean => {
    const reason = writeBlockReason();
    if (reason) notify("warning", "Nothing was changed", reason);
    return reason === null;
  };

  const providerNameFor = (id?: string, hint?: string) =>
    hint ?? (id && id === staffId ? myName : undefined);

  const sendLink = async (
    row: Appointment,
    providerName?: string,
  ): Promise<LinkDelivery> => {
    try {
      const contact = await getPatientContact(row.patientId);
      if (!contact) return linkDeliveryFrom({ kind: "no-contact" }, new Date());
      const result = await notifyPatientTelevisitScheduled(
        toTelevisit(row),
        contact,
        providerNameFor(row.providerId, providerName),
      );
      return linkDeliveryFrom(
        {
          kind: "result",
          sent: result.sent,
          error: result.error,
          to: contact.fullName || nameOf(row.patientId),
        },
        new Date(),
      );
    } catch (err) {
      return linkDeliveryFrom(
        {
          kind: "result",
          sent: false,
          error: err instanceof Error ? err.message : undefined,
          to: "",
        },
        new Date(),
      );
    }
  };

  const deliverLink = async (row: Appointment, providerName?: string) => {
    setLinkNotice((n) =>
      n && n.appointment.id === row.id
        ? { ...n, delivery: { state: "sending" } }
        : n,
    );
    const delivery = await sendLink(row, providerName);
    setLinkNotice((n) =>
      n && n.appointment.id === row.id ? { ...n, delivery } : n,
    );
  };

  const resendFromNotice = () => {
    if (!linkNotice || !assertCanWrite()) return;
    void deliverLink(linkNotice.appointment, linkNotice.providerName);
  };

  const copyLink = async (link?: string) => {
    if (!link) return;
    const ok = await copyText(link);
    if (ok) notify("success", "Link copied");
    else
      notify("warning", "Could not copy the link", `Copy it by hand: ${link}`);
  };

  /** Reload quietly, or move the day view to where the change landed. */
  const showAfterChange = (scheduledAt: Date) => {
    if (view !== "upcoming") {
      const { from, to } = rangeForView(view, anchor);
      if (scheduledAt < from || scheduledAt >= to) {
        setDay(toDateInputValue(scheduledAt));
        return;
      }
    }
    void load(true);
  };

  const requireStaffId = async (): Promise<string> => {
    const id = staffId ?? (await resolveStaffAppUserId(createdBy || userId));
    if (!id) throw new StaffFacingError(STAFF_NOT_REGISTERED_MESSAGE);
    if (id !== staffId) setStaffId(id);
    return id;
  };

  const handleCreate = async (values: AppointmentFormValues) => {
    const blocked = writeBlockReason();
    if (blocked) throw new StaffFacingError(blocked);
    const ownerId = await requireStaffId();
    const free = await checkAvailability(
      values.providerId,
      values.scheduledAt,
      values.durationMinutes,
    );
    if (!free) {
      throw new StaffFacingError(
        "The provider already has an appointment at that time. Choose another time or provider.",
      );
    }

    const televisit = values.appointmentType === TELEVISIT_APPOINTMENT_TYPE;
    const meetingLink = televisit ? generateMeetingLink() : undefined;
    const reason = values.reason || undefined;
    const id = await createAppointment({
      patientId: values.patientId,
      providerId: values.providerId,
      appointmentType: values.appointmentType,
      scheduledAt: values.scheduledAt,
      durationMinutes: values.durationMinutes,
      status: "scheduled",
      reason,
      createdBy: ownerId,
      ...(televisit ? { visitMode: "televisit" as const, meetingLink } : {}),
    });
    audit("appointment_created", id);
    setForm(null);

    const patientName = values.patientName || nameOf(values.patientId);
    const when = formatNigerianDateTime(values.scheduledAt);
    notify(
      "success",
      televisit ? "Televisit booked" : "Appointment booked",
      `${patientName} · ${values.appointmentType} · ${when}`,
    );

    if (televisit) {
      const row: Appointment = {
        id,
        patientId: values.patientId,
        providerId: values.providerId,
        appointmentType: values.appointmentType,
        scheduledAt: values.scheduledAt,
        durationMinutes: values.durationMinutes,
        status: "scheduled",
        reason,
        createdBy: ownerId,
        visitMode: "televisit",
        meetingLink,
      };
      setLinkNotice({
        appointment: row,
        headline: `Televisit booked for ${patientName} on ${when}.`,
        providerName: values.providerName,
        delivery: { state: "sending" },
      });
      void deliverLink(row, values.providerName);
    }
    showAfterChange(values.scheduledAt);
  };

  const handleEdit = async (
    original: Appointment,
    values: AppointmentFormValues,
  ) => {
    const blocked = writeBlockReason();
    if (blocked) throw new StaffFacingError(blocked);
    if (!original.id) {
      throw new StaffFacingError(
        "This appointment has no record ID, so it cannot be changed.",
      );
    }
    const startChanged =
      original.scheduledAt.getTime() !== values.scheduledAt.getTime();
    const slotChanged =
      startChanged || original.durationMinutes !== values.durationMinutes;
    const providerChanged = (original.providerId ?? "") !== values.providerId;
    if (slotChanged || providerChanged) {
      const free = await checkAvailability(
        values.providerId,
        values.scheduledAt,
        values.durationMinutes,
        original.id,
      );
      if (!free) {
        throw new StaffFacingError(
          "The provider already has an appointment at that time. Choose another time or provider.",
        );
      }
    }

    const wasTelevisit = isTelevisitRow(original);
    const isTelevisit =
      values.appointmentType === TELEVISIT_APPOINTMENT_TYPE ||
      (wasTelevisit && values.appointmentType === original.appointmentType);
    // A confirmation was for the old time.
    const resetConfirmation = startChanged && original.status === "confirmed";

    const changes: AppointmentDetailsUpdate = {
      providerId: values.providerId,
      appointmentType: values.appointmentType,
      scheduledAt: values.scheduledAt,
      durationMinutes: values.durationMinutes,
      reason: values.reason || null,
    };
    if (resetConfirmation) changes.status = "scheduled";
    let meetingLink = original.meetingLink;
    if (isTelevisit && !meetingLink) {
      meetingLink = generateMeetingLink();
      changes.meetingLink = meetingLink;
      changes.visitMode = "televisit";
    } else if (isTelevisit && original.visitMode !== "televisit") {
      changes.visitMode = "televisit";
    } else if (!isTelevisit && wasTelevisit) {
      meetingLink = undefined;
      changes.meetingLink = null;
      changes.visitMode = "in_person";
    }

    await updateAppointmentDetails(original.id, changes);
    audit("appointment_updated", original.id);
    setForm(null);

    const patientName = nameOf(original.patientId);
    const when = formatNigerianDateTime(values.scheduledAt);
    // Televisit changes get the link notice below; say plainly when the
    // patient still needs to be told about any other change.
    const followUps: string[] = [];
    if (resetConfirmation) {
      followUps.push(
        "Status is back to Scheduled until the patient confirms the new time.",
      );
    }
    if (!isTelevisit && wasTelevisit) {
      followUps.push(
        "It is now in person and the video link was removed; let the patient know.",
      );
    } else if (!isTelevisit && startChanged) {
      followUps.push("The patient is not told of the new time automatically.");
    }
    notify(
      "success",
      "Appointment updated",
      [`${patientName} · ${values.appointmentType} · ${when}.`, ...followUps].join(
        " ",
      ),
    );

    if (isTelevisit && (startChanged || !wasTelevisit)) {
      setLinkNotice({
        appointment: {
          ...original,
          providerId: values.providerId,
          appointmentType: values.appointmentType,
          scheduledAt: values.scheduledAt,
          durationMinutes: values.durationMinutes,
          reason: values.reason || undefined,
          status: resetConfirmation ? "scheduled" : original.status,
          visitMode: "televisit",
          meetingLink,
        },
        headline: wasTelevisit
          ? `Televisit for ${patientName} moved to ${when}.`
          : `The appointment for ${patientName} on ${when} is now a televisit.`,
        providerName: values.providerName,
        notSentMessage:
          "The patient has not been sent the new details. Send the link by SMS or share it another way.",
      });
    } else if (linkNotice?.appointment.id === original.id) {
      setLinkNotice(null);
    }
    showAfterChange(values.scheduledAt);
  };

  const changeStatus = async (row: Appointment, action: StatusAction) => {
    if (!row.id || !assertCanWrite()) return;
    const target = ACTION_TARGET_STATUS[action];
    setBusyId(row.id);
    try {
      await updateAppointmentDetails(row.id, { status: target });
      audit(`appointment_${target}`, row.id);
      notify(
        "success",
        `${statusMeta(target).label}: ${nameOf(row.patientId)}`,
        `${row.appointmentType} · ${formatNigerianDateTime(row.scheduledAt)}`,
      );
      await load(true);
    } catch (err) {
      notify(
        "error",
        "Status not changed",
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
    const row = cancelTarget;
    if (!row?.id) return;
    // Shown inside the dialog: a toast would sit behind the modal.
    const blocked = writeBlockReason();
    if (blocked) {
      setCancelError(blocked);
      return;
    }
    setBusyId(row.id);
    setCancelError(null);
    try {
      const notes = notesWithCancellation(row.notes, reason);
      await updateAppointmentDetails(
        row.id,
        notes ? { status: "cancelled", notes } : { status: "cancelled" },
      );
      audit("appointment_cancelled", row.id);
      setCancelTarget(null);
      if (linkNotice?.appointment.id === row.id) setLinkNotice(null);
      notify(
        "success",
        "Appointment cancelled",
        `${nameOf(row.patientId)} · ${formatNigerianDateTime(row.scheduledAt)}. The patient has not been told; let them know.`,
      );
      await load(true);
    } catch (err) {
      setCancelError(
        describeActionError(
          err,
          "The appointment was not cancelled. Check the connection, then try again.",
        ),
      );
    } finally {
      setBusyId(null);
    }
  };

  const shift = (direction: -1 | 1) =>
    setDay(
      toDateInputValue(addDays(anchor, direction * (view === "week" ? 7 : 1))),
    );

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  const writeBlocked = !canManage || !online || staffId === null;
  const showingList =
    loadState.status === "ready" ||
    (loadState.status === "error" && loadState.keptPrevious);

  const bookButton = canManage ? (
    <button
      type="button"
      className="btn-primary"
      onClick={() => setForm({ mode: "create" })}
      disabled={!configured || staffId === null}
    >
      <PlusIcon className="h-5 w-5" aria-hidden />
      Book appointment
    </button>
  ) : null;

  const rangeLabel = (() => {
    if (view === "upcoming") {
      return "Scheduled and confirmed appointments from now on";
    }
    if (view === "day") return dayHeading(anchor, now);
    const { from, to } = rangeForView("week", anchor);
    const last = addDays(to, -1);
    return `Week of ${shortDayLabel(from)} – ${shortDayLabel(last)} ${last.getFullYear()}`;
  })();

  const summary = (() => {
    if (loadState.status === "loading") return "Loading…";
    if (loadState.status === "error" && !loadState.keptPrevious) return "";
    const total = appointments.length;
    const noun = (n: number) => `${n} appointment${n === 1 ? "" : "s"}`;
    return hasActiveFilters(filters)
      ? `Showing ${visible.length} of ${noun(total)}`
      : noun(total);
  })();

  const renderAction = (row: Appointment, action: AppointmentAction) => {
    const name = nameOf(row.patientId);
    const disabled = writeBlocked || busyId === row.id || !row.id;
    const aria = `${ACTION_LABEL[action]}: ${name}, ${formatTime(row.scheduledAt)}`;
    if (action === "edit") {
      return (
        <button
          key={action}
          type="button"
          className="btn-ghost disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          aria-label={aria}
          onClick={() => setForm({ mode: "edit", appointment: row })}
        >
          <PencilSquareIcon className="h-4 w-4" aria-hidden />
          {ACTION_LABEL[action]}
        </button>
      );
    }
    if (action === "cancel") {
      return (
        <button
          key={action}
          type="button"
          className="btn-ghost text-danger-fg hover:text-danger-fg disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          aria-label={aria}
          onClick={() => {
            setCancelError(null);
            setCancelTarget(row);
          }}
        >
          {ACTION_LABEL[action]}
        </button>
      );
    }
    return (
      <button
        key={action}
        type="button"
        className={
          action === "no-show"
            ? "btn-ghost disabled:cursor-not-allowed disabled:opacity-50"
            : "btn-secondary px-3"
        }
        disabled={disabled}
        aria-label={aria}
        onClick={() => void changeStatus(row, action)}
      >
        {ACTION_LABEL[action]}
      </button>
    );
  };

  const renderRow = (row: Appointment) => {
    const meta = statusMeta(row.status);
    const televisit = isTelevisitRow(row);
    const reminder = reminderInfo(row);
    const label = labels.get(row.patientId);
    const name = label?.name || patientPlaceholder(row.patientId);
    const hasStarted = row.scheduledAt.getTime() <= now.getTime();
    const actions = canManage
      ? availableActions(row.status, hasStarted, { televisit })
      : [];
    const showLink =
      televisit &&
      row.meetingLink &&
      OPEN_APPOINTMENT_STATUSES.includes(row.status);

    return (
      <li
        key={row.id ?? `${row.patientId}-${row.scheduledAt.toISOString()}`}
        className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-start"
      >
        <div className="flex shrink-0 items-baseline gap-2 md:block md:w-28">
          <p className="text-body font-semibold tabular-nums text-ink">
            {timeRangeLabel(row)}
          </p>
          <p className="text-caption text-ink-muted">
            {row.durationMinutes} min
          </p>
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {label?.onDevice ? (
              <Link
                to={`/patients/${row.patientId}`}
                className="font-medium text-primary-fg underline decoration-primary-line underline-offset-2 hover:decoration-primary-fg"
              >
                {name}
              </Link>
            ) : (
              <span className="font-medium text-ink">{name}</span>
            )}
            <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
            {televisit && (
              <StatusBadge tone="neutral" icon={false}>
                <VideoCameraIcon className="h-3.5 w-3.5" aria-hidden />
                Video
              </StatusBadge>
            )}
          </div>
          <p className="text-body text-ink-secondary">
            {row.appointmentType}
            {row.reason ? ` · ${row.reason}` : ""}
          </p>
          <p className="flex items-start gap-1.5 text-caption text-ink-muted">
            <BellIcon className="h-4 w-4 shrink-0" aria-hidden />
            <span>
              {reminder.label}
              {reminder.detail ? ` · ${reminder.detail}` : ""}
            </span>
          </p>
          {showLink && (
            <div className="flex flex-wrap items-center gap-x-3 text-caption">
              <a
                href={row.meetingLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-touch-target items-center gap-1 font-medium text-primary-fg hover:underline"
              >
                <VideoCameraIcon className="h-4 w-4" aria-hidden />
                Open video link
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              <button
                type="button"
                className="btn-ghost px-2 text-caption"
                onClick={() => void copyLink(row.meetingLink)}
                aria-label={`Copy link: video link for ${name}`}
              >
                Copy link
              </button>
              {!online && (
                <span className="text-ink-muted">
                  Joining needs the internet.
                </span>
              )}
            </div>
          )}
        </div>

        {actions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 md:max-w-xs md:justify-end">
            {busyId === row.id && (
              <span className="text-caption text-ink-muted">Saving…</span>
            )}
            {actions.map((action) => renderAction(row, action))}
          </div>
        )}
      </li>
    );
  };

  // One h1 per page: day headings sit under it on the page, under the
  // panel's h2 when embedded.
  const DayHeading = asPage ? "h2" : "h3";

  const listBody = (() => {
    if (loadState.status === "loading") return <ListSkeleton />;
    if (loadState.status === "error" && !loadState.keptPrevious) {
      return (
        <EmptyState
          icon={ExclamationTriangleIcon}
          title="Schedule not loaded"
          description={loadState.message}
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
    if (appointments.length === 0) {
      return (
        <EmptyState
          icon={CalendarDaysIcon}
          title={
            view === "upcoming"
              ? "No upcoming appointments"
              : view === "week"
                ? "No appointments this week"
                : "No appointments on this day"
          }
          description={
            canManage
              ? "Book one with “Book appointment”."
              : "Appointments booked by clinic staff appear here."
          }
        />
      );
    }
    if (visible.length === 0) {
      return (
        <EmptyState
          icon={MagnifyingGlassIcon}
          title="No appointments match these filters"
          action={
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setFilters(DEFAULT_FILTERS)}
            >
              Clear filters
            </button>
          }
        />
      );
    }
    if (view === "day") {
      return (
        <ul className="divide-y divide-line" aria-label={rangeLabel}>
          {visible.map(renderRow)}
        </ul>
      );
    }
    return groups.map((group) => (
      <section
        key={group.key}
        aria-labelledby={`appointments-day-${group.key}`}
      >
        <DayHeading
          id={`appointments-day-${group.key}`}
          className="section-label border-b border-t border-line bg-surface-sunken px-4 py-2"
        >
          {dayHeading(group.date, now)} · {group.items.length}
        </DayHeading>
        <ul className="divide-y divide-line">{group.items.map(renderRow)}</ul>
      </section>
    ));
  })();

  const banners = (
    <>
      {!online && (
        <div className="banner banner-warning" role="status">
          <WifiIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <span>
            {loadedAt && showingList
              ? `This device is offline. The schedule below was loaded at ${formatTime(loadedAt)} and may be out of date. Booking and status changes need the internet.`
              : "This device is offline. Appointments are stored online, so the schedule will load when the connection returns."}
          </span>
        </div>
      )}
      {!canManage && (
        <div className="banner banner-info" role="note">
          <InformationCircleIcon
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden
          />
          <span>
            You can view appointments. Booking and changing them needs a
            volunteer, nurse, doctor or admin account.
          </span>
        </div>
      )}
      {canManage && staffId === null && (
        <div className="banner banner-warning" role="status">
          <ExclamationTriangleIcon
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden
          />
          <span>
            {STAFF_NOT_REGISTERED_MESSAGE} Until then the schedule may also be
            incomplete.
          </span>
        </div>
      )}
      {loadState.status === "error" && loadState.keptPrevious && (
        <div className="banner banner-warning" role="alert">
          <ExclamationTriangleIcon
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p>
              {loadState.message}
              {loadedAt
                ? ` Showing the list loaded at ${formatTime(loadedAt)}.`
                : ""}
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary px-3"
            onClick={() => void load(true)}
          >
            Try again
          </button>
        </div>
      )}
      {linkNotice && (
        <TelevisitLinkNotice
          headline={linkNotice.headline}
          link={linkNotice.appointment.meetingLink}
          delivery={linkNotice.delivery}
          notSentMessage={linkNotice.notSentMessage}
          canSend={canManage && online}
          sendBlockedReason={
            !canManage
              ? "Your role cannot send messages to patients."
              : !online
                ? "Sending needs the internet."
                : undefined
          }
          onSend={resendFromNotice}
          onCopy={() => void copyLink(linkNotice.appointment.meetingLink)}
          onDismiss={() => setLinkNotice(null)}
        />
      )}
    </>
  );

  const schedule = (
    <>
      <Tabs
        tabs={VIEW_TABS}
        active={view}
        onChange={(id) => {
          if (isCalendarView(id)) setView(id);
        }}
        idPrefix={TABS_PREFIX}
        label="Schedule view"
        className="px-2"
      />
      <div
        role="tabpanel"
        id={panelId(TABS_PREFIX, view)}
        aria-labelledby={tabId(TABS_PREFIX, view)}
      >
        <div className="flex flex-col gap-3 border-b border-line p-3 xl:flex-row xl:items-end xl:justify-between">
          {view === "upcoming" ? (
            <p className="text-body text-ink-secondary xl:self-center">
              {rangeLabel}
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <button
                type="button"
                className="btn-secondary px-3"
                onClick={() => shift(-1)}
                aria-label={view === "week" ? "Previous week" : "Previous day"}
              >
                <ChevronLeftIcon className="h-5 w-5" aria-hidden />
              </button>
              <div>
                <label htmlFor="appointments-date" className="field-label">
                  {view === "week" ? "Week containing" : "Date"}
                </label>
                <input
                  id="appointments-date"
                  type="date"
                  className="input-field w-auto"
                  value={day}
                  onChange={(e) => {
                    if (parseDateInput(e.target.value)) setDay(e.target.value);
                  }}
                />
              </div>
              <button
                type="button"
                className="btn-secondary px-3"
                onClick={() => shift(1)}
                aria-label={view === "week" ? "Next week" : "Next day"}
              >
                <ChevronRightIcon className="h-5 w-5" aria-hidden />
              </button>
              <button
                type="button"
                className="btn-ghost disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => setDay(todayKey)}
                disabled={day === todayKey}
              >
                Today
              </button>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-3 xl:w-[36rem]">
            <div>
              <label htmlFor="appointments-status" className="field-label">
                Status
              </label>
              <select
                id="appointments-status"
                className="input-field"
                value={filters.status}
                onChange={(e) => {
                  const value = e.target.value;
                  if (isStatusFilter(value)) {
                    setFilters((f) => ({ ...f, status: value }));
                  }
                }}
              >
                <option value="all">All statuses</option>
                <option value="open">Not finished</option>
                {APPOINTMENT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {APPOINTMENT_STATUS_META[status].label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="appointments-mode" className="field-label">
                Visit type
              </label>
              <select
                id="appointments-mode"
                className="input-field"
                value={filters.mode}
                onChange={(e) => {
                  const value = e.target.value;
                  if (isModeFilter(value)) {
                    setFilters((f) => ({ ...f, mode: value }));
                  }
                }}
              >
                <option value="all">All visits</option>
                <option value="in_person">In person</option>
                <option value="televisit">Video (televisit)</option>
              </select>
            </div>
            <div>
              <label htmlFor="appointments-search" className="field-label">
                Search
              </label>
              <input
                id="appointments-search"
                type="search"
                className="input-field"
                placeholder="Patient, type or reason"
                value={filters.query}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, query: e.target.value }))
                }
              />
            </div>
          </div>
        </div>

        <div
          className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-caption text-ink-muted"
          aria-live="polite"
        >
          <span>
            {view === "day" ? "" : `${rangeLabel} · `}
            {summary}
          </span>
          {refreshing && (
            <span className="flex items-center gap-1">
              <ArrowPathIcon className="h-4 w-4" aria-hidden />
              Updating…
            </span>
          )}
        </div>
        {view === "day" && (
          <DayHeading className="section-label border-b border-t border-line bg-surface-sunken px-4 py-2">
            {rangeLabel}
          </DayHeading>
        )}
        {listBody}
      </div>
    </>
  );

  const notConfigured = (
    <div className="banner banner-info" role="status">
      <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div>
        <p className="font-medium">
          Appointments are not available on this device
        </p>
        <p>
          Appointments are stored in the online service, which is not set up in
          this installation. Registration, vitals, consultation and pharmacy
          keep working offline.
        </p>
      </div>
    </div>
  );

  const dialogs = (
    <>
      {form && (
        <AppointmentFormDialog
          mode={form.mode}
          appointment={form.mode === "edit" ? form.appointment : undefined}
          fixedPatient={
            form.mode === "edit"
              ? {
                  id: form.appointment.patientId,
                  name: nameOf(form.appointment.patientId),
                }
              : patientId
                ? { id: patientId, name: nameOf(patientId) }
                : undefined
          }
          myProviderId={staffId}
          myName={myName}
          defaultProviderId={providerId}
          online={online}
          onClose={() => setForm(null)}
          onSubmit={(values) =>
            form.mode === "edit"
              ? handleEdit(form.appointment, values)
              : handleCreate(values)
          }
        />
      )}
      {cancelTarget && (
        <CancelAppointmentDialog
          title={`Cancel the appointment for ${nameOf(cancelTarget.patientId)}?`}
          summary={
            <p>
              {cancelTarget.appointmentType} on{" "}
              {formatNigerianDateTime(cancelTarget.scheduledAt)} (
              {cancelTarget.durationMinutes} min).
            </p>
          }
          consequences={[
            "It is marked Cancelled in the online schedule for all staff.",
            "The patient is not sent a message. Let them know another way.",
            ...(isTelevisitRow(cancelTarget)
              ? [
                  "The video link is no longer shown in mBHR, but the patient may still have it by SMS.",
                ]
              : []),
          ]}
          busy={busyId === cancelTarget.id}
          error={cancelError}
          onConfirm={(reason) => void confirmCancel(reason)}
          onClose={() => setCancelTarget(null)}
        />
      )}
    </>
  );

  if (asPage) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Appointments"
          description="Booked visits, follow-ups and televisits. The schedule is stored online, so changes need an internet connection."
          actions={configured ? bookButton : null}
        />
        {configured ? (
          <>
            {banners}
            <section className="panel overflow-hidden" aria-label="Schedule">
              {schedule}
            </section>
          </>
        ) : (
          notConfigured
        )}
        {dialogs}
      </div>
    );
  }

  return (
    <section
      className="panel overflow-hidden"
      aria-labelledby="appointments-panel-title"
    >
      <div className="panel-header">
        <h2
          id="appointments-panel-title"
          className="panel-title flex items-center gap-2"
        >
          <CalendarDaysIcon className="h-5 w-5 text-ink-muted" aria-hidden />
          Appointments
        </h2>
        {configured && bookButton}
      </div>
      {configured ? (
        <>
          <div className="space-y-3 px-4 pt-4 empty:hidden">{banners}</div>
          {schedule}
        </>
      ) : (
        <div className="p-4">{notConfigured}</div>
      )}
      {dialogs}
    </section>
  );
}
