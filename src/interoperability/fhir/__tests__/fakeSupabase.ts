// An in-memory stand-in for Supabase Auth, PostgREST and Storage, enough to
// drive the gateway end to end in tests. It evaluates the filter forms the
// gateway emits (eq, neq, gt, gte, lt, lte, is, in, not.<op>, ilike with *
// wildcards and \ escapes, or(...) and and(...) groups), simulates
// row-level security with a per-table visibility function, and implements
// the fhir_* database functions the gateway calls with the same rules as
// the Phase 2 migration (who may record a permit, how merge chains
// resolve), so tests can show that what the database hides stays hidden.

type Row = Record<string, unknown>;

export interface FakeUser {
  id: string;
  /** mBHR role (staff) or null. */
  role: string | null;
  permissions: string[];
  /** Default: "staff" when role is set, otherwise "none". */
  kind?: "staff" | "patient" | "none";
  /** Portal patients: internal ids of their linked records. */
  patientIds?: string[];
}

export type RpcHandler = (body: Record<string, unknown>, user: FakeUser, fake: FakeState) => unknown;

export interface FakeOptions {
  users: Record<string, FakeUser>; // token -> user
  tables: Record<string, Row[]>;
  /** RLS: may this user see this row? Default: everything. */
  visible?: (table: string, row: Row, user: FakeUser) => boolean;
  rateAllowed?: boolean;
  auditFails?: boolean;
  terminology?: { local_code: string; fhir_system: string; fhir_code: string; fhir_display: string | null }[];
  /** Rows fhir_consent_directives returns (already in its JSON shape). */
  consentDirectives?: Record<string, unknown>[];
  /** Storage objects by "bucket/path". */
  storage?: Record<string, { body: string; contentType: string | null }>;
  /** Storage policy: may this user download it? Default: yes. */
  storageVisible?: (key: string, user: FakeUser) => boolean;
  /** Extra or replacement database functions by name. */
  rpcs?: Record<string, RpcHandler>;
}

export interface FakeState {
  opts: FakeOptions;
  rows(table: string, user: FakeUser): Row[];
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

/** PostgREST ilike pattern (after unquoting): * is %, and LIKE's own % _ \ rules apply. */
function likeToRegExp(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) {
      re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (c === "*" || c === "%") re += ".*";
    else if (c === "_") re += ".";
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, "is");
}

