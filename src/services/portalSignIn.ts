// Patient portal sign-in checks against the server.
//
// Kept apart from portalAccess.ts (the staff side, which loads the sync
// engine) so the portal pages stay light. Both helpers take the Supabase
// client the portal signed in with.

import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  portalLinkOutcome,
  portalSignInDecision,
  type PortalLinkOutcome,
  type PortalSignInCheck,
} from "./portalAccessRules";

/**
 * Ask the server whether portal access is on for the signed-in portal user
 * (portal_access_status()). Any failure is "unavailable": the caller must
 * refuse the sign-in rather than assume access.
 */
export async function fetchPortalAccessStatus(
  client: SupabaseClient | null,
): Promise<PortalSignInCheck> {
  if (!client) return { kind: "unavailable" };
  try {
    const { data, error } = await client.rpc("portal_access_status");
    return portalSignInDecision(data, !!error);
  } catch {
    return { kind: "unavailable" };
  }
}

export interface PortalLinkDetails {
  /** YYYY-MM-DD */
  dob?: string | null;
  givenName?: string | null;
  familyName?: string | null;
  phone?: string | null;
}

/**
 * Link the signed-in portal account to its clinic record, or create a
 * self-registered record (portal_link_patient_record). The server matches
 * only contact details Supabase has verified, and the date of birth.
 */
export async function linkPortalAccount(
  client: SupabaseClient | null,
  details: PortalLinkDetails,
): Promise<PortalLinkOutcome> {
  if (!client) return portalLinkOutcome("unavailable");
  try {
    const { data, error } = await client.rpc("portal_link_patient_record", {
      p_dob: details.dob || null,
      p_given_name: details.givenName || null,
      p_family_name: details.familyName || null,
      p_phone: details.phone || null,
    });
    if (error) return portalLinkOutcome("unavailable");
    const status =
      data && typeof data === "object" ? (data as { status?: unknown }).status : undefined;
    return portalLinkOutcome(status);
  } catch {
    return portalLinkOutcome("unavailable");
  }
}

/**
 * The registration details saved on the portal account at sign-up
 * (user_metadata), used to link the clinic record at the first sign-in
 * when sign-up needed an email confirmation first.
 */
export function linkDetailsFromUser(user: Pick<User, "user_metadata"> | null): PortalLinkDetails {
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  return {
    dob: text(meta.dob),
    givenName: text(meta.given_name),
    familyName: text(meta.family_name),
    phone: text(meta.phone),
  };
}
