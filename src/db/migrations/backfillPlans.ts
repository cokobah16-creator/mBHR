// What the one-off device backfills (0004, 0005) queue for the server.
// Pure functions, so the rules can be tested without a database.

import type { Patient, PatientMerge, ServerCommand } from "../index";
import { newCommandId, type EnqueueInput } from "@/sync/commandOutbox";

/** RPC that records a portal access decision (portal-access package). */
export const PORTAL_ACCESS_RPC = "set_patient_portal_access";
/** RPC that merges two patient records (patient-merge package). */
export const MERGE_PATIENTS_RPC = "merge_patients";

const DAY_MS = 86_400_000;

function iso(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "string" && value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function refersTo(command: Pick<ServerCommand, "entityRefs">, table: string, id: string): boolean {
  return (command.entityRefs ?? []).some((ref) => ref.table === table && ref.id === id);
}

export interface PortalBackfillPlan {
  patientId: string;
  command: EnqueueInput;
}

/**
 * One "enable" command for each patient this device shows as portal-enabled
 * (and not merged away), unless a portal command for that patient is
 * already queued. Disables are not backfilled: every patient got
 * portalEnabled = 0 by default in an earlier upgrade, so a deliberate
 * disable cannot be told apart from that default.
 */
export function planPortalAccessBackfill(
  patients: Pick<Patient, "id" | "portalEnabled" | "mergeInto" | "updatedAt">[],
  queued: Pick<ServerCommand, "rpc" | "entityRefs">[],
): PortalBackfillPlan[] {
  const portalCommands = queued.filter((c) => c.rpc === PORTAL_ACCESS_RPC);
  return patients
    .filter((p) => p.portalEnabled === 1 && !p.mergeInto)
    .filter((p) => !portalCommands.some((c) => refersTo(c, "patients", p.id)))
    .map((p) => ({
      patientId: p.id,
      command: {
        rpc: PORTAL_ACCESS_RPC,
        args: {
          p_patient_id: p.id,
          p_enabled: true,
          p_reason: "backfill",
          p_client_at: iso(p.updatedAt),
          p_requested_by: null,
          p_source: "backfill",
        },
        authorId: null,
        requiredPermission: "portal_manage",
        entityRefs: [{ table: "patients", id: p.id }],
      },
    }));
}

export interface MergeBackfillPlan {
  mergeId: string;
  loserId: string;
  command: EnqueueInput & { id: string };
}

/**
 * One merge command for each merge recorded on this device that was never
 * sent to the server (no commandId). Field choices were applied locally at
 * the time and are not known any more, so none are sent.
 */
export function planMergeBackfill(
  merges: Pick<PatientMerge, "id" | "winnerId" | "loserId" | "mergedBy" | "createdDay" | "commandId">[],
  makeId: () => string = newCommandId,
): MergeBackfillPlan[] {
  return merges
    .filter((m) => !m.commandId && m.winnerId && m.loserId && m.winnerId !== m.loserId)
    .map((m) => ({
      mergeId: m.id,
      loserId: m.loserId,
      command: {
        id: makeId(),
        rpc: MERGE_PATIENTS_RPC,
        args: {
          p_winner_id: m.winnerId,
          p_loser_id: m.loserId,
          p_field_choices: {},
          p_requested_by: m.mergedBy ?? null,
          p_requested_at: Number.isFinite(m.createdDay)
            ? new Date(m.createdDay * DAY_MS).toISOString()
            : null,
          p_source: "backfill",
        },
        authorId: null,
        requiredPermission: "merge_patients",
        entityRefs: [
          { table: "patients", id: m.winnerId },
          { table: "patients", id: m.loserId },
          { table: "patient_merges", id: m.id },
        ],
      },
    }));
}
