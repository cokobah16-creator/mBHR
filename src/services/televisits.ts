import * as Sentry from "@sentry/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import * as logger from "@/lib/logger";
import { env } from "@/config/env";
import { formatNigerianDate, formatTime } from "@/utils/dateFormat";
import { composeSms } from "./messageTemplates";
import type { Appointment } from "./appointments";

export type VisitMode = "in_person" | "televisit";
export type TelevisitStatus = Appointment["status"];
export type TelevisitRequestStatus =
  | "pending"
  | "approved"
  | "scheduled"
  | "declined"
  | "cancelled";

export const TELEVISIT_APPOINTMENT_TYPE = "Televisit";
export const TELEVISIT_DEFAULT_DURATION_MIN = 20;
export const TELEVISIT_JOIN_WINDOW_BEFORE_MIN = 10;
export const TELEVISIT_JOIN_WINDOW_AFTER_MIN = 30;

const JOINABLE_STATUSES: TelevisitStatus[] = [
  "scheduled",
  "confirmed",
  "in-progress",
];

export interface Televisit {
  id: string;
  patientId: string;
  providerId?: string;
  scheduledAt: Date;
  durationMinutes: number;
  status: TelevisitStatus;
  reason?: string;
  notes?: string;
  meetingLink?: string;
  createdBy?: string;
  createdAt?: Date;
}

export interface TelevisitRequest {
  id: string;
  patientId: string;
  preferredDate: string;
  preferredTime?: string;
  reason?: string;
  notes?: string;
  status: TelevisitRequestStatus;
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewNotes?: string;
  scheduledAppointmentId?: string;
  createdAt: Date;
}

export interface PatientContact {
  id: string;
  fullName: string;
  phone?: string | null;
  preferredLanguage?: string;
}

interface TelevisitRow {
  id: string;
  patient_id: string;
  provider_id?: string | null;
  scheduled_at: string;
  duration_minutes?: number | null;
  status: TelevisitStatus;
  reason?: string | null;
  notes?: string | null;
  meeting_link?: string | null;
  created_by?: string | null;
  created_at?: string | null;
}

interface TelevisitRequestRow {
  id: string;
  patient_id: string;
  preferred_date_1: string;
  preferred_time_1?: string | null;
  reason?: string | null;
  notes?: string | null;
  status: TelevisitRequestStatus;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_notes?: string | null;
  scheduled_appointment_id?: string | null;
  created_at: string;
}

// Database and SMS errors can quote patient data (names, phone numbers), so
// only the error's name or code is logged, never its message or details.
function errorTag(error: unknown): string {
  if (error instanceof Error) return error.name;
  if (error && typeof error === "object" && "code" in error) {
    return `code ${String((error as { code: unknown }).code)}`;
  }
  return typeof error;
}

function logError(error: unknown, context: string): void {
  logger.error(`[televisits] ${context} failed:`, errorTag(error));
  if (import.meta.env.VITE_SENTRY_DSN && error instanceof Error) {
    Sentry.captureException(error, {
      tags: { service: "televisits", context },
    });
  }
}

function logAndThrow(error: unknown, context: string): never {
  logError(error, context);
  throw error;
}

function requireSupabase(context: string): SupabaseClient {
  if (!supabase) {
    logAndThrow(new Error("Supabase is not configured"), context);
  }
  return supabase;
}

function mapTelevisitRow(row: TelevisitRow): Televisit {
  return {
    id: row.id,
    patientId: row.patient_id,
    providerId: row.provider_id ?? undefined,
    scheduledAt: new Date(row.scheduled_at),
    durationMinutes: row.duration_minutes ?? TELEVISIT_DEFAULT_DURATION_MIN,
    status: row.status,
    reason: row.reason ?? undefined,
    notes: row.notes ?? undefined,
    meetingLink: row.meeting_link ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at ? new Date(row.created_at) : undefined,
  };
}

