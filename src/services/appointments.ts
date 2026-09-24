import * as Sentry from "@sentry/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import * as logger from "@/lib/logger";

export interface Appointment {
  id?: string;
  patientId: string;
  providerId?: string;
  appointmentType: string;
  scheduledAt: Date;
  durationMinutes: number;
  status:
    | "scheduled"
    | "confirmed"
    | "arrived"
    | "in-progress"
    | "completed"
    | "no-show"
    | "cancelled";
  reason?: string;
  notes?: string;
  reminderSent?: boolean;
  reminderSentAt?: Date;
  createdBy: string;
  visitMode?: "in_person" | "televisit";
  meetingLink?: string;
}

interface AppointmentRow {
  id: string;
  patient_id: string;
  provider_id?: string;
  appointment_type: string;
  scheduled_at: string;
  duration_minutes: number;
  status: Appointment["status"];
  reason?: string;
  notes?: string;
  reminder_sent?: boolean;
  reminder_sent_at?: string;
  created_by: string;
  visit_mode?: Appointment["visitMode"] | null;
  meeting_link?: string | null;
}

function mapAppointmentRow(a: AppointmentRow): Appointment {
  return {
    id: a.id,
    patientId: a.patient_id,
    providerId: a.provider_id,
    appointmentType: a.appointment_type,
    scheduledAt: new Date(a.scheduled_at),
    durationMinutes: a.duration_minutes,
    status: a.status,
    reason: a.reason,
    notes: a.notes,
    reminderSent: a.reminder_sent,
    reminderSentAt: a.reminder_sent_at
      ? new Date(a.reminder_sent_at)
      : undefined,
    createdBy: a.created_by,
    visitMode: a.visit_mode ?? undefined,
    meetingLink: a.meeting_link ?? undefined,
  };
}

export interface WaitlistEntry {
  id?: string;
  patientId: string;
  appointmentType: string;
  preferredDates?: Date[];
  reason?: string;
  priority: "routine" | "urgent";
  status: "waiting" | "scheduled" | "cancelled";
}

export interface AppointmentProvider {
  id: string;
  fullName: string;
  role: string;
}

/** Changes accepted by updateAppointmentDetails; omitted fields are kept. */
export interface AppointmentDetailsUpdate {
  providerId?: string;
  appointmentType?: string;
  scheduledAt?: Date;
  durationMinutes?: number;
  status?: Appointment["status"];
  reason?: string | null;
  notes?: string | null;
  visitMode?: Appointment["visitMode"];
  meetingLink?: string | null;
}

export const APPOINTMENTS_UNAVAILABLE_MESSAGE =
  "Appointments are kept in the online service, which is not set up on this device.";

export const APPOINTMENT_NOT_SAVED_MESSAGE =
  "The change was not saved: the appointment was not found or your account cannot edit it.";

// Statuses that occupy a provider's time slot.
const SLOT_BLOCKING_STATUSES: Appointment["status"][] = [
  "scheduled",
  "confirmed",
  "in-progress",
];

// Bounds the overlap query: the booking form allows at most 4 hours.
const MAX_APPOINTMENT_LOOKBACK_MS = 4 * 60 * 60 * 1000;
const DEFAULT_DURATION_MIN = 30;

const PROVIDER_ROLES = new Set(["doctor", "nurse", "admin", "lead_clinician"]);

/** True when this build has an online service to store appointments in. */
export function isAppointmentServiceConfigured(): boolean {
  return supabase !== null;
}

// Database errors can quote row values, so only the error's name or code is
// logged, never its message or details.
function errorTag(error: unknown): string {
  if (error instanceof Error) return error.name;
  if (error && typeof error === "object" && "code" in error) {
    return `code ${String((error as { code: unknown }).code)}`;
  }
  return typeof error;
}

function logAndThrow(error: unknown, context: string): never {
  logger.error(`[appointments] ${context} failed:`, errorTag(error));
  if (import.meta.env.VITE_SENTRY_DSN && error instanceof Error) {
    Sentry.captureException(error, {
      tags: { service: "appointments", context },
    });
  }
  throw error;
}

function requireClient(context: string): SupabaseClient {
  if (!supabase) {
    logAndThrow(new Error(APPOINTMENTS_UNAVAILABLE_MESSAGE), context);
  }
  return supabase;
}

export async function createAppointment(
  appointment: Appointment,
): Promise<string> {
  const { data, error } = await requireClient("createAppointment")
    .from("appointments")
    .insert({
      patient_id: appointment.patientId,
      provider_id: appointment.providerId,
      appointment_type: appointment.appointmentType,
      scheduled_at: appointment.scheduledAt.toISOString(),
      duration_minutes: appointment.durationMinutes,
      status: "scheduled",
      reason: appointment.reason,
      notes: appointment.notes,
      created_by: appointment.createdBy,
      ...(appointment.visitMode !== undefined
        ? { visit_mode: appointment.visitMode }
        : {}),
      ...(appointment.meetingLink !== undefined
        ? { meeting_link: appointment.meetingLink }
        : {}),
    })
    .select()
    .single();

  if (error) logAndThrow(error, "createAppointment");
  return data!.id;
}

