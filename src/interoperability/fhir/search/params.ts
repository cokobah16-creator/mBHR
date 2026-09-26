// Search parameter parsing. Only the parameters a resource declares are
// accepted; anything else is refused with 400 rather than silently ignored,
// so a client never believes a filter was applied when it was not. Values
// are parsed into typed filters here and never passed through as raw text:
// the repository turns them into parameterised PostgREST filters. A
// parameter a type refuses with its own explanation
// (ResourceDefinition.refusedSearchParams) is answered with that
// explanation, whatever its value, modifier or the rest of the query.

import { errors } from "../errors/operationOutcome";

export type SearchParamType = "token" | "reference" | "date" | "string";

export interface SearchParamDef {
  name: string;
  type: SearchParamType;
  documentation: string;
  /**
   * What the parameter does for a patient reading their own records.
   * Published after `documentation` only while patient access is on
   * (FHIR_PATIENT_ACCESS_ENABLED), like ResourceDefinition.patientAccessNotes,
   * so `documentation` itself must not describe patients.
   */
  patientDocumentation?: string;
  /** Up to this many occurrences (default 1). Used for date ranges. */
  maxRepeats?: number;
}

export interface TokenValue {
  system: string | null; // null: any system; "": explicitly no system
  code: string;
}

export interface DateBound {
  /** Inclusive lower bound (ISO), or null for open. */
  from: string | null;
  /** Exclusive upper bound (ISO), or null for open. */
  to: string | null;
}

export interface ParsedSearch {
  /** Single-valued params by name (token and string raw value retained). */
  values: Map<string, string[]>;
  count: number;
  cursor: Cursor | null;
}

export interface Cursor {
  /** Last source key returned on the previous page. */
  k: string;
  /** For sources that expand to several resources: last sub-index emitted. */
  s?: number;
  /** For searches over several sources: which source the page stopped in. */
  p?: string;
  /**
   * Binding: a digest of the resource type, the search parameters, the
   * caller and their scope. A cursor only continues the search it came
   * from; it never carries filters, so it cannot widen what a search sees.
   */
  b?: string;
}

/** FHIR R4 id: 1-64 of [A-Za-z0-9-.]. */
export const FHIR_ID = /^[A-Za-z0-9\-.]{1,64}$/;

const MAX_VALUE_LENGTH = 256;
export const RESULT_PARAMS: ReadonlySet<string> = new Set(["_count", "_cursor", "_format"]);

/**
 * A parameter a type refuses with its own explanation instead of the generic
 * "not supported" (ResourceDefinition.refusedSearchParams).
 */
export interface RefusedSearchParam {
  name: string;
  /** The fixed, caller-safe diagnostics of the 400 not-supported answer. */
  diagnostics: string;
}

export function parseSearch(
  query: URLSearchParams,
  defs: SearchParamDef[],
  paging: { defaultCount: number; maxCount: number; cursorBinding?: string },
  refused: readonly RefusedSearchParam[] = [],
): ParsedSearch {
  // A parameter the type refuses with its own explanation gets that
  // explanation whatever its value or modifier (name:modifier) and whatever
  // else the query holds, so the caller always learns what to ask instead.
  for (const rawName of query.keys()) {
    const r = refused.find((p) => p.name === rawName.split(":")[0]);
    if (r) throw errors.notSupported(r.diagnostics);
  }
  const byName = new Map(defs.map((d) => [d.name, d]));
  const values = new Map<string, string[]>();
  let count = paging.defaultCount;
  let cursor: Cursor | null = null;
  const seenResultParams = new Set<string>();

  for (const [rawName, rawValue] of query) {
    if (rawName.includes(":")) {
      throw errors.notSupported(`Search modifiers are not supported (${safeName(rawName)}).`);
    }
    if (rawValue.length > MAX_VALUE_LENGTH) {
      throw errors.badRequest(`The value of ${safeName(rawName)} is too long.`);
    }
    if (RESULT_PARAMS.has(rawName)) {
      if (seenResultParams.has(rawName)) {
        throw errors.badRequest(`${rawName} may appear only once.`);
      }
      seenResultParams.add(rawName);
      if (rawName === "_count") count = parseCount(rawValue, paging.maxCount);
      else if (rawName === "_cursor") cursor = decodeCursor(rawValue, paging.cursorBinding);
      else if (!["json", "application/json", "application/fhir+json"].includes(rawValue)) {
        throw errors.notSupported("Only the JSON format is supported.");
      }
      continue;
    }
    const def = byName.get(rawName);
    if (!def) {
      throw errors.notSupported(`Search parameter ${safeName(rawName)} is not supported.`);
    }
    const list = values.get(rawName) ?? [];
    if (list.length >= (def.maxRepeats ?? 1)) {
      throw errors.badRequest(`${rawName} appears too many times.`);
    }
    if (def.type !== "date" && rawValue.includes(",")) {
      throw errors.notSupported(`Multiple values for ${rawName} are not supported.`);
    }
    if (rawValue.trim() === "") {
      throw errors.badRequest(`${rawName} needs a value.`);
    }
    list.push(rawValue.trim());
    values.set(rawName, list);
  }
  return { values, count, cursor };
}

