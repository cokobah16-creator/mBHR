// Pure helpers for the appointment schedule: status labels, reminder state,
// date ranges, grouping and filtering. No I/O here, so it is unit-tested
// directly (appointmentModel.test.ts).
import { can, type Role } from "@/auth/roles";
import type { Tone } from "@/components/ui/StatusBadge";
import type { Appointment } from "@/services/appointments";
import { formatNigerianDateTime, formatTime } from "@/utils/dateFormat";

export type AppointmentStatus = Appointment["status"];

/** Every status the appointments table accepts, in workflow order. */
export const APPOINTMENT_STATUSES: AppointmentStatus[] = [
  "scheduled",
  "confirmed",
  "arrived",
  "in-progress",
  "completed",
  "no-show",
  "cancelled",
];

export const APPOINTMENT_STATUS_META: Record<
  AppointmentStatus,
  { label: string; tone: Tone }
> = {
  scheduled: { label: "Scheduled", tone: "neutral" },
  confirmed: { label: "Confirmed", tone: "info" },
  arrived: { label: "Checked in", tone: "info" },
  "in-progress": { label: "In progress", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  "no-show": { label: "No-show", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/** Statuses that still need something to happen. */
export const OPEN_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  "scheduled",
  "confirmed",
  "arrived",
  "in-progress",
];

export function statusMeta(status: string): { label: string; tone: Tone } {
  return (
    APPOINTMENT_STATUS_META[status as AppointmentStatus] ?? {
      label: status,
      tone: "neutral",
    }
  );
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/**
 * Booking, editing and changing the status of appointments is front-desk
 * work: the same staff who may register patients (volunteer, nurse, doctor,
 * lead clinician, admin). Everyone else sees the schedule read-only.
 */
export function canManageAppointments(role: Role | null | undefined): boolean {
  return !!role && can(role, "register");
}

// ---------------------------------------------------------------------------
// Status actions
// ---------------------------------------------------------------------------

export type AppointmentAction =
  | "confirm"
  | "check-in"
  | "start"
  | "complete"
  | "no-show"
  | "edit"
  | "cancel";

export const ACTION_TARGET_STATUS: Record<
  Exclude<AppointmentAction, "edit">,
  AppointmentStatus
> = {
  confirm: "confirmed",
  "check-in": "arrived",
  start: "in-progress",
  complete: "completed",
  "no-show": "no-show",
  cancel: "cancelled",
};

export const ACTION_LABEL: Record<AppointmentAction, string> = {
  confirm: "Confirm",
  "check-in": "Check in",
  start: "Start",
  complete: "Complete",
  "no-show": "Mark no-show",
  edit: "Edit",
  cancel: "Cancel",
};

/**
 * Next steps offered for an appointment. `hasStarted` is true once the
 * scheduled start time has passed; only then can it be marked a no-show.
 * Televisits skip "Check in": a checked-in (arrived) televisit leaves the
 * televisit list and can no longer be joined, so a confirmed televisit
 * goes straight to Start.
 */
export function availableActions(
  status: AppointmentStatus,
  hasStarted: boolean,
  options: { televisit?: boolean } = {},
): AppointmentAction[] {
  const arrive: AppointmentAction = options.televisit ? "start" : "check-in";
  switch (status) {
    case "scheduled":
      return hasStarted
        ? ["confirm", "no-show", "edit", "cancel"]
        : ["confirm", "edit", "cancel"];
    case "confirmed":
      return hasStarted
        ? [arrive, "no-show", "edit", "cancel"]
        : [arrive, "edit", "cancel"];
    case "arrived":
      return ["start"];
    case "in-progress":
      return ["complete"];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

export type ReminderState = "queued" | "not-sent" | "unknown";

export interface ReminderInfo {
  state: ReminderState;
  label: string;
  detail?: string;
}

/**
 * The appointments table only records that a reminder was handed to the SMS
 * service (reminder_sent / reminder_sent_at). Delivery to the phone is not
 * tracked, so a recorded reminder is shown as "queued", never "sent".
 */
export function reminderInfo(
  appointment: Pick<Appointment, "reminderSent" | "reminderSentAt">,
): ReminderInfo {
  if (appointment.reminderSent === true) {
    const at = appointment.reminderSentAt
      ? formatNigerianDateTime(appointment.reminderSentAt)
      : "";
    return {
      state: "queued",
      label: at ? `Reminder queued ${at}` : "Reminder queued",
      detail: "Delivery to the phone is not tracked.",
    };
  }
  if (appointment.reminderSent === false) {
    return { state: "not-sent", label: "Reminder not sent" };
  }
  return { state: "unknown", label: "No reminder recorded" };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Weeks start on Monday. */
export function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  const offset = (d.getDay() + 6) % 7;
  return addDays(d, -offset);
}

/** Local calendar day as YYYY-MM-DD (the value a date input uses). */
export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Local date and time as YYYY-MM-DDTHH:mm (the value datetime-local uses). */
export function toDateTimeInputValue(date: Date): string {
  return `${toDateInputValue(date)}T${formatTime(date)}`;
}

/** Parses YYYY-MM-DD as local midnight; null when the value is invalid. */
export function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return isNaN(date.getTime()) ? null : date;
}

export type CalendarView = "day" | "week" | "upcoming";

export function isCalendarView(value: string): value is CalendarView {
  return value === "day" || value === "week" || value === "upcoming";
}

/** Half-open range [from, to) covered by a day or week view. */
export function rangeForView(
  view: "day" | "week",
  anchor: Date,
): { from: Date; to: Date } {
  if (view === "day") {
    const from = startOfDay(anchor);
    return { from, to: addDays(from, 1) };
  }
  const from = startOfWeek(anchor);
  return { from, to: addDays(from, 7) };
}

export function appointmentEnd(
  appointment: Pick<Appointment, "scheduledAt" | "durationMinutes">,
): Date {
  return new Date(
    appointment.scheduledAt.getTime() + appointment.durationMinutes * 60000,
  );
}

export function timeRangeLabel(
  appointment: Pick<Appointment, "scheduledAt" | "durationMinutes">,
): string {
  return `${formatTime(appointment.scheduledAt)}–${formatTime(appointmentEnd(appointment))}`;
}

export function dayHeading(date: Date, today: Date = new Date()): string {
  const label = date.toLocaleDateString("en-NG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const diff = Math.round(
    (startOfDay(date).getTime() - startOfDay(today).getTime()) / 86400000,
  );
  if (diff === 0) return `Today · ${label}`;
  if (diff === 1) return `Tomorrow · ${label}`;
  if (diff === -1) return `Yesterday · ${label}`;
  return label;
}

export function shortDayLabel(date: Date): string {
  return date.toLocaleDateString("en-NG", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

// ---------------------------------------------------------------------------
// Booking form
// ---------------------------------------------------------------------------

/** What the booking/edit form hands back once its fields are valid. */
export interface AppointmentFormValues {
  patientId: string;
  patientName: string;
  providerId: string;
  /** Name for the SMS ("your video visit with …"), when known. */
  providerName?: string;
  appointmentType: string;
  scheduledAt: Date;
  durationMinutes: number;
  reason: string;
}

export const APPOINTMENT_DURATIONS: { minutes: number; label: string }[] = [
  { minutes: 15, label: "15 minutes" },
  { minutes: 30, label: "30 minutes" },
  { minutes: 45, label: "45 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 90, label: "1.5 hours" },
  { minutes: 120, label: "2 hours" },
];

// ---------------------------------------------------------------------------
// Grouping and filtering
// ---------------------------------------------------------------------------

export interface DayGroup<T> {
  key: string;
  date: Date;
  items: T[];
}

/** Groups by local calendar day, earliest day and time first. */
export function groupByDay<T extends Pick<Appointment, "scheduledAt">>(
  items: T[],
): DayGroup<T>[] {
  const groups = new Map<string, DayGroup<T>>();
  const sorted = [...items].sort(
    (a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime(),
  );
  for (const item of sorted) {
    const key = toDateInputValue(item.scheduledAt);
    let group = groups.get(key);
    if (!group) {
      group = { key, date: startOfDay(item.scheduledAt), items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  return Array.from(groups.values());
}

export type StatusFilter = "all" | "open" | AppointmentStatus;
export type ModeFilter = "all" | "in_person" | "televisit";

export interface AppointmentFilters {
  status: StatusFilter;
  mode: ModeFilter;
  query: string;
}

export const DEFAULT_FILTERS: AppointmentFilters = {
  status: "all",
  mode: "all",
  query: "",
};

export function isStatusFilter(value: string): value is StatusFilter {
  return (
    value === "all" ||
    value === "open" ||
    (APPOINTMENT_STATUSES as string[]).includes(value)
  );
}

export function isModeFilter(value: string): value is ModeFilter {
  return value === "all" || value === "in_person" || value === "televisit";
}

export function filterAppointments<T extends Appointment>(
  items: T[],
  filters: AppointmentFilters,
  options: {
    isTelevisit: (item: T) => boolean;
    nameOf: (patientId: string) => string;
  },
): T[] {
  const query = filters.query.trim().toLowerCase();
  return items.filter((item) => {
    if (filters.status === "open") {
      if (!OPEN_APPOINTMENT_STATUSES.includes(item.status)) return false;
    } else if (filters.status !== "all" && item.status !== filters.status) {
      return false;
    }
    if (filters.mode !== "all") {
      const televisit = options.isTelevisit(item);
      if (filters.mode === "televisit" ? !televisit : televisit) return false;
    }
    if (query) {
      const haystack = [
        options.nameOf(item.patientId),
        item.appointmentType,
        item.reason ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export function hasActiveFilters(filters: AppointmentFilters): boolean {
  return (
    filters.status !== "all" ||
    filters.mode !== "all" ||
    filters.query.trim() !== ""
  );
}

/**
 * Cancellation keeps any existing notes and appends the reason, because the
 * service stores the reason in the notes column.
 */
export function notesWithCancellation(
  existing: string | undefined,
  reason: string,
): string | undefined {
  const trimmed = reason.trim();
  if (!trimmed) return undefined;
  const line = `Cancelled: ${trimmed}`;
  return existing && existing.trim() ? `${existing.trim()}\n${line}` : line;
}

// ---------------------------------------------------------------------------
// Errors shown to staff
// ---------------------------------------------------------------------------

/** An error whose message is written for staff and can be shown as is. */
export class StaffFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaffFacingError";
  }
}

// Service messages that are already written for staff. Anything else (raw
// database or network errors) is replaced by the caller's fallback.
const READABLE_ERRORS = [
  /not registered in the online staff directory/i,
  /already has an appointment/i,
  /no longer pending/i,
  /must be in the future/i,
  /not found or cannot be cancelled/i,
  /not set up on this device/i,
  /was not saved/i,
];

export function describeActionError(err: unknown, fallback: string): string {
  if (err instanceof StaffFacingError) return err.message;
  const message = err instanceof Error ? err.message.trim() : "";
  if (!message) return fallback;
  if (/supabase is not configured/i.test(message)) {
    return "The online service is not set up on this device, so this cannot be saved.";
  }
  if (READABLE_ERRORS.some((pattern) => pattern.test(message))) {
    return /[.!?]$/.test(message) ? message : `${message}.`;
  }
  if (
    /failed to fetch|networkerror|network request failed|load failed/i.test(
      message,
    )
  ) {
    return "Could not reach the online service. Check the internet connection, then try again.";
  }
  return fallback;
}
