import * as Sentry from "@sentry/react";
import { supabase } from "../lib/supabase";
import * as logger from "@/lib/logger";

// Lab orders and results live only in Supabase (tables lab_orders and
// lab_results); there is no copy in IndexedDB. Every call here needs cloud
// sync to be configured, a connection, and a Supabase sign-in: row-level
// security only lets admin/doctor/nurse app_users read or change them.

export interface LabOrder {
  id?: string;
  patientId: string;
  visitId?: string;
  orderedBy: string;
  testName: string;
  testCode?: string;
  priority: "routine" | "urgent" | "stat";
  status: "ordered" | "collected" | "processing" | "completed" | "cancelled";
  specimenType?: string;
  clinicalNotes?: string;
  orderedAt?: Date;
  collectedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
}

export interface LabResult {
  id?: string;
  orderId: string;
  resultValue: string;
  resultUnit?: string;
  referenceRange?: string;
  interpretation: "normal" | "abnormal" | "critical";
  resultDate: Date;
  reviewedBy?: string;
  reviewedAt?: Date;
  notes?: string;
}

/** A stored lab order with every result recorded against it (newest first). */
export interface LabOrderWithResults extends LabOrder {
  id: string;
  results: LabResult[];
}

export interface LabWorklist {
  orders: LabOrderWithResults[];
  /** True when a query hit its row limit, so older orders are not listed. */
  truncated: boolean;
}

/** How many completed/cancelled orders the work queue fetches (newest first). */
export const LAB_WORKLIST_CLOSED_LIMIT = 200;
const WORKLIST_OPEN_LIMIT = 500;
const WORKLIST_UNREVIEWED_LIMIT = 500;

/**
 * Thrown by every lab call that fails. It carries only the operation name
 * and the Postgres/PostgREST error code, never row data, so it is safe to
 * log and to report to Sentry. `code` is "NO_ROWS" when an update matched
 * nothing (the row is gone, or row-level security hid it).
 */
export class LabServiceError extends Error {
  readonly operation: string;
  readonly code?: string;

  constructor(operation: string, code?: string) {
    super(`Lab service call failed: ${operation}${code ? ` (${code})` : ""}`);
    this.name = "LabServiceError";
    this.operation = operation;
    this.code = code;
  }
}

/** Thrown when cloud sync is not configured, so lab data cannot be reached. */
export class LabsUnavailableError extends Error {
  constructor() {
    super("Lab orders need cloud sync, which is not configured on this device.");
    this.name = "LabsUnavailableError";
  }
}

function client() {
  if (!supabase) throw new LabsUnavailableError();
  return supabase;
}

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code) return code;
  }
  return undefined;
}

function logAndThrow(error: unknown, context: string): never {
  // Supabase messages and details can echo row values (names, notes,
  // results), so only the operation and the error code leave this module.
  const safe = new LabServiceError(context, errorCode(error));
  logger.error(`[labs] ${context} failed:`, safe.code ?? (error instanceof Error ? error.name : "unknown"));
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (import.meta.env.VITE_SENTRY_DSN && !offline) {
    Sentry.captureException(safe, {
      tags: { service: "labs", context, code: safe.code ?? "none" },
    });
  }
  throw safe;
}

// Row shapes as stored in Supabase (see the lab_orders / lab_results
// migrations). Nullable columns come back as null.
interface LabOrderRow {
  id: string;
  patient_id: string;
  visit_id: string | null;
  ordered_by: string | null;
  test_name: string;
  test_code: string | null;
  priority: LabOrder["priority"];
  status: LabOrder["status"];
  specimen_type: string | null;
  clinical_notes: string | null;
  ordered_at: string | null;
  collected_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
}

interface LabResultRow {
  id: string;
  order_id: string;
  result_value: string;
  result_unit: string | null;
  reference_range: string | null;
  interpretation: LabResult["interpretation"];
  result_date: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  notes: string | null;
}

interface LabOrderRowWithResults extends LabOrderRow {
  lab_results: LabResultRow[] | null;
}

interface LabResultRowWithOrder extends LabResultRow {
  lab_orders: LabOrderRow | null;
}

const toDate = (value: string | null | undefined): Date | undefined =>
  value ? new Date(value) : undefined;

function mapOrderRow(o: LabOrderRow): LabOrder {
  return {
    id: o.id,
    patientId: o.patient_id,
    visitId: o.visit_id,
    orderedBy: o.ordered_by,
    testName: o.test_name,
    testCode: o.test_code,
    priority: o.priority,
    status: o.status,
    specimenType: o.specimen_type,
    clinicalNotes: o.clinical_notes,
    orderedAt: toDate(o.ordered_at),
    collectedAt: toDate(o.collected_at),
    completedAt: toDate(o.completed_at),
    cancelledAt: toDate(o.cancelled_at),
  };
}