export async function updateAppointmentStatus(
  appointmentId: string,
  status: Appointment["status"],
): Promise<void> {
  const { error } = await requireClient("updateAppointmentStatus")
    .from("appointments")
    .update({ status })
    .eq("id", appointmentId);

  if (error) logAndThrow(error, "updateAppointmentStatus");
}

export async function rescheduleAppointment(
  appointmentId: string,
  newDateTime: Date,
): Promise<void> {
  const { error } = await requireClient("rescheduleAppointment")
    .from("appointments")
    .update({
      scheduled_at: newDateTime.toISOString(),
      status: "scheduled",
    })
    .eq("id", appointmentId);

  if (error) logAndThrow(error, "rescheduleAppointment");
}

export async function cancelAppointment(
  appointmentId: string,
  reason?: string,
): Promise<void> {
  const updates: { status: Appointment["status"]; notes?: string } = {
    status: "cancelled",
  };
  if (reason) updates.notes = reason;

  const { error } = await requireClient("cancelAppointment")
    .from("appointments")
    .update(updates)
    .eq("id", appointmentId);

  if (error) logAndThrow(error, "cancelAppointment");
}

export async function getPatientAppointments(
  patientId: string,
): Promise<Appointment[]> {
  const { data, error } = await requireClient("getPatientAppointments")
    .from("appointments")
    .select("*")
    .eq("patient_id", patientId)
    .order("scheduled_at", { ascending: false });

  if (error) logAndThrow(error, "getPatientAppointments");

  return (data as AppointmentRow[]).map(mapAppointmentRow);
}

export async function getUpcomingAppointments(
  providerId?: string,
): Promise<Appointment[]> {
  let query = requireClient("getUpcomingAppointments")
    .from("appointments")
    .select("*")
    .in("status", ["scheduled", "confirmed"])
    .gte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true });

  if (providerId) query = query.eq("provider_id", providerId);

  const { data, error } = await query;
  if (error) logAndThrow(error, "getUpcomingAppointments");

  return (data as AppointmentRow[]).map(mapAppointmentRow);
}

export async function getTodayAppointments(
  providerId?: string,
): Promise<Appointment[]> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  let query = requireClient("getTodayAppointments")
    .from("appointments")
    .select("*")
    .gte("scheduled_at", startOfDay.toISOString())
    .lte("scheduled_at", endOfDay.toISOString())
    .order("scheduled_at", { ascending: true });

  if (providerId) query = query.eq("provider_id", providerId);

  const { data, error } = await query;
  if (error) logAndThrow(error, "getTodayAppointments");

  return (data as AppointmentRow[]).map(mapAppointmentRow);
}

/** Every appointment scheduled in [from, to), any status, earliest first. */
export async function getAppointmentsInRange(
  from: Date,
  to: Date,
  providerId?: string,
): Promise<Appointment[]> {
  let query = requireClient("getAppointmentsInRange")
    .from("appointments")
    .select("*")
    .gte("scheduled_at", from.toISOString())
    .lt("scheduled_at", to.toISOString())
    .order("scheduled_at", { ascending: true });

  if (providerId) query = query.eq("provider_id", providerId);

  const { data, error } = await query;
  if (error) logAndThrow(error, "getAppointmentsInRange");

  return ((data ?? []) as AppointmentRow[]).map(mapAppointmentRow);
}

/**
 * True when the provider has no scheduled, confirmed or in-progress
 * appointment overlapping [dateTime, dateTime + durationMinutes). Pass
 * `excludeAppointmentId` when moving an existing appointment so it does not
 * conflict with itself. Appointments that end exactly when this one starts
 * do not count as overlapping.
 */
export async function checkAvailability(
  providerId: string,
  dateTime: Date,
  durationMinutes: number,
  excludeAppointmentId?: string,
): Promise<boolean> {
  const start = dateTime.getTime();
  const end = start + durationMinutes * 60000;
  const windowStart = new Date(
    start - MAX_APPOINTMENT_LOOKBACK_MS,
  ).toISOString();
  const windowEnd = new Date(end).toISOString();

  // Candidates start between (start - longest appointment) and the end of
  // the requested slot; both bounds sit in one and() group of the filter.
  const { data, error } = await requireClient("checkAvailability")
    .from("appointments")
    .select("id,scheduled_at,duration_minutes")
    .eq("provider_id", providerId)
    .in("status", SLOT_BLOCKING_STATUSES)
    .or(
      `and(scheduled_at.gte."${windowStart}",scheduled_at.lt."${windowEnd}")`,
    );

  if (error) logAndThrow(error, "checkAvailability");

  const rows = (data ?? []) as Array<{
    id?: string;
    scheduled_at: string;
    duration_minutes?: number | null;
  }>;
  return !rows.some((row) => {
    if (excludeAppointmentId && row.id === excludeAppointmentId) return false;
    const rowStart = new Date(row.scheduled_at).getTime();
    const rowEnd =
      rowStart + (row.duration_minutes ?? DEFAULT_DURATION_MIN) * 60000;
    return rowStart < end && rowEnd > start;
  });
}

