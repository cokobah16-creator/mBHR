// Portal access, staff side: changes go to the server as commands.
//
// The server owns patients.portal_enabled (set_patient_portal_access,
// supabase/migrations/20260925100100_portal_access_authoritative.sql). A
// change made here is written to this device straight away with
// portalPending = 1 and queued in the command outbox (db.serverCommands) in
// the same Dexie transaction. The outbox sends it as the staff member who
// made it once they are signed in online; the handler registered below then
// stores the server's answer (confirmed value, or the server's own value
// when it refused the change).
//
// Devices without a server (cloud sync not set up) keep the value on this
// device only, and say so.

import { db, createAuditLog, type Patient, type ServerCommand } from "@/db";
import { supabase } from "@/lib/supabase";
import { can, type Role } from "@/auth/roles";
import { useAuthStore } from "@/stores/auth";
import { enqueueCommand, newCommandId, registerCommandHandler } from "@/sync/commandOutbox";
import { asCommandStore, drainServerCommands, refetchRows } from "@/sync/adapter";
import { PORTAL_ACCESS_RPC } from "@/db/migrations/backfillPlans";
import { parsePortalAccessResult, type PortalAccessSource } from "./portalAccessRules";

export { PORTAL_ACCESS_RPC };

const OPEN_STATUSES = ["pending", "waiting_permission"];

/** Short reason codes stored with the request (never free text). */
export type PortalAccessReason =
  | "staff_choice"
  | "registration"
  | "bulk_enable"
  | "auto_enrollment"
  | "opt_out";

export interface PortalAccessActor {
  id: string;
  role: Role;
}

export interface PortalAccessChangeResult {
  ok: boolean;
  /**
   * When ok:
   * waiting_for_server: saved on this device and queued; the server
   *   decides when this device syncs.
   * device_only: no server is set up on this device; saved here only.
   */
  state?: "waiting_for_server" | "device_only";
  /** The queued command's id (waiting_for_server), to follow its answer. */
  commandId?: string;
  /** When not ok: what went wrong, for staff. */
  error?: string;
}

/** Is a server set up on this device (portal access decided there)? */
export function portalServerConfigured(): boolean {
  return !!supabase;
}

function currentActor(): PortalAccessActor | null {
  const user = useAuthStore.getState().currentUser;
  if (!user?.id || !user.role) return null;
  return { id: user.id, role: user.role as Role };
}

function refersToPatient(command: Pick<ServerCommand, "entityRefs">, patientId: string): boolean {
  return (command.entityRefs ?? []).some((ref) => ref.table === "patients" && ref.id === patientId);
}

function namedError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

/**
 * Ask for portal access to be turned on or off for one patient.
 *
 * Checks the portal_manage permission of the person signed in on this
 * device (or `actor`), writes the requested value on this device and queues
 * the command for the server. Never reports the change as made on the
 * server: the caller shows "waiting for the server" until it answers.
 */
export async function requestPortalAccessChange(
  patientId: string,
  enabled: boolean,
  options: {
    source?: PortalAccessSource;
    reason?: PortalAccessReason;
    actor?: PortalAccessActor | null;
    /**
     * The patient may exist only on the server (admin pages that list server
     * records). The command is still queued; this device has no copy to
     * update.
     */
    serverRecord?: boolean;
  } = {},
): Promise<PortalAccessChangeResult> {
  const actor = options.actor ?? currentActor();
  if (!actor) {
    return { ok: false, error: "Sign in to change portal access." };
  }
  if (!can(actor.role, "portal_manage")) {
    return { ok: false, error: "Your role cannot change portal access." };
  }

  try {
    const patient = await db.patients.get(patientId);
    if (!patient && !(options.serverRecord && portalServerConfigured())) {
      return { ok: false, error: "This patient is not on this device." };
    }
    if (patient?.mergeInto) {
      return {
        ok: false,
        error:
          "This record was merged into another record. Change portal access on the record it was merged into.",
      };
    }

    const value: 0 | 1 = enabled ? 1 : 0;

    // (Without a server, `patient` is always set: checked above.)
    if (!portalServerConfigured() && patient) {
      const changed = await db.patients.update(patientId, { portalEnabled: value });
      if (changed === 0 && patient.portalEnabled !== value) {
        return { ok: false, error: "Portal access was not saved. Try again." };
      }
      await createAuditLog(actor.role, enabled ? "portal_access_on" : "portal_access_off", "patient", patientId);
      return { ok: true, state: "device_only" };
    }

    const commandId = newCommandId();
    await db.transaction("rw", db.patients, db.serverCommands, async () => {
      if (patient) {
        const changed = await db.patients.update(patientId, {
          portalEnabled: value,
          portalPending: 1,
        });
        if (changed === 0 && !(patient.portalEnabled === value && patient.portalPending === 1)) {
          throw namedError("PortalAccessNotSaved");
        }
      }
      await enqueueCommand(asCommandStore(db.serverCommands), {
        id: commandId,
        rpc: PORTAL_ACCESS_RPC,
        args: {
          p_patient_id: patientId,
          p_enabled: enabled,
          p_reason: options.reason ?? "staff_choice",
          p_client_at: new Date().toISOString(),
          p_requested_by: actor.id,
          p_source: options.source ?? "staff",
        },
        authorId: actor.id,
        requiredPermission: "portal_manage",
        entityRefs: [{ table: "patients", id: patientId }],
      });
    });

    await createAuditLog(
      actor.role,
      enabled ? "portal_access_on_requested" : "portal_access_off_requested",
      "patient",
      patientId,
    );
    sendSoon();
    return { ok: true, state: "waiting_for_server", commandId };
  } catch (error) {
    console.warn(
      "[portalAccess] change not saved",
      error instanceof Error ? error.name : "unknown",
    );
    return { ok: false, error: "Portal access was not saved. Try again." };
  }
}