function safeName(name: string): string {
  return name.replace(/[^A-Za-z0-9_\-:.]/g, "").slice(0, 40) || "(unnamed)";
}

function parseCount(raw: string, max: number): number {
  if (!/^\d{1,9}$/.test(raw)) throw errors.badRequest("_count must be a positive whole number.");
  const n = Number(raw);
  if (n < 1) throw errors.notSupported("_count=0 is not supported.");
  return Math.min(n, max);
}

export function encodeCursor(c: Cursor, binding?: string): string {
  const out: Cursor = { k: c.k };
  if (c.s !== undefined) out.s = c.s;
  if (c.p !== undefined) out.p = c.p;
  const b = binding ?? c.b;
  if (b !== undefined) out.b = b;
  return base64UrlEncode(JSON.stringify(out));
}

const CURSOR_KEY = /^[A-Za-z0-9\-._:|]{1,160}$/;

/**
 * Decode a _cursor. With a binding, a cursor issued for another search,
 * another caller or another scope is refused (400), as is anything that
 * is not a cursor this server wrote.
 */
export function decodeCursor(raw: string, binding?: string): Cursor {
  const bad = () => errors.badRequest("_cursor is not valid. Start the search again.");
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(raw)) throw bad();
  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlDecode(raw));
  } catch {
    throw bad();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw bad();
  const { k, s, p, b, ...rest } = parsed as { k?: unknown; s?: unknown; p?: unknown; b?: unknown };
  if (Object.keys(rest).length) throw bad();
  if (typeof k !== "string" || !CURSOR_KEY.test(k)) throw bad();
  const out: Cursor = { k };
  if (s !== undefined) {
    if (typeof s !== "number" || !Number.isInteger(s) || s < 0 || s > 64) throw bad();
    out.s = s;
  }
  if (p !== undefined) {
    if (typeof p !== "string" || !/^[a-z]{1,8}$/.test(p)) throw bad();
    out.p = p;
  }
  if (b !== undefined) {
    if (typeof b !== "string" || !/^[0-9a-f]{16,64}$/.test(b)) throw bad();
    out.b = b;
  }
  if (binding !== undefined && out.b !== binding) throw bad();
  return out;
}

/**
 * The cursor binding for a search: the first 32 hex digits of SHA-256 over
 * the resource type, the search parameters (sorted, without paging), the
 * caller's account and their scope. It is not a secret: filters are always
 * re-applied from the request, so the binding keeps a cursor with its own
 * search rather than guarding data.
 */
export async function cursorBinding(input: {
  resourceType: string;
  query: URLSearchParams;
  userId: string;
  scope: string;
}): Promise<string> {
  const params = [...input.query.entries()]
    .filter(([k]) => k !== "_cursor" && k !== "_count" && k !== "_format")
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  const text = [input.resourceType, params.join("&"), input.userId, input.scope].join("\n");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(text: string): string {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

// ---------------------------------------------------------------------------
// Typed value parsers
// ---------------------------------------------------------------------------

export function parseToken(raw: string, name: string): TokenValue {
  const idx = raw.indexOf("|");
  const system = idx >= 0 ? raw.slice(0, idx) : null;
  const code = idx >= 0 ? raw.slice(idx + 1) : raw;
  if (!code || code.includes("|")) throw errors.badRequest(`${name} is not a valid token.`);
  if (system && !/^[\x21-\x7e]{1,200}$/.test(system)) {
    throw errors.badRequest(`${name} has an invalid system.`);
  }
  if (!/^[^\s,$|\\]{1,128}$/.test(code)) throw errors.badRequest(`${name} has an invalid code.`);
  return { system, code };
}

/**
 * A reference search value for the given target type: "Type/id" or a bare
 * id. Absolute URLs and other resource types are refused.
 */
export function parseReferenceId(raw: string, targetType: string, name: string): string {
  const prefix = `${targetType}/`;
  const id = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
  if (id.includes("/")) {
    throw errors.notSupported(`${name} must reference a ${targetType} as ${targetType}/[id].`);
  }
  if (!FHIR_ID.test(id)) throw errors.badRequest(`${name} is not a valid ${targetType} id.`);
  return id;
}

export function parseId(raw: string, name = "_id"): string {
  if (!FHIR_ID.test(raw)) throw errors.badRequest(`${name} is not a valid id.`);
  return raw;
}

const DATE_RE =
  /^(eq|ge|le|gt|lt)?(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2}))?)?)?$/;