function mapTelevisitRequestRow(row: TelevisitRequestRow): TelevisitRequest {
  return {
    id: row.id,
    patientId: row.patient_id,
    preferredDate: row.preferred_date_1,
    preferredTime: row.preferred_time_1 ?? undefined,
    reason: row.reason ?? undefined,
    notes: row.notes ?? undefined,
    status: row.status,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : undefined,
    reviewNotes: row.review_notes ?? undefined,
    scheduledAppointmentId: row.scheduled_appointment_id ?? undefined,
    createdAt: new Date(row.created_at),
  };
}

function randomUuid(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== "function") {
    throw new Error("Secure random source unavailable");
  }
  const bytes = new Uint8Array(16);
  cryptoObj.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function generateMeetingLink(): string {
  const base = env.VITE_TELEVISIT_BASE_URL.replace(/\/+$/, "");
  return `${base}/mbhr-${randomUuid()}`;
}

export function televisitJoinOpensAt(
  visit: Pick<Televisit, "scheduledAt">,
): Date {
  return new Date(
    visit.scheduledAt.getTime() - TELEVISIT_JOIN_WINDOW_BEFORE_MIN * 60000,
  );
}

export function canJoinTelevisit(
  visit: Pick<Televisit, "scheduledAt" | "durationMinutes" | "status">,
  now: Date = new Date(),
): boolean {
  if (!JOINABLE_STATUSES.includes(visit.status)) return false;
  const start = visit.scheduledAt.getTime();
  const opensAt = start - TELEVISIT_JOIN_WINDOW_BEFORE_MIN * 60000;
  const closesAt =
    start +
    visit.durationMinutes * 60000 +
    TELEVISIT_JOIN_WINDOW_AFTER_MIN * 60000;
  const t = now.getTime();
  return t >= opensAt && t <= closesAt;
}

/** True when this build has the online service televisits need. */
export function isTelevisitServiceConfigured(): boolean {
  return supabase !== null;
}

/** Configured and the device reports a network connection. */
export function isTelevisitServiceAvailable(): boolean {
  return (
    supabase !== null && (typeof navigator === "undefined" || navigator.onLine)
  );
}

export function preferredSlotToTime(slot?: string): string {
  switch (slot) {
    case "afternoon":
      return "13:00";
    case "evening":
      return "17:00";
    default:
      return "09:00";
  }
}

export async function requestTelevisit(input: {
  patientId: string;
  reason: string;
  preferredDate: string;
  preferredTime?: string;
  notes?: string;
}): Promise<string> {
  const client = requireSupabase("requestTelevisit");
  const { data, error } = await client
    .from("patient_appointment_requests")
    .insert({
      patient_id: input.patientId,
      appointment_type: TELEVISIT_APPOINTMENT_TYPE,
      visit_mode: "televisit",
      preferred_date_1: input.preferredDate,
      preferred_time_1: input.preferredTime ?? null,
      reason: input.reason,
      notes: input.notes ?? null,
      status: "pending",
    })
    .select()
    .single();

  if (error) logAndThrow(error, "requestTelevisit");
  return (data as { id: string }).id;
}

export async function getPatientTelevisitRequests(
  patientId: string,
): Promise<TelevisitRequest[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("patient_appointment_requests")
    .select("*")
    .eq("patient_id", patientId)
    .eq("visit_mode", "televisit")
    .order("created_at", { ascending: false });

  if (error) logAndThrow(error, "getPatientTelevisitRequests");
  return ((data ?? []) as TelevisitRequestRow[]).map(mapTelevisitRequestRow);
}

export async function cancelTelevisitRequest(requestId: string): Promise<void> {
  const client = requireSupabase("cancelTelevisitRequest");
  const { data, error } = await client
    .from("patient_appointment_requests")
    .update({ status: "cancelled" })
    .eq("id", requestId)
    .select("id");

  if (error) logAndThrow(error, "cancelTelevisitRequest");
  // PostgREST reports success for an update that RLS filtered to zero rows.
  if (!data || (data as unknown[]).length === 0) {
    logAndThrow(
      new Error("Request not found or cannot be cancelled"),
      "cancelTelevisitRequest",
    );
  }
}