function mapResultRow(r: LabResultRow): LabResult {
  return {
    id: r.id,
    orderId: r.order_id,
    resultValue: r.result_value,
    resultUnit: r.result_unit,
    referenceRange: r.reference_range,
    interpretation: r.interpretation,
    resultDate: new Date(r.result_date),
    reviewedBy: r.reviewed_by,
    reviewedAt: toDate(r.reviewed_at),
    notes: r.notes,
  };
}

export async function createLabOrder(order: LabOrder): Promise<string> {
  const { data, error } = await client()
    .from("lab_orders")
    .insert({
      patient_id: order.patientId,
      visit_id: order.visitId,
      ordered_by: order.orderedBy,
      test_name: order.testName,
      test_code: order.testCode,
      priority: order.priority,
      status: "ordered",
      specimen_type: order.specimenType,
      clinical_notes: order.clinicalNotes,
    })
    .select()
    .single();

  if (error) logAndThrow(error, "createLabOrder");
  return data!.id;
}

export async function updateLabOrderStatus(
  orderId: string,
  status: LabOrder["status"],
): Promise<void> {
  const updates: Record<string, string> = { status };
  if (status === "collected") updates.collected_at = new Date().toISOString();
  else if (status === "completed")
    updates.completed_at = new Date().toISOString();
  else if (status === "cancelled")
    updates.cancelled_at = new Date().toISOString();

  // count: "exact" reports how many rows changed. Row-level security makes
  // a refused update look like a success with nothing changed, so zero
  // rows is treated as a failure rather than reported as saved.
  const { error, count } = await client()
    .from("lab_orders")
    .update(updates, { count: "exact" })
    .eq("id", orderId);

  if (error) logAndThrow(error, "updateLabOrderStatus");
  if (count === 0) logAndThrow({ code: "NO_ROWS" }, "updateLabOrderStatus");
}

export async function addLabResult(result: LabResult): Promise<string> {
  const { data, error } = await client()
    .from("lab_results")
    .insert({
      order_id: result.orderId,
      result_value: result.resultValue,
      result_unit: result.resultUnit,
      reference_range: result.referenceRange,
      interpretation: result.interpretation,
      result_date: result.resultDate.toISOString(),
      notes: result.notes,
    })
    .select()
    .single();

  if (error) logAndThrow(error, "addLabResult");
  await updateLabOrderStatus(result.orderId, "completed");
  return data!.id;
}

export async function reviewLabResult(
  resultId: string,
  reviewedBy: string,
): Promise<void> {
  const { error, count } = await client()
    .from("lab_results")
    .update(
      {
        reviewed_by: reviewedBy,
        reviewed_at: new Date().toISOString(),
      },
      { count: "exact" },
    )
    .eq("id", resultId);

  if (error) logAndThrow(error, "reviewLabResult");
  if (count === 0) logAndThrow({ code: "NO_ROWS" }, "reviewLabResult");
}

export async function getPatientLabOrders(
  patientId: string,
): Promise<LabOrder[]> {
  const { data, error } = await client()
    .from("lab_orders")
    .select("*")
    .eq("patient_id", patientId)
    .order("ordered_at", { ascending: false });

  if (error) logAndThrow(error, "getPatientLabOrders");

  return ((data ?? []) as unknown as LabOrderRow[]).map(mapOrderRow);
}

export async function getLabResults(orderId: string): Promise<LabResult[]> {
  const { data, error } = await client()
    .from("lab_results")
    .select("*")
    .eq("order_id", orderId)
    .order("result_date", { ascending: false });

  if (error) logAndThrow(error, "getLabResults");

  return ((data ?? []) as unknown as LabResultRow[]).map(mapResultRow);
}

export async function getPendingLabOrders(): Promise<LabOrder[]> {
  const { data, error } = await client()
    .from("lab_orders")
    .select("*")
    .in("status", ["ordered", "collected", "processing"])
    .order("priority", { ascending: true })
    .order("ordered_at", { ascending: true });

  if (error) logAndThrow(error, "getPendingLabOrders");

  return ((data ?? []) as unknown as LabOrderRow[]).map(mapOrderRow);
}

export async function getCriticalResults(): Promise<
  Array<LabResult & { patientId: string; testName: string }>
> {
  const { data, error } = await client()
    .from("lab_results")
    .select(
      `
      *,
      lab_orders!inner(patient_id, test_name)
    `,
    )
    .eq("interpretation", "critical")
    .is("reviewed_at", null)
    .order("result_date", { ascending: false });

  if (error) logAndThrow(error, "getCriticalResults");

  type Row = LabResultRow & {
    lab_orders: Pick<LabOrderRow, "patient_id" | "test_name">;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    ...mapResultRow(r),
    patientId: r.lab_orders.patient_id,
    testName: r.lab_orders.test_name,
  }));
}

