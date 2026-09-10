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

function logError(error: unknown, context: string): void {
  logger.error(`[televisits] ${context}:`, error);
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
  const { data, error } = await client
    .from("appointments")
    .insert({
      patient_id: input.patientId,
      provider_id: input.providerId,
      appointment_type: TELEVISIT_APPOINTMENT_TYPE,
      visit_mode: "televisit",
      meeting_link: generateMeetingLink(),
      scheduled_at: input.scheduledAt.toISOString(),
      duration_minutes: input.durationMinutes ?? TELEVISIT_DEFAULT_DURATION_MIN,
      status: "scheduled",
      reason: input.reason ?? null,
      notes: input.notes ?? null,
      created_by: input.createdBy,
    })
    .select()
    .single();

  if (error) logAndThrow(error, "scheduleTelevisit");
  const visit = mapTelevisitRow(data as TelevisitRow);

  if (input.requestId) {
    const { error: requestError } = await client
      .from("patient_appointment_requests")
      .update({
        status: "scheduled",
        scheduled_appointment_id: visit.id,
        reviewed_by: input.createdBy,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", input.requestId);

    // The appointment is already persisted; failing here would leave an
    // orphan row and invite a duplicate on retry, so log instead of throwing.
    if (requestError) logError(requestError, "scheduleTelevisit:request");
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
          Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ to: patient.phone, message }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn("[televisits] SMS send failed:", errorText);
      return { sent: false, error: errorText || `HTTP ${response.status}` };
    }

    const result = (await response.json()) as {
      success?: boolean;
      error?: string;
    };
    if (!result.success) {
      logger.warn("[televisits] SMS send rejected:", result.error);
      return { sent: false, error: result.error ?? "SMS send failed" };
    }
    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    logger.warn("[televisits] SMS send error:", err);
    return { sent: false, error: message };
  }
}