/**
 * Updates an appointment's details. Rejects when no row was changed (for
 * example when row-level security hides it), so callers never report a
 * change that was not stored.
 */
export async function updateAppointmentDetails(
  appointmentId: string,
  changes: AppointmentDetailsUpdate,
): Promise<void> {
  const updates: Record<string, unknown> = {};
  if (changes.providerId !== undefined)
    updates.provider_id = changes.providerId;
  if (changes.appointmentType !== undefined)
    updates.appointment_type = changes.appointmentType;
  if (changes.scheduledAt !== undefined)
    updates.scheduled_at = changes.scheduledAt.toISOString();
  if (changes.durationMinutes !== undefined)
    updates.duration_minutes = changes.durationMinutes;
  if (changes.status !== undefined) updates.status = changes.status;
  if (changes.reason !== undefined) updates.reason = changes.reason;
  if (changes.notes !== undefined) updates.notes = changes.notes;
  if (changes.visitMode !== undefined) updates.visit_mode = changes.visitMode;
  if (changes.meetingLink !== undefined)
    updates.meeting_link = changes.meetingLink;

  const { data, error } = await requireClient("updateAppointmentDetails")
    .from("appointments")
    .update(updates)
    .eq("id", appointmentId)
    .select("id");

  if (error) logAndThrow(error, "updateAppointmentDetails");
  if (!data || (data as unknown[]).length === 0) {
    logAndThrow(
      new Error(APPOINTMENT_NOT_SAVED_MESSAGE),
      "updateAppointmentDetails",
    );
  }
}

/**
 * Staff who can be booked as the provider (doctor, nurse, lead clinician,
 * admin), alphabetical. Needs the online staff directory.
 */
export async function listAppointmentProviders(): Promise<
  AppointmentProvider[]
> {
  const { data, error } = await requireClient("listAppointmentProviders")
    .from("app_users")
    .select("id,full_name,role")
    .order("full_name", { ascending: true });

  if (error) logAndThrow(error, "listAppointmentProviders");

  return (
    (data ?? []) as Array<{
      id: string;
      full_name?: string | null;
      role?: string | null;
    }>
  )
    .filter((row) => row.role && PROVIDER_ROLES.has(row.role))
    .map((row) => ({
      id: row.id,
      fullName: row.full_name?.trim() || "Unnamed staff member",
      role: row.role as string,
    }));
}

export async function addToWaitlist(entry: WaitlistEntry): Promise<string> {
  const { data, error } = await requireClient("addToWaitlist")
    .from("waitlist")
    .insert({
      patient_id: entry.patientId,
      appointment_type: entry.appointmentType,
      preferred_dates: entry.preferredDates?.map((d) => d.toISOString()),
      reason: entry.reason,
      priority: entry.priority,
      status: "waiting",
    })
    .select()
    .single();

  if (error) logAndThrow(error, "addToWaitlist");
  return data!.id;
}

export async function getWaitlist(): Promise<WaitlistEntry[]> {
  const { data, error } = await requireClient("getWaitlist")
    .from("waitlist")
    .select("*")
    .eq("status", "waiting")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) logAndThrow(error, "getWaitlist");

  return data!.map((w) => ({
    id: w.id,
    patientId: w.patient_id,
    appointmentType: w.appointment_type,
    preferredDates: w.preferred_dates?.map((d: string) => new Date(d)),
    reason: w.reason,
    priority: w.priority,
    status: w.status,
  }));
}

export async function updateWaitlistStatus(
  waitlistId: string,
  status: WaitlistEntry["status"],
): Promise<void> {
  const { error } = await requireClient("updateWaitlistStatus")
    .from("waitlist")
    .update({ status })
    .eq("id", waitlistId);

  if (error) logAndThrow(error, "updateWaitlistStatus");
}

export async function scheduleFromWaitlist(
  waitlistId: string,
  appointmentData: Omit<Appointment, "id">,
): Promise<string> {
  const appointmentId = await createAppointment(appointmentData);
  await updateWaitlistStatus(waitlistId, "scheduled");
  return appointmentId;
}