export async function getPatientTelevisits(
  patientId: string,
): Promise<Televisit[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("appointments")
    .select("*")
    .eq("patient_id", patientId)
    .eq("visit_mode", "televisit")
    .order("scheduled_at", { ascending: false });

  if (error) logAndThrow(error, "getPatientTelevisits");
  return ((data ?? []) as TelevisitRow[]).map(mapTelevisitRow);
}

export async function getPendingTelevisitRequests(): Promise<
  TelevisitRequest[]
> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("patient_appointment_requests")
    .select("*")
    .eq("visit_mode", "televisit")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) logAndThrow(error, "getPendingTelevisitRequests");
  return ((data ?? []) as TelevisitRequestRow[]).map(mapTelevisitRequestRow);
}

export async function getUpcomingTelevisits(
  providerId?: string,
): Promise<Televisit[]> {
  if (!supabase) return [];
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  let query = supabase
    .from("appointments")
    .select("*")
    .eq("visit_mode", "televisit")
    .in("status", JOINABLE_STATUSES)
    .gte("scheduled_at", startOfToday.toISOString())
    .order("scheduled_at", { ascending: true });

  if (providerId) query = query.eq("provider_id", providerId);

  const { data, error } = await query;
  if (error) logAndThrow(error, "getUpcomingTelevisits");
  return ((data ?? []) as TelevisitRow[]).map(mapTelevisitRow);
}

/**
 * Every televisit scheduled in [from, to), any status, latest first. Used
 * for the recent-visits list (ended, no-show, cancelled).
 */
