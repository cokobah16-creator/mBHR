// The staff directory on this device.
//
// The server (public.app_users) is the source of truth for who works for the
// organisation: identity, role, admin flags and whether the account is
// active. Every device keeps a copy so the offline "Who's signing in?" list
// and user management work without internet. Offline access itself (the PIN)
// is a device-only credential and is never part of this sync: the fields
// below are the only ones read from the server, and the staff upload map in
// src/sync/adapter.ts has no PIN columns.

import { supabase } from "@/lib/supabase";
import { db, type User } from "@/db";
import { accessFromAppUser, endSessionIfRevoked, isDeactivatedAppUser } from "@/stores/auth";
import { mergePulledRow } from "./pullMerge";
import { serverStampMarker } from "./serverStamp";

type Row = Record<string, unknown>;

/** Fields of a staff record that exist only on this device. */
export const DEVICE_ONLY_STAFF_FIELDS = [
  "pinHash",
  "pinSalt",
  "pinEnrolledAt",
  "lastOnlineVerifiedAt",
  "permissionsCachedAt",
] as const;

/**
 * A server staff row in this device's shape. Never includes the device-only
 * PIN fields, so laying it over a local record keeps that record's PIN.
 * An unknown role maps to "guest" (no access), as sign-in does.
 */
export function staffFromServerRow(raw: Row): Partial<User> & { id: string } {
  const { role, fullName } = accessFromAppUser(raw);
  const out: Partial<User> & { id: string } = {
    id: String(raw.id),
    role: role as User["role"],
    // Same rule as the database (public.app_current_role / app_is_staff):
    // a switched-off row or a role the app does not know gives no access,
    // so that person cannot sign in offline on this device either.
    isActive: isDeactivatedAppUser(raw) || role === "guest" ? 0 : 1,
    adminAccess: raw.admin_access === true || role === "admin",
    adminPermanent: raw.admin_permanent === true,
  };
  if (fullName) out.fullName = fullName;
  if (typeof raw.email === "string" && raw.email.trim()) {
    out.email = raw.email.trim();
  }
  if (typeof raw.phone === "string" && raw.phone.trim()) {
    out.phone = raw.phone.trim();
  }
  if (raw.created_at) out.createdAt = new Date(String(raw.created_at));
  if (raw.updated_at) out.updatedAt = new Date(String(raw.updated_at));
  return out;
}

/**
 * An administrator's offline "Deactivate" on this device is only undone by
 * an authorised person, never by a download. When the server still lists a
 * person as active after they were switched off here, the device keeps them
 * off and marks the record for review (Users shows it). Revocation stays
 * monotonic while devices are out of step, instead of newest-wins.
 */
export function keepLocalRevocation(
  localRow: Row | null | undefined,
  merged: Row,
): Row {
  if (!localRow?.disabledLocallyAt || merged.isActive !== 1) return merged;
  return { ...merged, isActive: 0, accessConflict: 1 };
}

export type RosterPullResult =
  | { ok: true; staff: number; deactivated: number }
  | { ok: false; reason: "not-configured" | "error" };

/**
 * Download the whole active staff directory into this device's staff list.
 *
 * - New staff are added without a PIN: known to the device, no offline
 *   access until they enroll.
 * - Existing records get the server's identity fields; their PIN is kept.
 * - A record this device got from the server earlier that the server no
 *   longer lists is switched off here, so a removed person cannot keep
 *   signing in offline with an old PIN. Records created on this device and
 *   never synced are left alone.
 *
 * Needs an online sign-in (the server only shows the directory to staff).
 * Never throws.
 */
export async function pullStaffRoster(): Promise<RosterPullResult> {
  if (!supabase) return { ok: false, reason: "not-configured" };

  let rows: Row[];
  try {
    const { data, error } = await supabase.from("app_users").select("*");
    if (error) {
      console.warn("[roster] staff directory download failed", error.code ?? "unknown");
      return { ok: false, reason: "error" };
    }
    rows = (data ?? []) as Row[];
  } catch (error) {
    console.warn(
      "[roster] staff directory download failed",
      error instanceof Error ? error.name : typeof error,
    );
    return { ok: false, reason: "error" };
  }

  // An empty answer usually means the server hid the directory (for example
  // row-level security for a deactivated account), not that everyone left.
  if (rows.length === 0) return { ok: true, staff: 0, deactivated: 0 };
  // A single row is usually just the signed-in person's own record (a
  // server whose row-level security shows staff only themselves). That is
  // not the directory, so nobody is switched off for being missing from it.
  const fullDirectory = rows.length > 1;

  const syncedAt = new Date().toISOString();
  const serverIds = new Set<string>();
  let deactivated = 0;

  try {
    await db.transaction("rw", db.users, async () => {
      for (const raw of rows) {
        if (raw.id === null || raw.id === undefined) continue;
        const remote = staffFromServerRow(raw);
        serverIds.add(remote.id);
        const local = (await db.users.get(remote.id)) as unknown as Row | undefined;
        const decision = mergePulledRow(local, { ...remote }, {
          _dirty: 0,
          _syncedAt: syncedAt,
          // The server's own updated_at, for the next upload's conflict check.
          ...serverStampMarker(raw),
        });
        if (decision.kind === "kept-local") continue;
        const row = keepLocalRevocation(local, decision.row) as unknown as User;
        await db.users.put({
          // A person new to this device: known, but no offline access yet.
          fullName: row.fullName ?? String(raw.email ?? "Staff member"),
          pinHash: "",
          pinSalt: "",
          createdAt: new Date(),
          updatedAt: new Date(),
          ...row,
          // The role now on this device is the server's as of this download:
          // offline sign-in uses it until the next one.
          permissionsCachedAt: new Date(syncedAt),
        });
      }

      if (!fullDirectory) return;
      const gone = await db.users
        .filter(
          (u) =>
            u.isActive === 1 &&
            !serverIds.has(u.id) &&
            !!(u as unknown as Row)._syncedAt &&
            (u as unknown as Row)._dirty !== 1,
        )
        .toArray();
      for (const u of gone) {
        await db.users.update(u.id, { isActive: 0 });
        deactivated += 1;
      }
    });
  } catch (error) {
    console.warn(
      "[roster] could not save the staff directory",
      error instanceof Error ? error.name : typeof error,
    );
    return { ok: false, reason: "error" };
  }

  // The signed-in person may be among those just switched off, or their
  // role may have changed: end or update their session now.
  await endSessionIfRevoked();

  return { ok: true, staff: serverIds.size, deactivated };
}
