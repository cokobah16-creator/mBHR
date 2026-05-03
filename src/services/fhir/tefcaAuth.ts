import { supabase } from "../../lib/supabase";
import type { ExchangePurpose } from "./types";

export interface QHINPartner {
  id: string;
  name: string;
  apiKeyHash: string;
  allowedPurposes: ExchangePurpose[];
  active: boolean;
  createdAt: string;
}

export interface TEFCASession {
  qhinId: string;
  exchangePurpose: ExchangePurpose;
  patientId?: string;
  isValid: boolean;
  expiresAt: Date;
}

export interface PatientIdentityMatch {
  patientId: string;
  confidence: number;
  matchMethod: "exact" | "demographic" | "identifier";
}

export async function validateQHINRequest(
  qhinId: string,
  apiKey: string,
  exchangePurpose: ExchangePurpose,
): Promise<{ valid: boolean; error?: string; partner?: QHINPartner }> {
  const { data: row, error } = await supabase
    .from("tefca_qhin_partners")
    .select("id, name, api_key_hash, allowed_purposes, active, created_at")
    .eq("id", qhinId)
    .maybeSingle();

  if (error || !row) {
    return { valid: false, error: "Unknown QHIN identifier" };
  }

  const partner: QHINPartner = {
    id: row.id,
    name: row.name,
    apiKeyHash: row.api_key_hash ?? "",
    allowedPurposes: (row.allowed_purposes ?? []) as ExchangePurpose[],
    active: row.active,
    createdAt: row.created_at,
  };

  if (!partner.active) {
    return { valid: false, error: "QHIN partner is inactive" };
  }

  if (!partner.allowedPurposes.includes(exchangePurpose)) {
    return {
      valid: false,
      error: `Exchange purpose '${exchangePurpose}' not authorized for this QHIN`,
    };
  }

  if (!partner.apiKeyHash) {
    return { valid: false, error: "QHIN partner has no API key configured" };
  }

  const encoder = new TextEncoder();
  const keyData = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", keyData);
  const computedHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (computedHash !== partner.apiKeyHash) {
    return { valid: false, error: "Invalid API key for QHIN" };
  }

  return { valid: true, partner };
}

export async function matchPatientIdentity(identifiers: {
  mrn?: string;
  phone?: string;
  email?: string;
  name?: string;
  dob?: string;
}): Promise<PatientIdentityMatch | null> {
  if (identifiers.mrn) {
    const { data: patient } = await supabase
      .from("patients")
      .select("id")
      .eq("id", identifiers.mrn)
      .maybeSingle();

    if (patient) {
      return {
        patientId: patient.id,
        confidence: 1.0,
        matchMethod: "exact",
      };
    }
  }

  if (identifiers.phone) {
    const normalizedPhone = normalizePhone(identifiers.phone);
    const { data: patient } = await supabase
      .from("patients")
      .select("id")
      .eq("phone", normalizedPhone)
      .maybeSingle();

    if (patient) {
      return {
        patientId: patient.id,
        confidence: 0.95,
        matchMethod: "identifier",
      };
    }
  }

  if (identifiers.email) {
    const { data: patient } = await supabase
      .from("patients")
      .select("id")
      .eq("email", identifiers.email.toLowerCase())
      .maybeSingle();

    if (patient) {
      return {
        patientId: patient.id,
        confidence: 0.95,
        matchMethod: "identifier",
      };
    }
  }

  if (identifiers.name && identifiers.dob) {
    const { data: patients } = await supabase
      .from("patients")
      .select("id, name, dob")
      .eq("dob", identifiers.dob)
      .ilike("name", `%${identifiers.name}%`);

    if (patients && patients.length === 1) {
      return {
        patientId: patients[0].id,
        confidence: 0.85,
        matchMethod: "demographic",
      };
    }

    if (patients && patients.length > 1) {
      const exactMatch = patients.find(
        (p) => p.name.toLowerCase() === identifiers.name!.toLowerCase(),
      );
      if (exactMatch) {
        return {
          patientId: exactMatch.id,
          confidence: 0.9,
          matchMethod: "demographic",
        };
      }
    }
  }

  return null;
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");

  if (digits.startsWith("234") && digits.length === 13) {
    return digits;
  }
  if (digits.startsWith("0") && digits.length === 11) {
    return "234" + digits.slice(1);
  }
  if (digits.length === 10) {
    return "234" + digits;
  }

  return digits;
}

export async function verifyPatientConsent(
  patientId: string,
  exchangePurpose: ExchangePurpose,
): Promise<{ hasConsent: boolean; consentId?: string }> {
  if (exchangePurpose === "individual-access") {
    return { hasConsent: true };
  }

  const { data: consent } = await supabase
    .from("patient_consent_records")
    .select("id, consent_type, consented, revoked_at")
    .eq("patient_id", patientId)
    .eq("consent_type", "data_sharing")
    .eq("consented", true)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (consent) {
    return { hasConsent: true, consentId: consent.id };
  }

  return { hasConsent: false };
}

