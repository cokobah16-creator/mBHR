// A minimal PostgREST client that always acts as the signed-in caller.
//
// The gateway holds only the project's anon (publishable) key. Every query
// carries the caller's own access token, so Postgres row-level security
// decides which rows come back, exactly as it does for the mBHR app. There
// is no service-role key anywhere in this path.
//
// Tables and columns come from fixed allowlists; filter values are placed
// in URLSearchParams (URL-encoded) after the search layer has parsed and
// validated them, so no caller text is ever spliced into filter syntax.

import { FhirError, errors } from "../errors/operationOutcome";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Every table the gateway may read, as the caller. */
export const READABLE_TABLES = [
  "patients",
  "visits",
  "vitals",
  "conditions",
  "patient_allergies",
  "pharmacy_items",
  "prescriptions",
  "dispenses",
  "lab_orders",
  "lab_results",
  "lab_result_release_log",
  "patient_documents",
  "patient_merges",
  "organizations",
  "sites",
] as const;
export type ReadableTable = (typeof READABLE_TABLES)[number];

/** Database functions the gateway may call: the fhir_* family only. */
export const RPC_NAME = /^fhir_[a-z0-9_]+$/;

export interface PostgrestOptions {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  fetchImpl: FetchLike;
}

export class Postgrest {
  constructor(private readonly opts: PostgrestOptions) {}

  private headers(): Record<string, string> {
    return {
      apikey: this.opts.anonKey,
      Authorization: `Bearer ${this.opts.accessToken}`,
      Accept: "application/json",
    };
  }

  async select(
    table: ReadableTable,
    columns: readonly string[],
    filters: [string, string][],
    opts: { order?: string; limit?: number } = {},
  ): Promise<Record<string, unknown>[]> {
    if (!READABLE_TABLES.includes(table)) throw errors.internal();
    const params = new URLSearchParams();
    params.set("select", columns.join(","));
    for (const [k, v] of filters) params.append(k, v);
    if (opts.order) params.set("order", opts.order);
    if (opts.limit !== undefined) params.set("limit", String(opts.limit));
    const res = await this.call(`${this.opts.supabaseUrl}/rest/v1/${table}?${params.toString()}`, {
      method: "GET",
      headers: this.headers(),
    });
    const body = await res.json();
    if (!Array.isArray(body)) throw errors.unavailable();
    return body as Record<string, unknown>[];
  }

  async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    if (!RPC_NAME.test(fn)) throw errors.internal();
    const res = await this.call(`${this.opts.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    return (await res.json()) as T;
  }

  private async call(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await this.opts.fetchImpl(url, init);
    } catch {
      throw errors.unavailable();
    }
    if (res.ok) return res;
    throw await postgrestError(res);
  }
}

/**
 * A PostgREST failure as a caller-safe FhirError. Only the SQLSTATE is
 * looked at, never the message (it can name tables, columns or values).
 *
 *   401                    the session is not valid
 *   42501 / HTTP 403       refused by a policy or a function's own check
 *   22P02, 22023, 22007    a value the database could not accept for its
 *                          column (e.g. a malformed id): the request is bad
 *   anything else          503 without detail (a missing function or column
 *                          on this database, an overload)
 */
export async function postgrestError(res: Response): Promise<FhirError> {
  if (res.status === 401) return errors.unauthenticated("The session is not valid. Sign in again.");
  let code: unknown;
  try {
    code = ((await res.json()) as { code?: unknown })?.code;
  } catch {
    code = undefined;
  }
  if (res.status === 403 || code === "42501") return errors.forbidden();
  if (code === "22P02" || code === "22023" || code === "22007" || code === "22008") {
    return errors.badRequest("A search or id value is not valid for this field.");
  }
  return new FhirError(503, "exception", "The service is temporarily unavailable.");
}

/** Quote a value for use inside a PostgREST in.(...) list or or=(...) group. */
export function pgrstQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** A PostgREST in.(...) list of quoted values. */
export function inList(values: Iterable<string>): string {
  return `in.(${[...values].map(pgrstQuote).join(",")})`;
}