export async function getTelevisitsBetween(
  from: Date,
  to: Date,
  providerId?: string,
): Promise<Televisit[]> {
  if (!supabase) return [];
  let query = supabase
    .from("appointments")
    .select("*")
    .eq("visit_mode", "televisit")
    .gte("scheduled_at", from.toISOString())
    .lt("scheduled_at", to.toISOString())
    .order("scheduled_at", { ascending: false });

  if (providerId) query = query.eq("provider_id", providerId);

  const { data, error } = await query;
  if (error) logAndThrow(error, "getTelevisitsBetween");
  return ((data ?? []) as TelevisitRow[]).map(mapTelevisitRow);
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const STAFF_NOT_REGISTERED_MESSAGE =
  "Your staff account is not registered in the online staff directory, so it cannot own appointments. Sign in online with your email and password, or ask an admin to add your account to the staff directory, then try again.";

// appointments.provider_id / created_by are uuid foreign keys to app_users, so
// a device-only PIN user (ULID id, never synced) cannot own an appointment.
export async function isRegisteredStaffUser(userId: string): Promise<boolean> {
  if (!supabase || !UUID_PATTERN.test(userId)) return false;
  const { data, error } = await supabase
    .from("app_users")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (error) logAndThrow(error, "isRegisteredStaffUser");
  return Boolean(data);
}

// Online sign-in keeps an existing local (ULID) user record, so the id that
// app_users knows is the Supabase session's user id, not necessarily the
// local one. Prefer the session id, then fall back to the local id.
export async function resolveStaffAppUserId(
  localUserId?: string | null,
): Promise<string | null> {
  if (!supabase) return null;
  const candidates: string[] = [];
  try {
    const { data } = await supabase.auth.getSession();
    const sessionUserId = data.session?.user?.id;
    if (sessionUserId) candidates.push(sessionUserId);
  } catch (err) {
    logger.warn(
      "[televisits] Could not read the Supabase session:",
      errorTag(err),
    );
  }
  if (localUserId && !candidates.includes(localUserId)) {
    candidates.push(localUserId);
  }
  for (const id of candidates) {
    if (await isRegisteredStaffUser(id)) return id;
  }
  return null;
}

// Bounds the overlap query; no appointment type in the app runs longer.
const MAX_APPOINTMENT_LOOKBACK_MS = 4 * 60 * 60 * 1000;

export async function hasProviderConflict(
  providerId: string,
  scheduledAt: Date,
  durationMinutes: number,
): Promise<boolean> {
  if (!supabase) return false;
  const start = scheduledAt.getTime();
  const end = start + durationMinutes * 60000;

  const { data, error } = await supabase
    .from("appointments")
    .select("id,scheduled_at,duration_minutes")
    .eq("provider_id", providerId)
    .in("status", JOINABLE_STATUSES)
    .gte(
      "scheduled_at",
      new Date(start - MAX_APPOINTMENT_LOOKBACK_MS).toISOString(),
    )
    .lt("scheduled_at", new Date(end).toISOString());

  if (error) logAndThrow(error, "hasProviderConflict");

  const rows = (data ?? []) as Array<{
    scheduled_at: string;
    duration_minutes: number | null;
  }>;
  return rows.some((row) => {
    const rowStart = new Date(row.scheduled_at).getTime();
    const rowEnd =
      rowStart +
      (row.duration_minutes ?? TELEVISIT_DEFAULT_DURATION_MIN) * 60000;
    return rowStart < end && rowEnd > start;
  });
}

async function releaseRequestClaim(
  client: SupabaseClient,
  requestId: string,
): Promise<void> {
  const { error } = await client
    .from("patient_appointment_requests")
    .update({ status: "pending", reviewed_by: null, reviewed_at: null })
    .eq("id", requestId)
    .eq("status", "scheduled");
  if (error) logError(error, "scheduleTelevisit:release");
}

export async function scheduleTelevisit(input: {
  patientId: string;
  providerId: string;
  scheduledAt: Date;
  durationMinutes?: number;
  reason?: string;
  notes?: string;
  createdBy: string;
  requestId?: string;
}): Promise<Televisit> {
  const client = requireSupabase("scheduleTelevisit");
  const durationMinutes =
    input.durationMinutes ?? TELEVISIT_DEFAULT_DURATION_MIN;

  if (input.scheduledAt.getTime() <= Date.now()) {
    logAndThrow(
      new Error("The televisit time must be in the future"),
      "scheduleTelevisit",
    );
  }
  for (const staffId of new Set([input.providerId, input.createdBy])) {
    if (!(await isRegisteredStaffUser(staffId))) {
      logAndThrow(new Error(STAFF_NOT_REGISTERED_MESSAGE), "scheduleTelevisit");
    }
  }
  if (
    await hasProviderConflict(
      input.providerId,
      input.scheduledAt,
      durationMinutes,
    )
  ) {
    logAndThrow(
      new Error("The provider already has an appointment in that time slot"),
      "scheduleTelevisit",
    );
  }

  if (input.requestId) {
    // Claim the request before creating the appointment: the status guard
    // makes the claim atomic, so concurrent schedulers (or a patient who has
    // just cancelled) cannot produce a second appointment for one request.
    const { data: claimed, error: claimError } = await client
      .from("patient_appointment_requests")
      .update({
        status: "scheduled",
        reviewed_by: input.createdBy,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", input.requestId)
      .eq("status", "pending")
      .select("id");

    if (claimError) logAndThrow(claimError, "scheduleTelevisit:claim");
    if (!claimed || (claimed as unknown[]).length === 0) {
      logAndThrow(
        new Error("This request is no longer pending"),
        "scheduleTelevisit:claim",
      );
    }
  }

  const { data, error } = await client
    .from("appointments")
    .insert({
      patient_id: input.patientId,
      provider_id: input.providerId,
      appointment_type: TELEVISIT_APPOINTMENT_TYPE,
      visit_mode: "televisit",
      meeting_link: generateMeetingLink(),
      scheduled_at: input.scheduledAt.toISOString(),
      duration_minutes: durationMinutes,
      status: "scheduled",
      reason: input.reason ?? null,
      notes: input.notes ?? null,
      created_by: input.createdBy,
    })
    .select()
    .single();

  if (error) {
    if (input.requestId) await releaseRequestClaim(client, input.requestId);
    logAndThrow(error, "scheduleTelevisit");
  }
  const visit = mapTelevisitRow(data as TelevisitRow);

  if (input.requestId) {
    const { error: linkError } = await client
      .from("patient_appointment_requests")
      .update({ scheduled_appointment_id: visit.id })
      .eq("id", input.requestId);

    // The request is claimed and the appointment persisted; a missing
    // back-link is harmless, so log instead of throwing.
    if (linkError) logError(linkError, "scheduleTelevisit:link");
  }

  return visit;
}

export async function declineTelevisitRequest(
  requestId: string,
  reviewedBy: string,
  reviewNotes?: string,
): Promise<void> {
  const client = requireSupabase("declineTelevisitRequest");
  const { error } = await client
    .from("patient_appointment_requests")
    .update({
      status: "declined",
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
      review_notes: reviewNotes ?? null,
    })
    .eq("id", requestId);

  if (error) logAndThrow(error, "declineTelevisitRequest");
}

export async function updateTelevisitStatus(
  id: string,
  status: TelevisitStatus,
): Promise<void> {
  const client = requireSupabase("updateTelevisitStatus");
  const { error } = await client
    .from("appointments")
    .update({ status })
    .eq("id", id);

  if (error) logAndThrow(error, "updateTelevisitStatus");
}

export async function cancelTelevisit(
  id: string,
  reason?: string,
): Promise<void> {
  const client = requireSupabase("cancelTelevisit");
  const updates: { status: TelevisitStatus; notes?: string } = {
    status: "cancelled",
  };
  if (reason) updates.notes = reason;

  const { error } = await client
    .from("appointments")
    .update(updates)
    .eq("id", id);

  if (error) logAndThrow(error, "cancelTelevisit");
}

function fullNameOf(given: unknown, family: unknown): string {
  return `${(given as string) || ""} ${(family as string) || ""}`.trim();
}

export async function getPatientContact(
  patientId: string,
): Promise<PatientContact | null> {
  try {
    const { db } = await import("@/db");
    const local = await db.patients.get(patientId);
    if (local) {
      return {
        id: local.id,
        fullName: fullNameOf(local.givenName, local.familyName),
        phone: local.phone ?? undefined,
        preferredLanguage: undefined,
      };
    }
  } catch {
    // Dexie is unavailable in some environments; fall through to Supabase.
  }

  if (!supabase) return null;

  const snake = await supabase
    .from("patients")
    .select("id,given_name,family_name,phone")
    .eq("id", patientId)
    .maybeSingle();

  if (!snake.error) {
    if (!snake.data) return null;
    const p = snake.data as Record<string, unknown>;
    return {
      id: p.id as string,
      fullName: fullNameOf(p.given_name, p.family_name),
      phone: (p.phone as string | null | undefined) ?? undefined,
      preferredLanguage: undefined,
    };
  }

  const camel = await supabase
    .from("patients")
    .select("id,givenName,familyName,phone")
    .eq("id", patientId)
    .maybeSingle();

  if (camel.error || !camel.data) return null;
  const p = camel.data as Record<string, unknown>;
  return {
    id: p.id as string,
    fullName: fullNameOf(p.givenName, p.familyName),
    phone: (p.phone as string | null | undefined) ?? undefined,
    preferredLanguage: undefined,
  };
}

export async function loadPatientNames(
  patientIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!supabase || patientIds.length === 0) return map;

  const uniqueIds = Array.from(new Set(patientIds));

  const snake = await supabase
    .from("patients")
    .select("id,given_name,family_name")
    .in("id", uniqueIds);

  if (!snake.error && snake.data) {
    (snake.data as Record<string, unknown>[]).forEach((p) => {
      map.set(p.id as string, fullNameOf(p.given_name, p.family_name));
    });
    return map;
  }

  const camel = await supabase
    .from("patients")
    .select("id,givenName,familyName")
    .in("id", uniqueIds);

  if (!camel.error && camel.data) {
    (camel.data as Record<string, unknown>[]).forEach((p) => {
      map.set(p.id as string, fullNameOf(p.givenName, p.familyName));
    });
  }

  return map;
}

/**
 * Access token of the staff member signed in online, or null. A PIN unlock
 * of an offline workspace has no online session, so it cannot send SMS.
 */
async function staffAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
  } catch (error) {
    logger.warn("[televisits] Could not read the online session:", errorTag(error));
    return null;
  }
}