/**
 * Everything a lab/clinician work queue needs, in three reads:
 * - every open order (ordered, collected, processing);
 * - the most recent completed or cancelled orders;
 * - every result not yet reviewed, whatever the age of its order, so an
 *   old critical result can never drop out of the queue.
 * Orders come back once each, with their results newest first.
 */
export async function getLabWorklist(): Promise<LabWorklist> {
  const db = client();
  const [open, closed, unreviewed] = await Promise.all([
    db
      .from("lab_orders")
      .select("*, lab_results(*)")
      .in("status", ["ordered", "collected", "processing"])
      .order("ordered_at", { ascending: true })
      .limit(WORKLIST_OPEN_LIMIT),
    db
      .from("lab_orders")
      .select("*, lab_results(*)")
      .in("status", ["completed", "cancelled"])
      .order("ordered_at", { ascending: false })
      .limit(LAB_WORKLIST_CLOSED_LIMIT),
    db
      .from("lab_results")
      .select("*, lab_orders!inner(*)")
      .is("reviewed_at", null)
      .order("result_date", { ascending: true })
      .limit(WORKLIST_UNREVIEWED_LIMIT),
  ]);

  if (open.error) logAndThrow(open.error, "getLabWorklist:open");
  if (closed.error) logAndThrow(closed.error, "getLabWorklist:closed");
  if (unreviewed.error)
    logAndThrow(unreviewed.error, "getLabWorklist:unreviewed");

  const openRows = (open.data ?? []) as unknown as LabOrderRowWithResults[];
  const closedRows = (closed.data ?? []) as unknown as LabOrderRowWithResults[];
  const unreviewedRows = (unreviewed.data ??
    []) as unknown as LabResultRowWithOrder[];

  const byId = new Map<string, LabOrderWithResults>();
  for (const row of [...openRows, ...closedRows]) {
    byId.set(row.id, {
      ...mapOrderRow(row),
      id: row.id,
      results: (row.lab_results ?? []).map(mapResultRow),
    });
  }
  for (const row of unreviewedRows) {
    if (!row.lab_orders) continue;
    const result = mapResultRow(row);
    const existing = byId.get(row.lab_orders.id);
    if (existing) {
      if (!existing.results.some((r) => r.id === result.id)) {
        existing.results.push(result);
      }
    } else {
      byId.set(row.lab_orders.id, {
        ...mapOrderRow(row.lab_orders),
        id: row.lab_orders.id,
        results: [result],
      });
    }
  }

  const orders = [...byId.values()];
  for (const order of orders) {
    order.results.sort(
      (a, b) => b.resultDate.getTime() - a.resultDate.getTime(),
    );
  }

  return {
    orders,
    truncated:
      openRows.length >= WORKLIST_OPEN_LIMIT ||
      closedRows.length >= LAB_WORKLIST_CLOSED_LIMIT ||
      unreviewedRows.length >= WORKLIST_UNREVIEWED_LIMIT,
  };
}

export interface LabSessionUser {
  id: string;
  email: string | null;
}

/**
 * The Supabase account this device is signed in with, or null. Lab tables
 * are only readable by signed-in admin/doctor/nurse accounts, so a device
 * with only a PIN sign-in sees no lab orders at all.
 */
export async function getLabSessionUser(): Promise<LabSessionUser | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    return user ? { id: user.id, email: user.email ?? null } : null;
  } catch (error) {
    logger.warn(
      "[labs] Could not read the Supabase session:",
      error instanceof Error ? error.name : "unknown",
    );
    return null;
  }
}

/**
 * The staff id to store in ordered_by / reviewed_by (foreign keys to
 * app_users). Online sign-in can keep an older local user record whose id
 * differs from the Supabase account id, so the session id is used when the
 * session provably belongs to the same person (same id or same email).
 * Otherwise the local id is used: a shared tablet can still hold someone
 * else's Supabase session, and an order must never be credited to them.
 */
export async function resolveLabActorId(localUser: {
  id: string;
  email?: string | null;
}): Promise<string> {
  const session = await getLabSessionUser();
  return session && sessionMatchesUser(session, localUser)
    ? session.id
    : localUser.id;
}

/**
 * True when the Supabase session provably belongs to this local user (same
 * id, or same email). Used to credit and to name the right person.
 */
export function sessionMatchesUser(
  session: LabSessionUser,
  localUser: { id: string; email?: string | null },
): boolean {
  if (session.id === localUser.id) return true;
  const localEmail = localUser.email?.trim().toLowerCase();
  return !!localEmail && session.email?.trim().toLowerCase() === localEmail;
}