/**
 * mBHR clinics run on West Africa Time (Africa/Lagos, UTC+01:00, no
 * daylight saving). A date without a time (date=2026-09-25) means that
 * clinic day, 00:00 to 24:00 in Lagos, not a UTC day: otherwise a visit at
 * 00:30 in Lagos would fall on the previous date.
 */
export const CLINIC_TIME_ZONE = "Africa/Lagos";
export const CLINIC_UTC_OFFSET_MINUTES = 60;

/** Midnight in the clinic time zone at the start of y-m-d (any year, including < 100). */
function clinicMidnight(year: number, monthIndex: number, day: number): Date {
  const t = new Date(0);
  t.setUTCFullYear(year, monthIndex, day);
  t.setUTCHours(0, 0, 0, 0);
  return new Date(t.getTime() - CLINIC_UTC_OFFSET_MINUTES * 60_000);
}

/**
 * Parse a FHIR date search value (prefixes eq, ge, le, gt, lt) into a
 * half-open [from, to) range over instants. A date without a time is a
 * clinic day (Africa/Lagos); a dateTime must carry a zone, so no local-time
 * guess is made for it.
 */
export function parseDateSearch(raw: string, name: string): DateBound {
  const m = DATE_RE.exec(raw);
  if (!m) throw errors.badRequest(`${name} is not a valid date search value.`);
  const [, prefix = "eq", y, mo, d, hh, mi, ss, tz] = m;
  if (hh !== undefined && tz === undefined) {
    throw errors.badRequest(`${name} needs a time zone when a time is given.`);
  }
  const year = Number(y);
  const month = mo ? Number(mo) : null;
  const day = d ? Number(d) : null;
  if (month !== null && (month < 1 || month > 12)) throw errors.badRequest(`${name} has an invalid month.`);

  let start: Date;
  let end: Date;
  if (hh !== undefined) {
    const iso = `${y}-${mo}-${d}T${hh}:${mi}:${ss ?? "00"}${tz === "Z" ? "Z" : tz}`;
    start = new Date(iso);
    if (Number.isNaN(start.getTime())) throw errors.badRequest(`${name} is not a valid date.`);
    end = new Date(start.getTime() + (ss === undefined ? 60_000 : 1000));
  } else if (day !== null && month !== null) {
    const check = new Date(0);
    check.setUTCFullYear(year, month - 1, day);
    if (check.getUTCMonth() !== month - 1) throw errors.badRequest(`${name} is not a valid date.`);
    start = clinicMidnight(year, month - 1, day);
    end = clinicMidnight(year, month - 1, day + 1);
  } else if (month !== null) {
    start = clinicMidnight(year, month - 1, 1);
    end = clinicMidnight(year, month, 1);
  } else {
    start = clinicMidnight(year, 0, 1);
    end = clinicMidnight(year + 1, 0, 1);
  }
  const s = start.toISOString();
  const e = end.toISOString();
  switch (prefix) {
    case "eq":
      return { from: s, to: e };
    case "ge":
      return { from: s, to: null };
    case "gt":
      return { from: e, to: null };
    case "lt":
      return { from: null, to: s };
    case "le":
      return { from: null, to: e };
    default:
      throw errors.badRequest(`${name} has an unsupported prefix.`);
  }
}

/** Intersect several date bounds (date=ge2024&date=lt2025). */
export function intersectDates(bounds: DateBound[]): DateBound {
  let from: string | null = null;
  let to: string | null = null;
  for (const b of bounds) {
    if (b.from && (!from || b.from > from)) from = b.from;
    if (b.to && (!to || b.to < to)) to = b.to;
  }
  return { from, to };
}

/** A plain calendar date (birthdate): YYYY-MM-DD, optionally with eq. */
export function parseExactDate(raw: string, name: string): string {
  const m = /^(?:eq)?(\d{4}-\d{2}-\d{2})$/.exec(raw);
  if (!m) throw errors.notSupported(`${name} supports only an exact date (YYYY-MM-DD).`);
  const t = new Date(`${m[1]}T00:00:00Z`);
  if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== m[1]) {
    throw errors.badRequest(`${name} is not a valid date.`);
  }
  return m[1];
}

/**
 * A human name search string: letters (any script), spaces, hyphens and
 * apostrophes only, 2-64 characters. Anything else is refused, so the value
 * can never carry filter syntax or wildcards.
 */
export function parseNameSearch(raw: string, name: string): string {
  const v = raw.normalize("NFC").trim();
  if (!/^[\p{L}\p{M}' -]{2,64}$/u.test(v)) {
    throw errors.badRequest(`${name} must be 2-64 letters, spaces, hyphens or apostrophes.`);
  }
  return v;
}
