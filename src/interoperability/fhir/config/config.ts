// Interoperability configuration and feature flags.
//
// Read on the server (the /fhir/R4 gateway) from process-style environment
// variables, never from import.meta.env: nothing here is shipped to browsers.
// Every flag defaults to off, and the flags that would open the gateway to
// outside systems (writes, SMART, external clients) cannot be switched on in
// this release at all: readFhirConfig() refuses to produce a configuration
// that claims them, so the gateway fails closed instead of pretending.
//
//   FHIR_ENABLED                      the gateway answers at all (default off)
//   FHIR_READ_ENABLED                 read and search (default: follows
//                                     FHIR_ENABLED; "false" leaves only
//                                     /metadata)
//   FHIR_PATIENT_ACCESS_ENABLED       portal patients may read their own
//                                     records (default off)
//   FHIR_CONSENT_ENFORCEMENT_ENABLED  stored consent directives are evaluated
//                                     for disclosures that consent governs;
//                                     off = those disclosures are refused
//   FHIR_AUDIT_ENABLED                must stay on: "false" is refused, the
//                                     gateway never serves unaudited data
//   FHIR_EXTERNAL_ACCESS_ENABLED,     refused when set to true
//   FHIR_WRITE_ENABLED, SMART_ENABLED,
//   SMART_EXTERNAL_CLIENTS_ENABLED

export interface FhirConfig {
  /** FHIR_ENABLED: the /fhir/R4 gateway answers at all. */
  enabled: boolean;
  /** FHIR_BASE_URL without a trailing slash, e.g. https://mbhr.app/fhir/R4. */
  baseUrl: string | null;
  /** FHIR_DEFAULT_PAGE_SIZE (default 20). */
  defaultPageSize: number;
  /** FHIR_MAX_PAGE_SIZE (default 100, never above 100). */
  maxPageSize: number;
  /** FHIR_RATE_LIMIT_PER_MINUTE per signed-in user (default 60). */
  rateLimitPerMinute: number;
  /**
   * FHIR_SENSITIVE_RATE_LIMIT_PER_MINUTE (default 20): a second, stricter
   * limit for searches on the types marked sensitiveSearch (Patient,
   * Observation, ServiceRequest, DiagnosticReport, DocumentReference,
   * Provenance, AuditEvent) and for every Binary download, counted on top of
   * the general one.
   */
  sensitiveRateLimitPerMinute: number;
  /** FHIR_READ_ENABLED; defaults to FHIR_ENABLED. */
  readEnabled: boolean;
  /** FHIR_PATIENT_ACCESS_ENABLED (default off). */
  patientAccessEnabled: boolean;
  /** Always true: FHIR_AUDIT_ENABLED=false is refused. */
  auditEnabled: true;
  /** Always false in this release (see refusals below). */
  externalAccessEnabled: false;
  writeEnabled: false;
  smartEnabled: false;
  smartExternalClientsEnabled: false;
  /**
   * FHIR_CONSENT_ENFORCEMENT_ENABLED. Internal treatment by mBHR staff and a
   * patient reading their own record are not governed by stored consent, so
   * this flag changes nothing for them. For disclosures that consent does
   * govern (external sharing, research, third-party apps), on means stored
   * directives are evaluated (no explicit permit = deny) and off means they
   * are refused outright. None of those disclosures is enabled in this
   * release. See docs/interoperability/consent.md.
   */
  consentEnforcementEnabled: boolean;
  /** Supabase project URL and anon (publishable) key for user-scoped reads. */
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  /** FHIR_AUDIT_IP_SECRET: HMAC key for audit IP hashes; unset = no IP kept. */
  auditIpSecret: string | null;
}

export type Env = Record<string, string | undefined>;

export class FhirConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FhirConfigError";
  }
}

export const MAX_PAGE_SIZE_CEILING = 100;

const TRUE_VALUES = ["true", "1", "yes", "on"];
const FALSE_VALUES = ["false", "0", "no", "off"];

/** Lenient: only an explicit true-like value counts as on. */
function flag(env: Env, name: string): boolean {
  return TRUE_VALUES.includes((env[name] ?? "").trim().toLowerCase());
}

/** true / false when the variable says so, null when unset or blank. */
function flagValue(env: Env, name: string): boolean | null {
  const raw = (env[name] ?? "").trim().toLowerCase();
  if (raw === "") return null;
  if (TRUE_VALUES.includes(raw)) return true;
  if (FALSE_VALUES.includes(raw)) return false;
  throw new FhirConfigError(`${name} must be true or false`);
}

function positiveInt(env: Env, name: string, fallback: number): number {
  const raw = (env[name] ?? "").trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new FhirConfigError(`${name} must be a positive integer`);
  }
  return n;
}

function httpsOrLocalUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new FhirConfigError(`${name} is not a valid URL`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new FhirConfigError(`${name} must use https`);
  }
  if (url.search || url.hash) {
    throw new FhirConfigError(`${name} must not carry a query or fragment`);
  }
  return url.toString().replace(/\/+$/, "");
}

