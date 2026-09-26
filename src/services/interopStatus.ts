/**
 * Read-only status for Admin Settings -> Interoperability.
 *
 * Two sources:
 * - GET /fhir/R4/metadata on this site. 404 means the interface is off;
 *   200 with a capability statement means it is on. The response header
 *   X-MBHR-FHIR-Flags carries the on/off flags
 *   ("read=on; patient=off; consent=on; audit=on; external=off; write=off; smart=off").
 * - fhir_interop_admin_status() (audit_access or users holders): request
 *   and refusal counts and the latest requests and refusals, without ids.
 *
 * Everything shown is re-checked here against strict patterns, so a
 * changed server answer can never put ids, tokens, keys or patient data on
 * the screen. No imports from the app, so this is unit-testable on its own.
 */
import {
  callInteropRpc,
  toCount,
  toTimestamp,
  type InteropRpcClient,
  type RpcFailure,
} from "./interopRpc";

export const METADATA_PATH = "/fhir/R4/metadata";
export const FLAGS_HEADER = "X-MBHR-FHIR-Flags";

export type FlagKey = "read" | "patient" | "consent" | "audit" | "external" | "write" | "smart";

/** true = on, false = off, null = not reported (unknown). */
export type FhirFlags = Record<FlagKey, boolean | null>;

const FLAG_KEYS: FlagKey[] = ["read", "patient", "consent", "audit", "external", "write", "smart"];

export function unknownFlags(): FhirFlags {
  return {
    read: null,
    patient: null,
    consent: null,
    audit: null,
    external: null,
    write: null,
    smart: null,
  };
}

/**
 * Parses the flags header. A missing header, a missing key or a value that
 * is not on/off leaves that flag unknown (null), never off.
 */
export function parseFlagsHeader(value: string | null | undefined): FhirFlags {
  const flags = unknownFlags();
  if (typeof value !== "string" || value.length > 512) return flags;
  for (const part of value.split(/[;,]/)) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const raw = part.slice(eq + 1).trim().toLowerCase();
    if (!(FLAG_KEYS as string[]).includes(key)) continue;
    const on = raw === "on" || raw === "true" || raw === "1" || raw === "yes";
    const off = raw === "off" || raw === "false" || raw === "0" || raw === "no";
    if (on || off) flags[key as FlagKey] = on;
  }
  return flags;
}

export interface FlagRow {
  key: FlagKey;
  label: string;
  value: string;
}

function yesNo(v: boolean | null): string {
  return v === null ? "Unknown" : v ? "Yes" : "No";
}

function onOff(v: boolean | null): string {
  return v === null ? "Unknown" : v ? "On" : "Off";
}

/** The flags as label/value rows for the admin screen. */
export function describeFlags(flags: FhirFlags): FlagRow[] {
  return [
    { key: "external", label: "External apps", value: yesNo(flags.external) },
    { key: "smart", label: "SMART", value: yesNo(flags.smart) },
    { key: "write", label: "Writes", value: yesNo(flags.write) },
    { key: "patient", label: "Patient access", value: onOff(flags.patient) },
    { key: "consent", label: "Consent enforcement", value: onOff(flags.consent) },
    { key: "read", label: "Read and search", value: onOff(flags.read) },
    { key: "audit", label: "Audit", value: onOff(flags.audit) },
  ];
}

/**
 * - on: the interface answered with a capability statement
 * - off: 404 (switched off, or not deployed on this site)
 * - unavailable: it answered with a server error (5xx)
 * - unknown: an answer that is not a capability statement (for example the
 *   app page itself on a development server)
 * - offline: the device is offline or the request failed
 */
export type InterfaceState = "on" | "off" | "unavailable" | "unknown" | "offline";

export interface MetadataSummary {
  state: InterfaceState;
  fhirVersion: string | null;
  softwareVersion: string | null;
  baseUrl: string | null;
  resources: string[];
  flags: FhirFlags;
}

function obj(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,39}$/;
const RESOURCE_TYPE = /^[A-Z][A-Za-z]{1,63}$/;

function version(value: unknown): string | null {
  return typeof value === "string" && VERSION.test(value) ? value : null;
}

/**
 * The base URL without credentials, query or fragment (http/https only),
 * or null.
 */
export function safeBaseUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 512) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return null;
  }
}

/** Reads a metadata answer: HTTP status, parsed JSON body and flags header. */
export function summarizeMetadata(
  httpStatus: number,
  body: unknown,
  flagsHeader: string | null | undefined,
): MetadataSummary {
  const flags = parseFlagsHeader(flagsHeader);
  const empty = {
    fhirVersion: null,
    softwareVersion: null,
    baseUrl: null,
    resources: [] as string[],
    flags,
  };
  if (httpStatus === 404) return { state: "off", ...empty };
  if (httpStatus >= 500) return { state: "unavailable", ...empty };
  const cs = obj(body);
  if (httpStatus !== 200 || !cs || cs.resourceType !== "CapabilityStatement") {
    return { state: "unknown", ...empty };
  }
  const rest = Array.isArray(cs.rest) ? obj(cs.rest[0]) : null;
  const resources: string[] = [];
  if (rest && Array.isArray(rest.resource)) {
    for (const r of rest.resource) {
      const type = obj(r)?.type;
      if (typeof type === "string" && RESOURCE_TYPE.test(type) && !resources.includes(type)) {
        resources.push(type);
      }
    }
  }
  resources.sort();
  return {
    state: "on",
    fhirVersion: version(cs.fhirVersion),
    softwareVersion: version(obj(cs.software)?.version),
    baseUrl: safeBaseUrl(obj(cs.implementation)?.url),
    resources,
    flags,
  };
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    credentials?: "omit" | "same-origin" | "include";
    cache?: "no-store";
    signal?: AbortSignal;
  },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

