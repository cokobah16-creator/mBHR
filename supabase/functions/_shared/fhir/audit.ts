// TEFCA audit logging + consent verification.
// Required for every QHIN exchange (6-year retention per TEFCA RCE rules).

import { createClient } from "npm:@supabase/supabase-js@2";
import type { ExchangePurpose, TEFCAContext } from "./codes.ts";

type SupabaseLike = ReturnType<typeof createClient>;

export async function logTEFCAAccess(
  supabase: SupabaseLike,
  context: TEFCAContext,
  resourcesRequested: string[],
  resourcesReturned: number,
  success: boolean,
  errorMessage?: string,
  responseTimeMs?: number,
  patientId?: string,
): Promise<void> {
  try {
    await supabase.from("tefca_access_logs").insert({
      requesting_organization: context.requestingOrganization,
      qhin_id: context.qhinId,
      exchange_purpose: context.exchangePurpose,
      patient_id: patientId,
      resources_requested: resourcesRequested,
      resources_returned: resourcesReturned,
      success,
      error_message: errorMessage,
      ip_address: context.ipAddress,
      response_time_ms: responseTimeMs,
    });
  } catch {
    console.error("Failed to log TEFCA access");
  }
}

export async function verifyPatientConsent(
  supabase: SupabaseLike,
  patientId: string,
  exchangePurpose: ExchangePurpose,
): Promise<boolean> {
  // Patient self-access (IAS) doesn't require an explicit consent record.
  if (exchangePurpose === "individual-access") {
    return true;
  }

  // The patient's latest unrevoked data-sharing decision counts; a later
  // "no" overrides an earlier "yes".
  const { data: consent, error } = await supabase
    .from("patient_consent_records")
    .select("consent_given")
    .eq("patient_id", patientId)
    .eq("consent_type", "data_sharing")
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return false;
  return (consent as { consent_given?: boolean } | null)?.consent_given === true;
}
