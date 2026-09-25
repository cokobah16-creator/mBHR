// Database calls for portal invitations (service role). The rules live in
// public.portal_invitation_begin() / portal_invitation_finish(), migration
// 20260925100600_registration_lead_portal_invite.sql; see ./portalInvitation.ts.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { type InvitationGrant, readInvitationBegin } from "./portalInvitation.ts";

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Checks and records an invitation before anything is sent. `refused` holds
 * the database's reason, or "check_failed" when the check could not run
 * (then nothing may be sent).
 */
export async function beginInvitation(
  service: SupabaseClient,
  actorId: string,
  patientId: string,
  channel: "sms" | "email",
): Promise<{ grant: InvitationGrant } | { refused: string }> {
  try {
    const { data, error } = await service.rpc("portal_invitation_begin", {
      p_actor: actorId,
      p_patient_id: patientId,
      p_channel: channel,
    });
    if (error) {
      console.error("[portalInvitation] check failed:", error.code ?? "error");
      return { refused: "check_failed" };
    }
    return readInvitationBegin(data);
  } catch (error) {
    console.error("[portalInvitation] check failed:", errorName(error));
    return { refused: "check_failed" };
  }
}

/**
 * Records what happened to an invitation. Never throws; false when the
 * outcome could not be recorded (or one was already recorded).
 */
export async function finishInvitation(
  service: SupabaseClient,
  invitationId: string,
  outcome: "sent" | "not_sent",
  detail: string,
  provider: string | null = null,
  providerMessageId: string | null = null,
): Promise<boolean> {
  try {
    const { data, error } = await service.rpc("portal_invitation_finish", {
      p_invitation_id: invitationId,
      p_outcome: outcome,
      p_detail: detail,
      p_provider: provider,
      p_provider_message_id: providerMessageId,
    });
    if (error) {
      console.error(
        "[portalInvitation] could not record the outcome:",
        error.code ?? "error",
      );
      return false;
    }
    return data === true;
  } catch (error) {
    console.error("[portalInvitation] could not record the outcome:", errorName(error));
    return false;
  }
}