/**
 * Fetches the metadata of the interface on `origin`. Never throws. No
 * credentials are sent: the metadata is public.
 */
export async function fetchMetadataSummary(
  fetchImpl: FetchLike | null | undefined,
  origin: string,
  online: boolean,
  timeoutMs = 8000,
): Promise<MetadataSummary> {
  const none = (state: InterfaceState): MetadataSummary => ({
    state,
    fhirVersion: null,
    softwareVersion: null,
    baseUrl: null,
    resources: [],
    flags: unknownFlags(),
  });
  if (online === false || !fetchImpl) return none("offline");
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(`${origin.replace(/\/+$/, "")}${METADATA_PATH}`, {
      method: "GET",
      headers: { Accept: "application/fhir+json" },
      credentials: "omit",
      cache: "no-store",
      signal: controller?.signal,
    });
    let body: unknown = null;
    if (res.status === 200) {
      try {
        body = await res.json();
      } catch {
        body = null;
      }
    }
    return summarizeMetadata(res.status, body, res.headers.get(FLAGS_HEADER));
  } catch {
    return none("offline");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface AuditRow {
  occurredAt: string;
  action: string;
  resourceType: string | null;
  decision: "permit" | "deny" | null;
  reason: string | null;
  role: string | null;
  httpStatus: number | null;
}

export interface AdminStatus {
  requests24h: number | null;
  denials24h: number | null;
  requests7d: number | null;
  denials7d: number | null;
  recent: AuditRow[];
  recentDenials: AuditRow[];
  consent: { records: number | null; active: number | null; withdrawn: number | null } | null;
}

const ACTION = /^[a-z][a-z_]{0,31}$/;
const REASON = /^[a-z][a-z0-9_]{0,63}$/;
const ROLE = /^[a-z][a-z_]{0,31}$/;

function auditRows(value: unknown): AuditRow[] {
  if (!Array.isArray(value)) return [];
  const rows: AuditRow[] = [];
  for (const raw of value.slice(0, 20)) {
    const r = obj(raw);
    if (!r) continue;
    const occurredAt = toTimestamp(r.occurred_at);
    const action = typeof r.action === "string" && ACTION.test(r.action) ? r.action : null;
    if (!occurredAt || !action) continue;
    const status = toCount(r.http_status);
    rows.push({
      occurredAt,
      action,
      resourceType:
        typeof r.resource_type === "string" && RESOURCE_TYPE.test(r.resource_type)
          ? r.resource_type
          : null,
      decision: r.decision === "permit" || r.decision === "deny" ? r.decision : null,
      reason:
        typeof r.denial_reason === "string" && REASON.test(r.denial_reason)
          ? r.denial_reason
          : null,
      role: typeof r.actor_role === "string" && ROLE.test(r.actor_role) ? r.actor_role : null,
      httpStatus: status !== null && status >= 100 && status <= 599 ? status : null,
    });
  }
  return rows;
}

/** The admin status, keeping only the documented fields. Null if not an object. */
export function parseAdminStatus(data: unknown): AdminStatus | null {
  const d = obj(data);
  if (!d) return null;
  const c = obj(d.consent);
  return {
    requests24h: toCount(d.requests_24h),
    denials24h: toCount(d.denials_24h),
    requests7d: toCount(d.requests_7d),
    denials7d: toCount(d.denials_7d),
    recent: auditRows(d.recent),
    recentDenials: auditRows(d.recent_denials),
    consent: c
      ? { records: toCount(c.records), active: toCount(c.active), withdrawn: toCount(c.withdrawn) }
      : null,
  };
}

export type AdminStatusResult =
  | { status: "ok"; data: AdminStatus }
  | { status: RpcFailure };

/** Loads fhir_interop_admin_status(). Never throws. */
export async function loadAdminStatus(
  client: InteropRpcClient | null | undefined,
  online: boolean,
): Promise<AdminStatusResult> {
  const out = await callInteropRpc(client, "fhir_interop_admin_status", undefined, online);
  if (out.ok === false) return { status: out.reason };
  const parsed = parseAdminStatus(out.data);
  return parsed ? { status: "ok", data: parsed } : { status: "failed" };
}

/** Plain words for a refusal reason code ("scope_violation" -> "Scope violation"). */
export function reasonLabel(reason: string | null): string {
  if (!reason) return "";
  const words = reason.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
