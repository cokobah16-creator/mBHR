/**
 * Lab results for the patient portal.
 *
 * The only patient read path is the server function portal_my_lab_results
 * (supabase/migrations/20260925100500_lab_results_release.sql). It returns
 * the signed-in patient's own results that staff have reviewed AND released,
 * from the same lab_orders / lab_results records staff work on. A result
 * that is unreviewed, not yet released, withheld or replaced is never
 * returned, and a disabled or merged-away portal record gets nothing.
 *
 * Results are held in memory only, never cached on the device: the phone
 * may be shared. A patient signed in only through the local PIN portal has
 * no online sign-in, so the server cannot return their results; that is
 * reported as "not_signed_in", not as "no results".
 */
import { supabase } from "@/lib/supabase";
import * as logger from "@/lib/logger";
import type {
  PortalLabInterpretation,
  PortalLabResult,
  PortalLabResultsLoad,
} from "@/types/patientPortal";

/** Rows the portal list asks for (the server caps it at 500). */
export const PORTAL_LAB_RESULTS_LIMIT = 100;

/** A row as portal_my_lab_results returns it. */
export interface PortalLabResultRow {
  result_id: string;
  order_id: string;
  patient_id: string;
  test_name: string | null;
  test_code: string | null;
  specimen_type: string | null;
  ordered_at: string | null;
  result_value: string | null;
  result_unit: string | null;
  reference_range: string | null;
  interpretation: string | null;
  result_date: string | null;
  released_at: string | null;
  patient_note: string | null;
}

/** The parts of the Supabase client this module uses. */
export interface PortalLabClient {
  auth: {
    getSession: () => Promise<{
      data: { session: { user?: { id?: string } | null } | null };
      error?: unknown;
    }>;
  };
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
}

export interface FetchPortalLabOptions {
  /** How many results (newest first). Default PORTAL_LAB_RESULTS_LIMIT. */
  limit?: number;
  /**
   * Narrow to one of the signed-in account's own records (a caregiver's
   * managed profile). The server ignores any record that is not theirs.
   */
  patientId?: string;
  /**
   * The portal account this page belongs to (the stored portal user's id,
   * which is the Supabase account id for an online sign-in). When the
   * device is signed in online as a different account (for example staff
   * on a shared phone), the server would answer for that account, so the
   * result is "not_signed_in" instead of an empty list.
   */
  accountId?: string;
  /** For tests: the client to use (default: the app's Supabase client). */
  client?: PortalLabClient | null;
  /** For tests: whether the device reports a connection. */
  online?: boolean;
}

const INTERPRETATIONS: readonly PortalLabInterpretation[] = [
  "normal",
  "abnormal",
  "critical",
];

/** The stored interpretation, or "unknown" (never read as normal). */
export function toPortalInterpretation(value: unknown): PortalLabInterpretation {
  return typeof value === "string" &&
    (INTERPRETATIONS as readonly string[]).includes(value)
    ? (value as PortalLabInterpretation)
    : "unknown";
}

function toDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return isNaN(d.getTime()) ? undefined : d;
}

const text = (value: string | null | undefined): string | undefined => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : undefined;
};

/** Maps one server row. Rows without ids are dropped by mapPortalLabRows. */
export function mapPortalLabRow(row: PortalLabResultRow): PortalLabResult {
  return {
    resultId: String(row.result_id),
    orderId: String(row.order_id),
    patientId: String(row.patient_id),
    testName: text(row.test_name) ?? "Lab test",
    testCode: text(row.test_code),
    specimenType: text(row.specimen_type),
    orderedAt: toDate(row.ordered_at),
    resultValue: typeof row.result_value === "string" ? row.result_value : "",
    resultUnit: text(row.result_unit),
    referenceRange: text(row.reference_range),
    interpretation: toPortalInterpretation(row.interpretation),
    resultDate: toDate(row.result_date),
    releasedAt: toDate(row.released_at),
    patientNote: text(row.patient_note),
  };
}

/** Maps the RPC answer, newest result first, skipping malformed rows. */
export function mapPortalLabRows(data: unknown): PortalLabResult[] {
  if (!Array.isArray(data)) return [];
  const rows = data.filter(
    (r): r is PortalLabResultRow =>
      !!r &&
      typeof r === "object" &&
      !!(r as PortalLabResultRow).result_id &&
      !!(r as PortalLabResultRow).order_id,
  );
  return rows
    .map(mapPortalLabRow)
    .sort(
      (a, b) =>
        (b.resultDate?.getTime() ?? 0) - (a.resultDate?.getTime() ?? 0),
    );
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "";
}

const errorName = (error: unknown) =>
  error instanceof Error ? error.name : errorCode(error) || "unknown";

function deviceOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

/**
 * The signed-in patient's reviewed and released lab results. Never throws:
 * the status says whether the list is real ("ok") or why it is empty.
 */
export async function fetchMyReleasedLabResults(
  options: FetchPortalLabOptions = {},
): Promise<PortalLabResultsLoad> {
  const client: PortalLabClient | null =
    options.client !== undefined
      ? options.client
      : (supabase as unknown as PortalLabClient | null);
  if (!client) return { status: "unavailable", results: [] };

  const online = options.online ?? deviceOnline();
  if (!online) return { status: "offline", results: [] };

  try {
    const { data: sessionData } = await client.auth.getSession();
    const sessionUserId = sessionData?.session?.user?.id;
    if (!sessionUserId) {
      return { status: "not_signed_in", results: [] };
    }
    if (options.accountId && options.accountId !== sessionUserId) {
      return { status: "not_signed_in", results: [] };
    }
  } catch (error) {
    logger.warn("[portal labs] Could not read the sign-in:", errorName(error));
    return { status: "failed", results: [] };
  }

  const requested = Number.isFinite(options.limit)
    ? Math.floor(options.limit as number)
    : PORTAL_LAB_RESULTS_LIMIT;
  const limit = Math.min(Math.max(requested, 1), 500);

  try {
    const { data, error } = await client.rpc("portal_my_lab_results", {
      p_limit: limit,
      p_patient_id: options.patientId ?? null,
    });
    if (error) {
      const code = errorCode(error);
      // Error codes only: messages can echo row data.
      logger.error("[portal labs] Could not load lab results:", code || errorName(error));
      if (code === "PGRST202" || code === "42883") {
        return { status: "not_updated", results: [] };
      }
      if (code === "42501" || code === "PGRST301") {
        return { status: "not_signed_in", results: [] };
      }
      return { status: "failed", results: [] };
    }
    return { status: "ok", results: mapPortalLabRows(data) };
  } catch (error) {
    logger.error("[portal labs] Could not load lab results:", errorName(error));
    return { status: "failed", results: [] };
  }
}