// Reads the edge function's error without echoing the phone number into
// logs; the caller turns it into plain language for staff.
async function readSmsError(response: Response): Promise<string> {
  if (response.status === 429) return "Rate limited (HTTP 429)";
  let text = "";
  try {
    text = await response.text();
  } catch {
    // Body unreadable; fall back to the status code.
  }
  try {
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
    const code = typeof parsed.error === "string" ? parsed.error.trim() : "";
    // The server's `message` is fixed plain text (never the number), e.g.
    // "not_permitted: Your role cannot send SMS to patients."
    const detail = typeof parsed.message === "string" ? parsed.message.trim() : "";
    if (code && detail) return `${code}: ${detail}`;
    if (code || detail) return code || detail;
  } catch {
    // Not JSON; use the raw text below.
  }
  return text.trim() || `HTTP ${response.status}`;
}

/**
 * Sends the meeting link by SMS. `sent` is true only when the SMS service
 * accepted the message for delivery; demo mode (logged, not sent), missing
 * configuration, an offline device, no staff member signed in online and
 * provider errors all return `sent: false` with an `error` describing why.
 *
 * The request carries the signed-in staff member's access token and only
 * `{ patientId, message }`: the server checks the staff role and sends to
 * the phone number on the patient's record, never to a number from here.
 */
