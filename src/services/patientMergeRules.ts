// Patient merge rules shared by the device and its tests.
//
// A merge is decided by the server (merge_patients RPC,
// supabase/migrations/20260925100300_patient_merge_authoritative.sql). The
// device applies it straight away and queues the command; these pure
// functions decide what may be merged, which field choices are sent, and how
// the server's answer reads. They never touch the database.

export { MERGE_PATIENTS_RPC } from "@/db/migrations/backfillPlans";

/** Where a merge was requested (patient_merges.source on the server). */
export type MergeSource = "dedupe_modal" | "conflict_review" | "backfill";

/**
 * Patient fields a merge may copy onto the kept record: this device's field
 * name -> server column. The server applies only these columns (keep the
 * list in sync with c_fields in merge_patients).
 */
export const MERGE_FIELD_COLUMNS: Readonly<Record<string, string>> = {
  givenName: "given_name",
  familyName: "family_name",
  sex: "sex",
  dob: "dob",
  phone: "phone",
  email: "email",
  address: "address",
  state: "state",
  lga: "lga",
  photoUrl: "photo_url",
};

/** Fields the server never clears (an empty choice is ignored). */
const REQUIRED_COLUMNS = new Set(["given_name", "family_name", "sex", "dob"]);

/** Which record a chosen value came from. */
export type FieldChoiceSource = "winner" | "loser" | "custom";

export interface FieldChoice {
  source: FieldChoiceSource;
  value: string | number | boolean | null;
}

/** Sent as p_field_choices: server column -> choice. */
export type MergeFieldChoices = Record<string, FieldChoice>;

/** A value chosen for the kept record, in this device's field names. */
export interface ChosenValue {
  field: string;
  value: unknown;
  source: FieldChoiceSource;
}

function toJsonValue(column: string, value: unknown): FieldChoice["value"] | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    // A date of birth is a calendar day on the server.
    return column === "dob" ? value.toISOString().slice(0, 10) : value.toISOString();
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  return undefined; // objects and arrays are never patient field values
}

/**
 * Field choices for the server: only fields a merge may change, never an
 * empty name, sex or date of birth. Returns the choices and the fields left
 * out (so the caller can say so).
 */
export function buildFieldChoices(chosen: ChosenValue[]): {
  choices: MergeFieldChoices;
  skipped: string[];
} {
  const choices: MergeFieldChoices = {};
  const skipped: string[] = [];
  for (const c of chosen) {
    const column = MERGE_FIELD_COLUMNS[c.field];
    const value = column ? toJsonValue(column, c.value) : undefined;
    if (!column || value === undefined || (value === null && REQUIRED_COLUMNS.has(column))) {
      skipped.push(c.field);
      continue;
    }
    choices[column] = { source: c.source, value };
  }
  return { choices, skipped };
}

/** The same choices as a patch in this device's field names. */
export function localPatchFromChoices(choices: MergeFieldChoices): Record<string, unknown> {
  const byColumn = new Map(Object.entries(MERGE_FIELD_COLUMNS).map(([field, col]) => [col, field]));
  const patch: Record<string, unknown> = {};
  for (const [column, choice] of Object.entries(choices ?? {})) {
    const field = byColumn.get(column);
    if (!field || !choice || typeof choice !== "object") continue;
    if (choice.value === null && REQUIRED_COLUMNS.has(column)) continue;
    patch[field] = choice.value;
  }
  return patch;
}

/** This device's field names for server columns (unknown columns are left out). */
export function deviceFieldsForColumns(columns: string[]): string[] {
  const byColumn = new Map(Object.entries(MERGE_FIELD_COLUMNS).map(([field, col]) => [col, field]));
  return columns.map((c) => byColumn.get(c)).filter((f): f is string => !!f);
}

/** Longest merge chain followed (the server stops at the same depth). */
export const MAX_MERGE_CHAIN = 10;

/**
 * The record `id` now lives on: follows mergeInto links. Stops at an
 * unknown record, a loop or MAX_MERGE_CHAIN steps.
 */
export function followMergeChain(
  id: string,
  mergedInto: (id: string) => string | null | undefined,
): string {
  let current = id;
  const seen = new Set<string>([id]);
  for (let i = 0; i < MAX_MERGE_CHAIN; i++) {
    const next = mergedInto(current);
    if (!next || seen.has(next)) break;
    seen.add(next);
    current = next;
  }
  return current;
}

export type MergeRefusal =
  | "not_permitted"
  | "same_record"
  | "not_on_device"
  | "cycle"
  | "loser_merged_elsewhere"
  | "already_merged";