export async function createTEFCASession(
  qhinId: string,
  exchangePurpose: ExchangePurpose,
  patientId?: string,
): Promise<TEFCASession> {
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 15);

  return {
    qhinId,
    exchangePurpose,
    patientId,
    isValid: true,
    expiresAt,
  };
}

/**
 * Static fallback used when the SMART well-known doc isn't reachable (offline,
 * tefca-oauth not deployed yet). The live source of truth is now
 * `${VITE_SUPABASE_URL}/functions/v1/tefca-oauth/.well-known/smart-configuration`
 * served by the SMART OAuth edge function (Phase C-1).
 */
function buildFallbackSMARTConfiguration(baseUrl: string) {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    token_endpoint_auth_methods_supported: ["private_key_jwt"],
    token_endpoint_auth_signing_alg_values_supported: ["ES256", "RS256"],
    jwks_uri: `${baseUrl}/.well-known/jwks.json`,
    grant_types_supported: ["client_credentials", "authorization_code"],
    scopes_supported: [
      "openid",
      "profile",
      "fhirUser",
      "launch",
      "launch/patient",
      "patient/*.read",
      "patient/Patient.read",
      "patient/Observation.read",
      "patient/MedicationRequest.read",
      "patient/Encounter.read",
      "system/*.read",
    ],
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    capabilities: [
      "launch-ehr",
      "launch-standalone",
      "client-public",
      "client-confidential-symmetric",
      "client-confidential-asymmetric",
      "context-ehr-patient",
      "context-standalone-patient",
      "permission-system",
      "permission-patient",
      "sso-openid-connect",
    ],
  };
}

/**
 * Fetch the live SMART configuration from the tefca-oauth edge function and
 * cache it. Falls back to a static config when the well-known doc is
 * unavailable, so callers can still reason about supported flows offline.
 */
let smartConfigCache: {
  baseUrl: string;
  fetchedAt: number;
  config: ReturnType<typeof buildFallbackSMARTConfiguration>;
} | null = null;
const SMART_CONFIG_TTL_MS = 5 * 60 * 1000;

export async function getSMARTConfiguration(
  baseUrl: string,
): Promise<ReturnType<typeof buildFallbackSMARTConfiguration>> {
  const now = Date.now();
  if (
    smartConfigCache &&
    smartConfigCache.baseUrl === baseUrl &&
    now - smartConfigCache.fetchedAt < SMART_CONFIG_TTL_MS
  ) {
    return smartConfigCache.config;
  }

  try {
    const resp = await fetch(`${baseUrl}/.well-known/smart-configuration`, {
      headers: { Accept: "application/json" },
    });
    if (resp.ok) {
      const config = await resp.json();
      smartConfigCache = { baseUrl, fetchedAt: now, config };
      return config;
    }
  } catch {
    // fall through to the static fallback
  }

  const fallback = buildFallbackSMARTConfiguration(baseUrl);
  smartConfigCache = { baseUrl, fetchedAt: now, config: fallback };
  return fallback;
}

/**
 * @deprecated Use {@link getSMARTConfiguration} which fetches the live
 * well-known document. Kept synchronous to preserve existing call sites.
 */
export function generateSMARTConfiguration(baseUrl: string) {
  return buildFallbackSMARTConfiguration(baseUrl);
}

export const TEFCA_EXCHANGE_PURPOSES = {
  "individual-access": {
    code: "individual-access",
    display: "Individual Access Services (IAS)",
    description: "Patient accessing their own health information",
    requiresConsent: false,
  },
  treatment: {
    code: "treatment",
    display: "Treatment",
    description: "Healthcare provider accessing for treatment purposes",
    requiresConsent: true,
  },
  payment: {
    code: "payment",
    display: "Payment",
    description: "Health plan or clearinghouse for payment activities",
    requiresConsent: true,
  },
  operations: {
    code: "operations",
    display: "Healthcare Operations",
    description: "Quality assessment, training, or other operations",
    requiresConsent: true,
  },
} as const;

export interface TEFCAAuditEntry {
  timestamp: string;
  qhinId: string;
  exchangePurpose: ExchangePurpose;
  patientId?: string;
  resourcesAccessed: string[];
  success: boolean;
  responseTimeMs: number;
}

export async function logTEFCAAudit(entry: TEFCAAuditEntry): Promise<void> {
  try {
    await supabase.from("tefca_access_logs").insert({
      requesting_organization: entry.qhinId,
      qhin_id: entry.qhinId,
      exchange_purpose: entry.exchangePurpose,
      patient_id: entry.patientId,
      resources_requested: entry.resourcesAccessed,
      resources_returned: entry.resourcesAccessed.length,
      success: entry.success,
      response_time_ms: entry.responseTimeMs,
    });
  } catch (error) {
    console.error("Failed to log TEFCA audit entry:", error);
  }
}