/** Send queued commands now when the device looks online (best effort). */
function sendSoon(): void {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  void drainServerCommands().catch((error) => {
    console.warn(
      "[portalAccess] sending queued changes failed",
      error instanceof Error ? error.name : "unknown",
    );
  });
}

/** Queued portal access commands by id (for bulk runs that follow them). */
export async function getPortalAccessCommands(ids: string[]): Promise<(ServerCommand | undefined)[]> {
  return db.serverCommands.bulkGet(ids);
}

/** Portal access commands for one patient, newest first. */
export async function listPortalAccessCommands(patientId: string): Promise<ServerCommand[]> {
  const commands = await db.serverCommands
    .where("rpc")
    .equals(PORTAL_ACCESS_RPC)
    .filter((c) => refersToPatient(c, patientId))
    .toArray();
  return commands.sort((a, b) => b.createdAt - a.createdAt);
}

/** Portal access commands for any of these patients. */
export async function listPortalAccessCommandsFor(patientIds: string[]): Promise<ServerCommand[]> {
  const wanted = new Set(patientIds);
  return db.serverCommands
    .where("rpc")
    .equals(PORTAL_ACCESS_RPC)
    .filter((c) => (c.entityRefs ?? []).some((ref) => ref.table === "patients" && wanted.has(ref.id)))
    .toArray();
}

async function otherOpenCommands(patientId: string, exceptId: string): Promise<number> {
  return db.serverCommands
    .where("status")
    .anyOf(OPEN_STATUSES)
    .filter((c) => c.rpc === PORTAL_ACCESS_RPC && c.id !== exceptId && refersToPatient(c, patientId))
    .count();
}

function patientIdOf(command: ServerCommand): string | null {
  const ref = (command.entityRefs ?? []).find((r) => r.table === "patients");
  if (ref?.id) return ref.id;
  const arg = command.args?.p_patient_id;
  return typeof arg === "string" && arg ? arg : null;
}

/** The server applied a portal access command: store its answer. */
export async function handlePortalAccessApplied(command: ServerCommand, result: unknown): Promise<void> {
  const patientId = patientIdOf(command);
  if (!patientId) return;
  // A newer change for this patient is still waiting: keep showing it.
  if ((await otherOpenCommands(patientId, command.id)) > 0) return;
  const parsed = parsePortalAccessResult(result);
  const changes: Partial<Patient> = { portalPending: 0 };
  if (typeof parsed.portalEnabled === "boolean") changes.portalEnabled = parsed.portalEnabled ? 1 : 0;
  if (parsed.changedAt !== undefined) changes.portalEnabledChangedAt = parsed.changedAt;
  await db.patients.update(patientId, changes);
}

/**
 * The server refused a portal access command: put back the server's value.
 * The outbox has already filed the refusal for review.
 */
export async function handlePortalAccessRejected(command: ServerCommand): Promise<void> {
  const patientId = patientIdOf(command);
  if (!patientId) return;
  if ((await otherOpenCommands(patientId, command.id)) > 0) return;
  const parsed = parsePortalAccessResult(command.result);
  if (typeof parsed.portalEnabled === "boolean") {
    // The refusal carries the server's current value.
    const changes: Partial<Patient> = {
      portalPending: 0,
      portalEnabled: parsed.portalEnabled ? 1 : 0,
    };
    if (parsed.changedAt !== undefined) changes.portalEnabledChangedAt = parsed.changedAt;
    await db.patients.update(patientId, changes);
    return;
  }
  // No value in the answer (for example the author may not manage portal
  // access): show access as off until the server's value is downloaded.
  await db.patients.update(patientId, { portalPending: 0, portalEnabled: 0 });
  try {
    await refetchRows("patients", "id", [patientId]);
  } catch (error) {
    console.warn(
      "[portalAccess] could not download the server's portal access",
      error instanceof Error ? error.name : "unknown",
    );
  }
}

let unregister: (() => void) | null = null;

/**
 * Register the outbox handler for portal access answers (also for the
 * one-off backfill commands, which have no author). Safe to call more than
 * once; runs when this module loads.
 */
export function registerPortalAccessHandlers(): void {
  if (unregister) return;
  unregister = registerCommandHandler(PORTAL_ACCESS_RPC, {
    onApplied: handlePortalAccessApplied,
    onRejected: (command) => handlePortalAccessRejected(command),
  });
}

registerPortalAccessHandlers();