export interface MergeCheckInput {
  winnerId: string;
  loserId: string;
  winnerExists: boolean;
  loserExists: boolean;
  /** followMergeChain(winnerId). */
  winnerRoot: string;
  /** followMergeChain(loserId). */
  loserRoot: string;
  /** The merged-away record's current merge link, if any. */
  loserMergeInto?: string | null;
}

export type MergeCheck = { ok: true; rootId: string } | { ok: false; reason: MergeRefusal };

/**
 * May the loser be merged into the winner? Same order of checks as the
 * server. A winner that was itself merged is replaced by the record it was
 * merged into (rootId).
 */
export function checkMerge(input: MergeCheckInput): MergeCheck {
  const { winnerId, loserId } = input;
  if (!winnerId || !loserId || winnerId === loserId) return { ok: false, reason: "same_record" };
  if (!input.winnerExists || !input.loserExists) return { ok: false, reason: "not_on_device" };
  if (input.winnerRoot === loserId) return { ok: false, reason: "cycle" };
  if (input.loserRoot === input.winnerRoot) return { ok: false, reason: "already_merged" };
  if (input.loserMergeInto) return { ok: false, reason: "loser_merged_elsewhere" };
  return { ok: true, rootId: input.winnerRoot };
}

/** Plain-English reason a merge was not made (device or server refusal). */
export function mergeRefusalMessage(reason: string): string {
  switch (reason) {
    case "not_permitted":
    case "permission_denied":
      return "Your role cannot merge patient records. Ask a nurse, doctor, lead clinician, auditor or administrator.";
    case "same_record":
      return "Both choices are the same record, so there is nothing to merge.";
    case "not_on_device":
      return "One of the records is not on this device. Sync, then try again.";
    case "cycle":
      return "The record chosen to keep was already merged into the other one. Keep that record instead.";
    case "loser_merged_elsewhere":
      return "This record was already merged into a different patient. Review that merge first.";
    case "already_merged":
      return "These records are already merged.";
    case "patient_not_on_server":
      return "One of the records has not reached the server yet. The merge is sent again at the next sync.";
    case "invalid_request":
      return "The merge request was incomplete, so the server did not apply it.";
    default:
      return "The server did not apply the merge.";
  }
}

/** The server's answer to a merge_patients command. */
export interface MergeResult {
  outcome: "applied" | "rejected" | "unknown";
  mergeId?: string;
  /** The record the loser now lives on (after following merge chains). */
  winnerId?: string;
  loserId?: string;
  mergedAt?: string;
  alreadyMerged: boolean;
  reason?: string;
  movedCounts: Record<string, number>;
  skippedFields: string[];
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

export function parseMergeResult(result: unknown): MergeResult {
  const r = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  const outcome = r.outcome === "applied" || r.outcome === "rejected" ? r.outcome : "unknown";
  const moved: Record<string, number> = {};
  if (r.moved_counts && typeof r.moved_counts === "object") {
    for (const [k, v] of Object.entries(r.moved_counts as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) moved[k] = v;
    }
  }
  return {
    outcome,
    mergeId: str(r.merge_id),
    winnerId: str(r.winner_id),
    loserId: str(r.loser_id),
    mergedAt: str(r.merged_at),
    alreadyMerged: r.already_merged === true,
    reason: str(r.reason),
    movedCounts: moved,
    skippedFields: Array.isArray(r.skipped_fields)
      ? r.skipped_fields.filter((f): f is string => typeof f === "string")
      : [],
  };
}

/** Arguments of the merge_patients RPC (p_command_id is added when sent). */
export function mergeCommandArgs(input: {
  winnerId: string;
  loserId: string;
  fieldChoices: MergeFieldChoices;
  requestedBy: string | null;
  requestedAt: string;
  source: MergeSource;
  mergeId: string;
}): Record<string, unknown> {
  return {
    p_winner_id: input.winnerId,
    p_loser_id: input.loserId,
    p_field_choices: input.fieldChoices,
    p_requested_by: input.requestedBy,
    p_requested_at: input.requestedAt,
    p_source: input.source,
    p_merge_id: input.mergeId,
  };
}

/** Winner and loser of a merge command (from its arguments). */
export function mergeCommandPatients(args: Record<string, unknown> | undefined): {
  winnerId?: string;
  loserId?: string;
} {
  return { winnerId: str(args?.p_winner_id), loserId: str(args?.p_loser_id) };
}
