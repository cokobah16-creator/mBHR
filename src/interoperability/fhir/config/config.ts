// Interoperability configuration and feature flags.
//
// Read on the server (the /fhir/R4 gateway) from process-style environment
// variables, never from import.meta.env: nothing here is shipped to browsers.
// Every flag defaults to off, and the flags that would open the gateway to
// outside systems (writes, SMART, external clients) cannot be switched on in
// this release at all: readFhirConfig() refuses to produce a configuration
// that claims them, so the gateway fails closed instead of pretending.

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
  /** Always false in this release (see refusals below). */
  writeEnabled: false;
  smartEnabled: false;
  smartExternalClientsEnabled: false;
  /**
   * FHIR_CONSENT_ENFORCEMENT_ENABLED. The first release only serves internal
   * treatment access, where the policy decision does not depend on a stored
   * consent; the flag is carried so later releases can turn stored-consent
   * checks on independently. See docs/interoperability/consent.md.
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

function flag(env: Env, name: string): boolean {
  const raw = (env[name] ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
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

  const base: FhirConfig = {
    enabled,
    baseUrl: null,
    defaultPageSize,
    maxPageSize,
    rateLimitPerMinute,
    writeEnabled: false,
    smartEnabled: false,
    smartExternalClientsEnabled: false,
    consentEnforcementEnabled: flag(env, "FHIR_CONSENT_ENFORCEMENT_ENABLED"),
    supabaseUrl: null,
    supabaseAnonKey: null,
    auditIpSecret: null,
  };
  if (!enabled) return base;

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
    baseUrl: httpsOrLocalUrl(baseUrlRaw, "FHIR_BASE_URL"),
    supabaseUrl: httpsOrLocalUrl(supabaseUrlRaw, "SUPABASE_URL"),
    supabaseAnonKey: anonKey,
    auditIpSecret: (env.FHIR_AUDIT_IP_SECRET ?? "").trim() || null,
  };
}
