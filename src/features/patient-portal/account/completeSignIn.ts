/**
 * The step after Supabase has signed a patient in, shared by the password
 * login and the email-confirmation link (/auth/callback):
 *
 *   ask the server whether portal access is on
 *   → if the account is not linked yet, link it to its clinic record
 *     (the server matches verified contact details and the date of birth;
 *     it never creates a record) and ask again
 *   → keep a small copy of who is signed in for the portal pages.
 *
 * Anything short of "access is on" refuses: this device's sign-in is ended
 * and the patient gets the server's reason in plain words. The server's
 * row-level security guards the records either way.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchPortalAccessStatus,
  linkDetailsFromUser,
  linkPortalAccount,
} from "@/services/portalSignIn";
import { portalSignInRefusalMessage } from "@/services/portalAccessRules";
import {
  getPatientProfile,
  getPatientProfileByEmail,
} from "@/services/patientService";
import { clearStoredSupabaseAuth } from "@/lib/supabaseAuthStorage";

// Same key as portalSession.ts; not imported so this stays free of its re-exports.
const PORTAL_USER_KEY = "patient_portal_user";

export type CompleteSignInResult =
  | { kind: "allowed" }
  | { kind: "refused"; message: string };

export const PROFILE_NOT_FOUND_MESSAGE =
  "You are signed in, but we could not find your clinic record. Please contact the care team so they can link your record.";

export const PROFILE_LOAD_FAILED_MESSAGE =
  "We could not load your details. Check your internet connection and try again.";

async function refuse(
  client: SupabaseClient,
  message: string,
): Promise<CompleteSignInResult> {
  // Local only: a refused portal sign-in must not end this account's
  // sign-ins on other devices (a staff account shares the login).
  await client.auth.signOut({ scope: "local" }).catch(() => undefined);
  clearStoredSupabaseAuth();
  try {
    localStorage.removeItem(PORTAL_USER_KEY);
  } catch {
    // Storage blocked: nothing to clear.
  }
  return { kind: "refused", message };
}

export async function completePortalSignIn(
  client: SupabaseClient,
): Promise<CompleteSignInResult> {
  let access = await fetchPortalAccessStatus(client);
  if (access.kind === "not_linked") {
    const {
      data: { user: signedIn },
    } = await client.auth.getUser();
    const link = await linkPortalAccount(client, linkDetailsFromUser(signedIn));
    if (!link.linked) {
      return refuse(client, link.message ?? portalSignInRefusalMessage("not_linked"));
    }
    access = await fetchPortalAccessStatus(client);
  }
  if (access.kind !== "allowed") {
    return refuse(client, portalSignInRefusalMessage(access.kind));
  }

  try {
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) return refuse(client, portalSignInRefusalMessage("unavailable"));

    let profileRes = await getPatientProfile(user.id);
    if (!profileRes.data && user.email) {
      profileRes = await getPatientProfileByEmail(user.id, user.email);
    }
    if (!profileRes.data) return refuse(client, PROFILE_NOT_FOUND_MESSAGE);

    localStorage.setItem(
      PORTAL_USER_KEY,
      JSON.stringify({
        id: user.id,
        patientId: profileRes.data.id,
        givenName: profileRes.data.givenName,
        familyName: profileRes.data.familyName,
        email: profileRes.data.email,
      }),
    );
  } catch {
    return refuse(client, PROFILE_LOAD_FAILED_MESSAGE);
  }
  return { kind: "allowed" };
}
