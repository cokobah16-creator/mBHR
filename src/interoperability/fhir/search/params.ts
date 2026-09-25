// Search parameter parsing. Only the parameters a resource declares are
// accepted; anything else is refused with 400 rather than silently ignored,
// so a client never believes a filter was applied when it was not. Values
// are parsed into typed filters here and never passed through as raw text:
// the repository turns them into parameterised PostgREST filters.

import { errors } from "../errors/operationOutcome";

export type SearchParamType = "token" | "reference" | "date" | "string";

export interface SearchParamDef {
  name: string;
  type: SearchParamType;
  documentation: string;
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
}

/** FHIR R4 id: 1-64 of [A-Za-z0-9-.]. */
export const FHIR_ID = /^[A-Za-z0-9\-.]{1,64}$/;

const MAX_VALUE_LENGTH = 256;
export const RESULT_PARAMS: ReadonlySet<string> = new Set(["_count", "_cursor", "_format"]);

export function parseSearch(
  query: URLSearchParams,
  defs: SearchParamDef[],
  paging: { defaultCount: number; maxCount: number },
): ParsedSearch {
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
      else if (rawName === "_cursor") cursor = decodeCursor(rawValue);
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

export function encodeCursor(c: Cursor): string {
  const json = JSON.stringify(c.s === undefined ? { k: c.k } : { k: c.k, s: c.s });
  return base64UrlEncode(json);
}

export function decodeCursor(raw: string): Cursor {
  const bad = () => errors.badRequest("_cursor is not valid. Start the search again.");
  if (!/^[A-Za-z0-9_-]{1,400}$/.test(raw)) throw bad();
  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlDecode(raw));
  } catch {
    throw bad();
  }
  if (!parsed || typeof parsed !== "object") throw bad();
  const { k, s } = parsed as { k?: unknown; s?: unknown };
  if (typeof k !== "string" || !/^[A-Za-z0-9\-._]{1,128}$/.test(k)) throw bad();
  if (s !== undefined && (typeof s !== "number" || !Number.isInteger(s) || s < 0 || s > 64)) {
    throw bad();
  }
  return s === undefined ? { k } : { k, s };
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
 * Parse a FHIR date search value (prefixes eq, ge, le, gt, lt) into a
 * half-open [from, to) range over instants. A value without a time zone is
 * read in UTC; a dateTime must carry a zone, so no local-time guess is made.
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
    start = new Date(Date.UTC(year, month - 1, day));
    if (start.getUTCMonth() !== month - 1) throw errors.badRequest(`${name} is not a valid date.`);
    end = new Date(Date.UTC(year, month - 1, day + 1));
  } else if (month !== null) {
    start = new Date(Date.UTC(year, month - 1, 1));
    end = new Date(Date.UTC(year, month, 1));
  } else {
    start = new Date(Date.UTC(year, 0, 1));
    end = new Date(Date.UTC(year + 1, 0, 1));
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