/**
 * Parse and validate the interoperability configuration.
 *
 * With FHIR_ENABLED off, the result only says "disabled" and nothing else is
 * required. With it on, a missing or unsafe setting throws, so production
 * cannot start the gateway half-configured.
 */
export function readFhirConfig(env: Env): FhirConfig {
  const enabled = flag(env, "FHIR_ENABLED");

  for (const name of [
    "FHIR_WRITE_ENABLED",
    "SMART_ENABLED",
    "SMART_EXTERNAL_CLIENTS_ENABLED",
    "FHIR_EXTERNAL_ACCESS_ENABLED",
  ]) {
    if (flag(env, name)) {
      throw new FhirConfigError(
        `${name} is not supported in this release; leave it unset or false`,
      );
    }
  }

  const maxPageSize = Math.min(
    positiveInt(env, "FHIR_MAX_PAGE_SIZE", MAX_PAGE_SIZE_CEILING),
    MAX_PAGE_SIZE_CEILING,
  );
  const defaultPageSize = Math.min(
    positiveInt(env, "FHIR_DEFAULT_PAGE_SIZE", 20),
    maxPageSize,
  );
  const rateLimitPerMinute = positiveInt(env, "FHIR_RATE_LIMIT_PER_MINUTE", 60);
  const sensitiveRateLimitPerMinute = Math.min(
    positiveInt(env, "FHIR_SENSITIVE_RATE_LIMIT_PER_MINUTE", 20),
    rateLimitPerMinute,
  );

  const base: FhirConfig = {
    enabled,
    baseUrl: null,
    defaultPageSize,
    maxPageSize,
    rateLimitPerMinute,
    sensitiveRateLimitPerMinute,
    readEnabled: false,
    patientAccessEnabled: false,
    auditEnabled: true,
    externalAccessEnabled: false,
    writeEnabled: false,
    smartEnabled: false,
    smartExternalClientsEnabled: false,
    consentEnforcementEnabled: flag(env, "FHIR_CONSENT_ENFORCEMENT_ENABLED"),
    supabaseUrl: null,
    supabaseAnonKey: null,
    auditIpSecret: null,
  };
  if (!enabled) return base;

  // Strictly parsed once the gateway is on: a typo fails closed.
  if (flagValue(env, "FHIR_AUDIT_ENABLED") === false) {
    // Every request is audited before data is released; there is no
    // unaudited mode to switch to.
    throw new FhirConfigError("FHIR_AUDIT_ENABLED cannot be switched off");
  }
  const readEnabled = flagValue(env, "FHIR_READ_ENABLED") !== false;
  const patientAccessEnabled = flagValue(env, "FHIR_PATIENT_ACCESS_ENABLED") === true;
  const consentEnforcementEnabled = flagValue(env, "FHIR_CONSENT_ENFORCEMENT_ENABLED") === true;

  const baseUrlRaw = (env.FHIR_BASE_URL ?? "").trim();
  if (!baseUrlRaw) {
    throw new FhirConfigError("FHIR_BASE_URL is required when FHIR_ENABLED is on");
  }
  const supabaseUrlRaw = (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? "").trim();
  const anonKey = (env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? "").trim();
  if (!supabaseUrlRaw || !anonKey) {
    throw new FhirConfigError(
      "SUPABASE_URL and SUPABASE_ANON_KEY (or their VITE_ names) are required when FHIR_ENABLED is on",
    );
  }
  if (env.SUPABASE_SERVICE_ROLE_KEY && anonKey === env.SUPABASE_SERVICE_ROLE_KEY.trim()) {
    // The gateway reads as the signed-in user so row-level security applies.
    throw new FhirConfigError("the gateway must not be given the service-role key");
  }

  return {
    ...base,
    readEnabled,
    patientAccessEnabled,
    consentEnforcementEnabled,
    baseUrl: httpsOrLocalUrl(baseUrlRaw, "FHIR_BASE_URL"),
    supabaseUrl: httpsOrLocalUrl(supabaseUrlRaw, "SUPABASE_URL"),
    supabaseAnonKey: anonKey,
    auditIpSecret: (env.FHIR_AUDIT_IP_SECRET ?? "").trim() || null,
  };
}

/**
 * The flags as a response header on /metadata (X-MBHR-FHIR-Flags), so the
 * admin screen can show them. Only on/off states, never URLs or keys.
 */
export function flagsHeader(c: FhirConfig): string {
  const v = (b: boolean) => (b ? "on" : "off");
  return [
    `read=${v(c.readEnabled)}`,
    `patient=${v(c.patientAccessEnabled)}`,
    `consent=${v(c.consentEnforcementEnabled)}`,
    `audit=${v(c.auditEnabled)}`,
    `external=${v(c.externalAccessEnabled)}`,
    `write=${v(c.writeEnabled)}`,
    `smart=${v(c.smartEnabled)}`,
  ].join("; ");
}
