// Staff authentication for edge functions that act on patient data.
//
// The caller must send a Supabase *user* access token (Authorization: Bearer
// <access_token>). The token is verified with the service-role client
// (auth.getUser), and the caller's role is read from public.app_users, whose
// id is the auth user id (see is_staff()/has_role() in
// 20260520000003_helpers_invoker_and_notifications_policy.sql). A role in the
// token's metadata or in the request body is never trusted.
//
// The anon key is a valid JWT but carries no user, so it is rejected with 401.

import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2";

/**
 * Roles that may send SMS to patients (medication/appointment reminders,
 * televisit notices and portal codes; portal invitations go by email only).
 *
 * src/auth/roles.ts has no SMS permission; this set is the server-side
 * definition of "may send patient reminders" and maps to the app roles as:
 *   pharmacist      - dispense reminders           (roles.ts: dispense)
 *   doctor, nurse   - clinical follow-up reminders (roles.ts: vitals/consult)
 *   lead_clinician  - clinical lead                (roles.ts: consult)
 *   admin           - full access
 * volunteer, auditor and guest cannot send SMS.
 */
export const SMS_SENDER_ROLES: readonly string[] = [
  "pharmacist",
  "doctor",
  "nurse",
  "lead_clinician",
  "admin",
];

export type StaffAuthResult =
  | { ok: true; userId: string; role: string }
  | { ok: false; status: 401 | 403 | 503; error: string; message: string };

export function getServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set");
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}

const NOT_SIGNED_IN: StaffAuthResult = {
  ok: false,
  status: 401,
  error: "not_authenticated",
  message: "Sign in online with a staff account to send SMS.",
};

const NOT_PERMITTED: StaffAuthResult = {
  ok: false,
  status: 403,
  error: "not_permitted",
  message: "Your role cannot send SMS to patients.",
};

/** A flag column set to false/inactive on the app_users row, if any. */
function isDeactivated(row: Record<string, unknown>): boolean {
  if (row.is_active === false || row.active === false) return true;
  if (row.disabled === true || row.deactivated === true) return true;
  if (row.deactivated_at || row.disabled_at) return true;
  return false;
}

/**
 * Verifies the caller is a signed-in, active staff member whose app_users
 * role is in `allowedRoles`.
 */
export async function requireStaff(
  req: Request,
  service: SupabaseClient,
  allowedRoles: readonly string[],
): Promise<StaffAuthResult> {
  const token = bearerToken(req);
  if (!token) return NOT_SIGNED_IN;

  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (anonKey && token === anonKey) return NOT_SIGNED_IN;

  const { data: userData, error: userError } =
    await service.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user?.id) return NOT_SIGNED_IN;

  const flags = user as unknown as {
    is_anonymous?: boolean;
    banned_until?: string | null;
  };
  if (flags.is_anonymous) return NOT_SIGNED_IN;
  if (flags.banned_until && Date.parse(flags.banned_until) > Date.now()) {
    return NOT_PERMITTED;
  }

  const { data: row, error: rowError } = await service
    .from("app_users")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (rowError) {
    console.error("[staffAuth] app_users lookup failed:", rowError.code ?? "error");
    return {
      ok: false,
      status: 503,
      error: "staff_lookup_failed",
      message: "Could not check your staff account. Try again shortly.",
    };
  }
  if (!row) return NOT_PERMITTED;

  const record = row as Record<string, unknown>;
  const role = typeof record.role === "string" ? record.role : "";
  if (!allowedRoles.includes(role) || isDeactivated(record)) {
    return NOT_PERMITTED;
  }

  return { ok: true, userId: user.id, role };
}
