// TEFCA audit logging + consent verification.
// Required for every QHIN exchange (6-year retention per TEFCA RCE rules).

import { createClient } from "npm:@supabase/supabase-js@2";
import type { ExchangePurpose, TEFCAContext } from "./shared.ts";

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

  const { data: consent } = await supabase
    .from("patient_consent_records")
    .select("*")
    .eq("patient_id", patientId)
    .eq("consent_type", "data_sharing")
    .eq("consented", true)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return !!consent;
}
