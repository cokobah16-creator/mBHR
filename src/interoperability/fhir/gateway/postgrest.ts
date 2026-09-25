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

export const READABLE_TABLES = ["patients", "visits", "vitals", "conditions"] as const;
export type ReadableTable = (typeof READABLE_TABLES)[number];

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
    if (!/^fhir_[a-z_]+$/.test(fn)) throw errors.internal();
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
    if (res.status === 401) throw errors.unauthenticated("The session is not valid. Sign in again.");
    // Anything else (a policy refusal, a missing function or column on this
    // database, an overload) is reported without detail.
    throw new FhirError(res.status === 403 ? 403 : 503, res.status === 403 ? "forbidden" : "exception",
      res.status === 403 ? "The requested resource is not available to this client." : "The service is temporarily unavailable.");
  }
}

/** Quote a value for use inside a PostgREST in.(...) list or or=(...) group. */
export function pgrstQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
