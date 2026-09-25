// An in-memory stand-in for Supabase Auth and PostgREST, enough to drive the
// gateway end to end in tests. It evaluates exactly the filter forms the
// gateway emits (eq, neq, in, gt, gte, lt, is.null, not.in, or(...) with
// ilike) and simulates row-level security with a per-table visibility
// function, so tests can show that what the database hides stays hidden.

type Row = Record<string, unknown>;

export interface FakeUser {
  id: string;
  role: string | null;
  permissions: string[];
}

export interface FakeOptions {
  users: Record<string, FakeUser>; // token -> user
  tables: Record<string, Row[]>;
  /** RLS: may this user see this row? Default: everything. */
  visible?: (table: string, row: Row, user: FakeUser) => boolean;
  rateAllowed?: boolean;
  auditFails?: boolean;
  terminology?: { local_code: string; fhir_system: string; fhir_code: string; fhir_display: string | null }[];
}

export function makeToken(sub: string, overrides: Record<string, unknown> = {}): string {
  const enc = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const payload = { sub, aud: "authenticated", role: "authenticated", exp: 4102444800, ...overrides };
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc(payload)}.c2lnbmF0dXJl`;
}

function unquote(v: string): string {
  return v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\") : v;
}

function splitList(inner: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "\\" && q) {
      cur += c + inner[++i];
      continue;
    }
    if (c === '"') q = !q;
    if (!q && c === "(") depth++;
    if (!q && c === ")") depth--;
    if (c === "," && !q && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function test(row: Row, col: string, expr: string): boolean {
  const v = row[col];
  const s = v === null || v === undefined ? null : String(v);
  const [op, ...rest] = expr.split(".");
  const arg = rest.join(".");
  switch (op) {
    case "eq":
      return s !== null && s === unquote(arg);
    case "neq":
      return s !== null && s !== unquote(arg);
    case "gt":
      return s !== null && s > arg;
    case "gte":
      return s !== null && s >= arg;
    case "lt":
      return s !== null && s < arg;
    case "is":
      return arg === "null" ? s === null : false;
    case "in":
      return s !== null && splitList(arg.slice(1, -1)).map(unquote).includes(s);
    case "not":
      return s !== null && !test(row, col, arg);
    case "ilike": {
      if (s === null) return false;
      const pat = unquote(arg);
      const prefix = pat.endsWith("*") ? pat.slice(0, -1) : pat;
      return s.toLowerCase().startsWith(prefix.toLowerCase());
    }
    default:
      throw new Error(`fake: unsupported operator ${op}`);
  }
}

function orGroup(row: Row, group: string): boolean {
  return splitList(group.slice(1, -1)).some((cond) => {
    const i = cond.indexOf(".");
    return test(row, cond.slice(0, i), cond.slice(i + 1));
  });
}

export function fakeSupabase(opts: FakeOptions) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const audits: Record<string, unknown>[] = [];

  const fetchImpl = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: input, method, body });
    const headers = new Headers(init.headers);
    const token = (headers.get("authorization") ?? "").replace(/^Bearer /, "");
    const user = opts.users[token];
    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

    if (url.pathname === "/auth/v1/user") {
      return user ? json(200, { id: user.id }) : json(401, { msg: "invalid JWT" });
    }
    if (!user) return json(401, { message: "JWT expired" });

    if (url.pathname === "/rest/v1/rpc/fhir_gateway_context") {
      return json(200, {
        role: user.role,
        permissions: user.permissions,
        rate_allowed: opts.rateAllowed ?? true,
        retry_after_seconds: opts.rateAllowed === false ? 42 : null,
      });
    }
    if (url.pathname === "/rest/v1/rpc/fhir_record_access") {
      if (opts.auditFails) return json(500, { message: 'relation "interop.access_audit" does not exist' });
      audits.push({ ...body, actor: user.id });
      return json(200, `audit-${audits.length}`);
    }
    if (url.pathname === "/rest/v1/rpc/fhir_terminology_lookup") {
      const codes: string[] = body?.p_codes ?? [];
      return json(200, (opts.terminology ?? []).filter((t) => codes.includes(t.local_code)));
    }
    const m = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname);
    if (m && method === "GET") {
      const table = m[1];
      let rows = (opts.tables[table] ?? []).filter((r) => (opts.visible ? opts.visible(table, r, user) : true));
      let order: string | null = null;
      let limit: number | null = null;
      let select: string[] = [];
      for (const [k, v] of url.searchParams) {
        if (k === "select") select = v.split(",");
        else if (k === "order") order = v;
        else if (k === "limit") limit = Number(v);
        else if (k === "or") rows = rows.filter((r) => orGroup(r, v));
        else rows = rows.filter((r) => test(r, k, v));
      }
      if (order) {
        const [col, dir] = order.split(".");
        rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0));
        if (dir === "desc") rows.reverse();
      }
      if (limit !== null) rows = rows.slice(0, limit);
      const projected = rows.map((r) => Object.fromEntries(select.map((c) => [c, r[c] ?? null])));
      return json(200, projected);
    }
    return json(404, { message: "not found" });
  };

  return { fetchImpl, calls, audits };
}