function compare(s: string, arg: string): number {
  const a = unquote(arg);
  const na = Number(s);
  const nb = Number(a);
  if (s !== "" && a !== "" && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return s < a ? -1 : s > a ? 1 : 0;
}

function test(row: Row, col: string, expr: string): boolean {
  const v = row[col];
  const s = v === null || v === undefined ? null : typeof v === "object" ? JSON.stringify(v) : String(v);
  const dot = expr.indexOf(".");
  const op = dot < 0 ? expr : expr.slice(0, dot);
  const arg = dot < 0 ? "" : expr.slice(dot + 1);
  switch (op) {
    case "eq":
      return s !== null && s === unquote(arg);
    case "neq":
      return s !== null && s !== unquote(arg);
    case "gt":
      return s !== null && compare(s, arg) > 0;
    case "gte":
      return s !== null && compare(s, arg) >= 0;
    case "lt":
      return s !== null && compare(s, arg) < 0;
    case "lte":
      return s !== null && compare(s, arg) <= 0;
    case "is":
      if (arg === "null") return s === null;
      if (arg === "true") return v === true;
      if (arg === "false") return v === false;
      throw new Error(`fake: unsupported is.${arg}`);
    case "in":
      return s !== null && splitList(arg.slice(1, -1)).map(unquote).includes(s);
    case "not":
      // SQL: NOT (NULL op x) is NULL, which filters the row out, except for "is".
      return arg.startsWith("is.") ? !test(row, col, arg) : s !== null && !test(row, col, arg);
    case "ilike":
      return s !== null && likeToRegExp(unquote(arg)).test(s);
    default:
      throw new Error(`fake: unsupported operator ${op}`);
  }
}

/** One condition inside or(...)/and(...): "col.op.value", "or(...)" or "and(...)". */
function cond(row: Row, c: string): boolean {
  if (c.startsWith("or(")) return group(row, c.slice(2), "or");
  if (c.startsWith("and(")) return group(row, c.slice(3), "and");
  const i = c.indexOf(".");
  return test(row, c.slice(0, i), c.slice(i + 1));
}

function group(row: Row, g: string, kind: "or" | "and"): boolean {
  const parts = splitList(g.slice(1, -1));
  return kind === "or" ? parts.some((p) => cond(row, p)) : parts.every((p) => cond(row, p));
}

/** Column names a filter or or()/and() group refers to. */
function filterColumns(key: string, value: string): string[] {
  if (key !== "or" && key !== "and") return [key];
  const out: string[] = [];
  for (const c of splitList(value.slice(1, -1))) {
    if (c.startsWith("or(")) out.push(...filterColumns("or", c.slice(2)));
    else if (c.startsWith("and(")) out.push(...filterColumns("and", c.slice(3)));
    else out.push(c.slice(0, c.indexOf(".")));
  }
  return out;
}

function kindOf(user: FakeUser): "staff" | "patient" | "none" {
  return user.kind ?? (user.role ? "staff" : "none");
}

export function fakeSupabase(opts: FakeOptions) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const audits: Record<string, unknown>[] = [];
  const contexts: Record<string, unknown>[] = [];

  const state: FakeState = {
    opts,
    rows: (table, user) => (opts.tables[table] ?? []).filter((r) => (opts.visible ? opts.visible(table, r, user) : true)),
  };

  const resolvePatients: RpcHandler = (body, user) => {
    const patients = state.rows("patients", user);
    const byId = new Map(patients.map((p) => [String(p.id), p]));
    const fhirIds = (body.p_fhir_ids as string[] | null) ?? [];
    const ids = (body.p_ids as string[] | null) ?? [];
    const inputs: { input: string; row: Row }[] = [];
    for (const f of fhirIds) for (const p of patients) if (String(p.fhir_id) === f) inputs.push({ input: f, row: p });
    for (const i of ids) {
      const p = byId.get(i);
      if (p) inputs.push({ input: i, row: p });
    }
    return inputs.map(({ input, row }) => {
      let cur = row;
      let ok = true;
      let hops = 0;
      while (cur.merged_into) {
        if (hops >= 10) {
          ok = false;
          break;
        }
        const next = byId.get(String(cur.merged_into));
        if (!next) {
          ok = false;
          break;
        }
        cur = next;
        hops++;
      }
      const merged = row.merged_into != null || row.merged_at != null;
      if (!ok) {
        return { input, id: row.id, fhir_id: row.fhir_id, merged, canonical_id: null, canonical_fhir_id: null, chain_ok: false, member_ids: [] };
      }
      const members = new Set([String(cur.id)]);
      for (let depth = 0; depth < 10; depth++) {
        for (const p of patients) if (p.merged_into && members.has(String(p.merged_into))) members.add(String(p.id));
      }
      return {
        input,
        id: row.id,
        fhir_id: row.fhir_id,
        merged,
        canonical_id: cur.id,
        canonical_fhir_id: cur.fhir_id,
        chain_ok: cur.merged_at == null,
        member_ids: [...members].sort(),
      };
    });
  };

  const rpcs: Record<string, RpcHandler> = {
    fhir_gateway_context_v2: (body, user) => {
      contexts.push(body);
      const kind = kindOf(user);
      return {
        role: user.role,
        permissions: user.permissions,
        actor_kind: kind,
        patient_ids: kind === "patient" ? user.patientIds ?? [] : [],
        rate_allowed: opts.rateAllowed ?? true,
        retry_after_seconds: opts.rateAllowed === false ? 42 : null,
      };
    },
    fhir_record_access_v2: (body, user) => {
      if (opts.auditFails) return new Response(JSON.stringify({ code: "42P01" }), { status: 500 });
      const kind = kindOf(user);
      const ids = (body.p_patient_ids as string[]) ?? [];
      if (
        body.p_decision === "permit" &&
        !(kind === "staff" || (kind === "patient" && ids.length > 0 && ids.every((i) => (user.patientIds ?? []).includes(i))))
      ) {
        return new Response(JSON.stringify({ code: "42501" }), { status: 403 });
      }
      audits.push({ ...body, actor: user.id });
      return `00000000-0000-4000-8000-${String(audits.length).padStart(12, "0")}`;
    },
    fhir_resolve_patients: resolvePatients,
    fhir_consent_directives: (body) => {
      const ids = (body.p_patient_ids as string[]) ?? [];
      return (opts.consentDirectives ?? []).filter((d) => ids.includes(String(d.patient_id)));
    },
    // public.fhir_patient_lab_results: portal patients only (staff are
    // refused). Tests that need lab rows pass their own handler in opts.rpcs.
    fhir_patient_lab_results: (_body, user) =>
      kindOf(user) === "patient" ? [] : new Response(JSON.stringify({ code: "42501" }), { status: 403 }),
    fhir_terminology_lookup: (body) => {
      const codes: string[] = (body.p_codes as string[]) ?? [];
      return (opts.terminology ?? []).filter((t) => codes.includes(t.local_code));
    },
    ...opts.rpcs,
  };

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

    const rpc = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(url.pathname);
    if (rpc && method === "POST") {
      const fn = rpcs[rpc[1]];
      if (!fn) return json(404, { code: "PGRST202" });
      const out = fn(body ?? {}, user, state);
      return out instanceof Response ? out : json(200, out);
    }
    const storage = /^\/storage\/v1\/object\/authenticated\/([^/]+)\/(.+)$/.exec(url.pathname);
    if (storage && method === "GET") {
      const key = `${storage[1]}/${storage[2].split("/").map(decodeURIComponent).join("/")}`;
      const obj = opts.storage?.[key];
      if (!obj) return json(400, { error: "not_found" });
      if (opts.storageVisible && !opts.storageVisible(key, user)) return json(400, { error: "not_found" });
      const h: Record<string, string> = {};
      if (obj.contentType) h["Content-Type"] = obj.contentType;
      return new Response(obj.body, { status: 200, headers: h });
    }
    const m = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname);
    if (m && method === "GET") {
      const table = m[1];
      let rows = state.rows(table, user);
      let order: string | null = null;
      let limit: number | null = null;
      let select: string[] = [];
      for (const [k, v] of url.searchParams) {
        if (k === "select") select = v.split(",");
        else if (k === "order") order = v;
        else if (k === "limit") limit = Number(v);
        else if (k === "or") rows = rows.filter((r) => group(r, v, "or"));
        else if (k === "and") rows = rows.filter((r) => group(r, v, "and"));
        else rows = rows.filter((r) => test(r, k, v));
      }
      if (order) {
        const [col, dir] = order.split(".");
        rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0));
        if (dir === "desc") rows.reverse();
      }
      if (limit !== null) rows = rows.slice(0, limit);
      // A column no fixture row of the table has is treated as missing from
      // the database: PostgREST answers 400 (42703), as on a real database.
      const known = new Set((opts.tables[table] ?? []).flatMap((r) => Object.keys(r)));
      const filtered = [...url.searchParams]
        .filter(([k]) => !["select", "order", "limit"].includes(k))
        .flatMap(([k, v]) => filterColumns(k, v));
      if (known.size && [...select, ...filtered].some((c) => !known.has(c))) return json(400, { code: "42703" });
      const projected = rows.map((r) => Object.fromEntries(select.map((c) => [c, r[c] ?? null])));
      return json(200, projected);
    }
    return json(404, { message: "not found" });
  };

  return { fetchImpl, calls, audits, contexts };
}