export async function notifyPatientTelevisitScheduled(
  visit: Televisit,
  patient: PatientContact,
  providerName?: string,
): Promise<{ sent: boolean; error?: string }> {
  if (!patient.phone) {
    return { sent: false, error: "Patient has no phone number" };
  }
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    return { sent: false, error: "SMS service not configured" };
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { sent: false, error: "Device is offline" };
  }

  // The server only sends for a signed-in staff account: it checks the
  // role and looks up the number on the patient's record itself.
  const accessToken = await staffAccessToken();
  if (!accessToken) {
    return { sent: false, error: "Sign in online to send SMS" };
  }

  try {
    const message = await composeSms(
      "televisit_scheduled",
      patient.preferredLanguage,
      {
        patient_name: patient.fullName,
        provider_name: providerName ?? "your doctor",
        date: formatNigerianDate(visit.scheduledAt),
        time: formatTime(visit.scheduledAt),
        link: visit.meetingLink ?? "",
      },
    );

    const response = await fetch(
      `${env.VITE_SUPABASE_URL}/functions/v1/send-sms-reminder`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          apikey: env.VITE_SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
        },
        // No phone number: the server sends to the number on the patient's
        // record (patient.phone above is only used to skip a pointless call).
        body: JSON.stringify({ patientId: visit.patientId, message }),
      },
    );

    if (!response.ok) {
      const error = await readSmsError(response);
      logger.warn("[televisits] SMS send failed: HTTP", response.status);
      return { sent: false, error };
    }

    const result = (await response.json()) as {
      success?: boolean;
      demo?: boolean;
      error?: string;
    };
    if (!result.success) {
      logger.warn("[televisits] SMS send rejected by the SMS service");
      return { sent: false, error: result.error ?? "SMS send failed" };
    }
    if (result.demo) {
      // SMS_DEMO_MODE logs the message on the server instead of sending it.
      return {
        sent: false,
        error: "SMS demo mode is on: the message was logged, not sent",
      };
    }
    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    logger.warn("[televisits] SMS send error:", errorTag(err));
    return { sent: false, error: message };
  }
}
