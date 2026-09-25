// src/sync/adapter.ts
import { supabase as sharedClient } from "@/lib/supabase";
import { checkCloudSession } from "@/lib/cloudSession";
import { can, type Role } from "@/auth/roles";
import { useAuthStore } from "@/stores/auth";
import { countBlockedIn } from "@/features/conflicts/syncCounts";
import { db } from "../db";
import type { ServerCommand } from "../db";
import { PendingOperation, processQueue } from "../stores/operationsQueue";
import { useSyncStore } from "../stores/syncStore";
import type {
  ConflictData,
  ConflictField,
} from "../components/ConflictResolutionModal";
import { findFieldConflicts } from "./fieldCompare";
import { mergePulledRow } from "./pullMerge";
import { keepLocalRevocation, staffFromServerRow } from "./staffRoster";
import { markersAfterUpload } from "./uploadMarkers";
import {
  serverStampMarker,
  serverStampOf,
  serverUnchangedSince,
  stampAfterUpload,
} from "./serverStamp";
import { namedSyncError, syncErrorCode } from "./errorCode";
import { queueSyncConflicts } from "./queueConflicts";
import { advanceCursor, isCursorAhead } from "./cursorGuard";
import {
  countOpenCommands,
  countWaitingPermission,
  drainCommands,
  PERMISSION_RETRY_MS,
  type CommandSender,
  type CommandStore,
  type DrainDeps,
  type DrainSummary,
} from "./commandOutbox";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Check if URL and key are valid (not placeholder values)
const isValidUrl =
  url &&
  key &&
  url !== "your_supabase_project_url_here" &&
  key !== "your_supabase_anon_key_here" &&
  (url.startsWith("http://") || url.startsWith("https://"));

// The shared client carries the staff member's online sign-in, so the
// server's row-level security sees who is syncing. (A private client with
// persistSession: false synced as the anonymous role and was refused.)
const sb = isValidUrl ? sharedClient : null;

/** syncNow result error when there is no online sign-in (not a failure). */
export const NO_CLOUD_SESSION = "NoCloudSession";

export function isOnlineSyncEnabled() {
  return !!sb;
}

type Tbl =
  | "app_users"
  | "patients"
  | "visits"
  | "vitals"
  | "consultations"
  | "dispenses"
  | "inventory"
  | "queue"
  | "patient_allergies"
  | "patient_preferences"
  | "queue_transitions"
  | "patient_merges";

/** Server tables this sync engine handles. */
export type SyncTable = Tbl;

/**
 * Append-only audit tables. Rows are created on a device and never edited,
 * so they are uploaded with insert-if-absent (no conflict check, no update
 * of a server row) and never downloaded: the server copy is read by
 * admins, auditors and lead clinicians, not by devices.
 */
const APPEND_ONLY: ReadonlySet<Tbl> = new Set<Tbl>(["queue_transitions"]);

/**
 * Download-only tables: written on the server by command RPCs, never
 * uploaded from a device (patient_merges: the merge history every device
 * keeps).
 */
const PULL_ONLY: ReadonlySet<Tbl> = new Set<Tbl>(["patient_merges"]);

/**
 * Tables whose server rows carry row_version (bumped by the server on every
 * write). Conflicts are detected by comparing it with the version this
 * device last saw, not by comparing device and server clocks.
 */
const VERSIONED: ReadonlySet<Tbl> = new Set<Tbl>(["patients", "queue"]);

/**
 * Tables whose conflicts are detected by comparing the server's updated_at
 * with the one this device last saw (_serverUpdatedAt, see serverStamp.ts):
 * every uploaded table without row_version.
 */
function comparesServerStamp(t: Tbl): boolean {
  return !APPEND_ONLY.has(t) && !PULL_ONLY.has(t) && !VERSIONED.has(t);
}

/** Uploaded columns (this device's field -> server column). */
const mapToDB: Record<Tbl, Record<string, string>> = {
  // Never add pinHash, pinSalt or pinEnrolledAt here: a staff PIN is a
  // device-only credential and must not reach the server.
  app_users: {
    id: "id",
    fullName: "full_name",
    role: "role",
    adminAccess: "admin_access",
    adminPermanent: "admin_permanent",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  patients: {
    id: "id",
    givenName: "given_name",
    familyName: "family_name",
    sex: "sex",
    dob: "dob",
    phone: "phone",
    address: "address",
    state: "state",
    lga: "lga",
    photoUrl: "photo_url",
    familyId: "family_id",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  visits: {
    id: "id",
    patientId: "patient_id",
    startedAt: "started_at",
    siteName: "site_name",
    status: "status",
    updatedAt: "updated_at",
  },
  vitals: {
    id: "id",
    patientId: "patient_id",
    visitId: "visit_id",
    heightCm: "height_cm",
    weightKg: "weight_kg",
    tempC: "temp_c",
    pulseBpm: "pulse_bpm",
    systolic: "systolic",
    diastolic: "diastolic",
    spo2: "spo2",
    bmi: "bmi",
    flags: "flags",
    takenAt: "taken_at",
    updatedAt: "updated_at",
  },
  consultations: {
    id: "id",
    patientId: "patient_id",
    visitId: "visit_id",
    providerName: "provider_name",
    soapSubjective: "soap_subjective",
    soapObjective: "soap_objective",
    soapAssessment: "soap_assessment",
    soapPlan: "soap_plan",
    provisionalDx: "provisional_dx",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  dispenses: {
    id: "id",
    patientId: "patient_id",
    visitId: "visit_id",
    itemName: "item_name",
    qty: "qty",
    dosage: "dosage",
    directions: "directions",
    dispensedBy: "dispensed_by",
    dispensedAt: "dispensed_at",
    updatedAt: "updated_at",
  },
  inventory: {
    id: "id",
    itemName: "item_name",
    unit: "unit",
    onHandQty: "on_hand_qty",
    reorderThreshold: "reorder_threshold",
    updatedAt: "updated_at",
  },
  queue: {
    id: "id",
    patientId: "patient_id",
    stage: "stage",
    position: "position",
    status: "status",
    // Urgent status must reach every device (owner decision): sync it.
    priority: "priority",
    queuedAt: "queued_at",
    createdBy: "created_by",
    // Ticket, site and service day (queue-ticket package) and the staff
    // member who called the patient, so every device and the waiting-room
    // display show the same ticket and assignee.
    ticketId: "ticket_id",
    ticketNumber: "ticket_number",
    siteKey: "site_key",
    serviceDate: "service_date",
    assignedTo: "assigned_to",
    assignedName: "assigned_name",
    updatedAt: "updated_at",
  },
  patient_allergies: {
    id: "id",
    patientId: "patient_id",
    allergen: "allergen",
    allergyType: "allergy_type",
    reaction: "reaction",
    severity: "severity",
    onsetDate: "onset_date",
    notes: "notes",
    isActive: "is_active",
    createdAt: "created_at",
    updatedAt: "updated_at",
    createdBy: "created_by",
  },
  patient_preferences: {
    id: "id",
    patientId: "patient_id",
    preferredLanguage: "preferred_language",
    communicationChannel: "communication_channel",
    bestContactTime: "best_contact_time",
    dietaryRestrictions: "dietary_restrictions",
    religiousCultural: "religious_cultural",
    appointmentReminders: "appointment_reminders",
    medicationReminders: "medication_reminders",
    notes: "notes",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  queue_transitions: {
    id: "id",
    queueItemId: "queue_item_id",
    toQueueItemId: "to_queue_item_id",
    patientId: "patient_id",
    kind: "kind",
    fromStage: "from_stage",
    toStage: "to_stage",
    fromStatus: "from_status",
    toStatus: "to_status",
    fromPriority: "from_priority",
    toPriority: "to_priority",
    reason: "reason",
    userId: "user_id",
    userRole: "user_role",
    deviceId: "device_id",
    at: "at",
  },
  patient_merges: {},
};

/**
 * Downloaded but never uploaded (this device's field -> server column):
 * values only the server sets.
 */
const pullOnlyMap: Partial<Record<Tbl, Record<string, string>>> = {
  patients: {
    portalEnabled: "portal_enabled",
    portalEnabledChangedAt: "portal_enabled_changed_at",
    mergeInto: "merged_into",
    mergedAt: "merged_at",
    _serverVersion: "row_version",
  },
  queue: {
    _serverVersion: "row_version",
  },
  patient_merges: {
    id: "id",
    winnerId: "winner_id",
    loserId: "loser_id",
    mergedBy: "merged_by",
    reason: "reason",
    commandId: "command_id",
    fieldChoices: "field_choices",
    requestedAt: "requested_at",
    kind: "kind",
    source: "source",
    createdAt: "created_at",
  },
};

const mapFromDB: Record<Tbl, Record<string, string>> = Object.fromEntries(
  (Object.keys(mapToDB) as Tbl[]).map((t) => [
    t,
    Object.fromEntries(
      Object.entries({ ...mapToDB[t], ...(pullOnlyMap[t] ?? {}) }).map(
        ([app, column]) => [column, app],
      ),
    ),
  ]),
) as Record<Tbl, Record<string, string>>;

/**
 * Columns added by the sync foundation migration
 * (20260925100000_sync_authority_foundation.sql). If the server has not
 * been migrated yet, uploads are retried without them instead of failing.
 */
const FOUNDATION_COLUMNS: Partial<Record<Tbl, string[]>> = {
  queue: [
    "ticket_id",
    "ticket_number",
    "site_key",
    "service_date",
    "assigned_to",
    "assigned_name",
  ],
};
/** Set when the server reported a missing foundation column this session. */
let serverLacksFoundation = false;

/**
 * Fields only the server changes. A download applies them even to a record
 * with unsent edits on this device (the edits are kept).
 */
const SERVER_OWNED: Partial<Record<Tbl, string[]>> = {
  patients: ["portalEnabled", "portalEnabledChangedAt", "mergeInto", "mergedAt"],
};

/**
 * Optimistic local changes waiting for a command: while `marker` is 1 on
 * the local record, a download leaves `fields` alone.
 */
interface HoldRule {
  marker: string;
  fields: string[];
}
const HOLDS: Partial<Record<Tbl, HoldRule[]>> = {
  patients: [
    { marker: "portalPending", fields: ["portalEnabled", "portalEnabledChangedAt"] },
    { marker: "mergePending", fields: ["mergeInto", "mergedAt"] },
  ],
};

type Row = Record<string, unknown>;

const QUEUE_KEEP_WHEN_EMPTY = [
  "ticketId",
  "ticketNumber",
  "siteKey",
  "serviceDate",
  "assignedTo",
  "assignedName",
];

/**
 * Clinical times the server sends as ISO text. They are stored as Date
 * objects, like records made on this device, so exports and date queries
 * read the recorded time.
 */
const PULLED_DATE_FIELDS: Partial<Record<Tbl, string[]>> = {
  visits: ["startedAt"],
  vitals: ["takenAt"],
  consultations: ["createdAt"],
  dispenses: ["dispensedAt"],
  patient_allergies: ["onsetDate", "createdAt"],
};

/** Server row -> this device's shape, including server-only rules. */
function transformPulled(t: Tbl, raw: Row, mapped: Row): Row {
  if (t === "app_users") {
    // Identity, role and active status only: the device-only PIN fields are
    // never part of a staff download (see src/sync/staffRoster.ts).
    return { ...staffFromServerRow(raw) };
  }
  for (const field of PULLED_DATE_FIELDS[t] ?? []) {
    const value = mapped[field];
    if (typeof value !== "string" || value === "") continue;
    const date = new Date(value);
    // An unreadable value is left as it came rather than invented.
    if (!Number.isNaN(date.getTime())) mapped[field] = date;
  }
  if (t === "patients") {
    // Portal access counts as a server decision only once the server has
    // recorded one (portal_enabled_changed_at). Before that the server
    // value is only the column default, so this device's value stands.
    if (raw.portal_enabled_changed_at === null || raw.portal_enabled_changed_at === undefined) {
      delete mapped.portalEnabled;
      delete mapped.portalEnabledChangedAt;
    } else if ("portal_enabled" in raw) {
      mapped.portalEnabled = raw.portal_enabled ? 1 : 0;
    }
    // A merge link comes from the server only when it has one; a merge made
    // on this device is undone by its command handler, not by a download.
    if (raw.merged_into === null || raw.merged_into === undefined) {
      delete mapped.mergeInto;
      delete mapped.mergedAt;
    }
  }
  if (t === "queue") {
    // Ticket, site, day and assignee are never cleared once set. A server
    // row without them (uploaded by an older app version) must not wipe the
    // ticket label this device already announced.
    for (const field of QUEUE_KEEP_WHEN_EMPTY) {
      if (mapped[field] === null || mapped[field] === undefined) delete mapped[field];
    }
  }
  if (t === "patient_merges") {
    const created = typeof raw.created_at === "string" ? new Date(raw.created_at) : null;
    if (created && !Number.isNaN(created.getTime())) {
      mapped.createdDay = Math.floor(created.getTime() / 86400000); // epochDay
    }
    mapped.status = "applied";
    if (mapped.reason === null || mapped.reason === undefined) mapped.reason = "";
  }
  return mapped;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toDB(obj: any, map: Record<string, string>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any = {};
  for (const [appKey, dbKey] of Object.entries(map))
    if (obj[appKey] !== undefined) out[dbKey] = obj[appKey];
  return out;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromDB(obj: any, map: Record<string, string>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any = {};
  for (const [dbKey, appKey] of Object.entries(map))
    if (obj[dbKey] !== undefined) out[appKey] = obj[dbKey];
  return out;
}

const tables: Tbl[] = [
  "app_users",
  "patients",
  "visits",
  "vitals",
  "consultations",
  "dispenses",
  "inventory",
  "queue",
  "patient_allergies",
  "patient_preferences",
  "queue_transitions",
  "patient_merges",
];

// Map remote table names to local Dexie table names
const localTableMap: Record<Tbl, string> = {
  app_users: "users",
  patients: "patients",
  visits: "visits",
  vitals: "vitals",
  consultations: "consultations",
  dispenses: "dispenses",
  inventory: "inventory",
  queue: "queue",
  patient_allergies: "patientAllergies",
  patient_preferences: "patientPreferences",
  queue_transitions: "queueTransitions",
  patient_merges: "patientMerges",
};

/** Local tables this engine uploads (every synced table except download-only ones). */
const uploadLocalTables = (): string[] =>
  tables.filter((t) => !PULL_ONLY.has(t)).map((t) => localTableMap[t]);

// ---------------------------------------------------------------------------
// Sync participants (other packages hook in without editing this file)
// ---------------------------------------------------------------------------

export interface SyncParticipant {
  /** Short name for logs and results, e.g. "queue-tickets". */
  name: string;
  /** Runs after commands are sent, before this engine uploads records. */
  beforePush?: () => Promise<void>;
  /** Runs after this engine downloads records. */
  afterPull?: () => Promise<void>;
  /** Extra server-owned fields per table (applied over unsent edits). */
  serverOwned?: Partial<Record<Tbl, string[]>>;
  /** Extra optimistic-change holds per table. */
  holds?: Partial<Record<Tbl, HoldRule[]>>;
}

const participants: SyncParticipant[] = [];

/**
 * Add a participant to every sync run (Sync now, background and reconnect
 * syncs). Registering the same name again replaces it. Returns a function
 * that removes it.
 */
export function registerSyncParticipant(participant: SyncParticipant): () => void {
  const existing = participants.findIndex((p) => p.name === participant.name);
  if (existing >= 0) participants.splice(existing, 1);
  participants.push(participant);
  return () => {
    const i = participants.indexOf(participant);
    if (i >= 0) participants.splice(i, 1);
  };
}

function serverOwnedFor(t: Tbl): string[] {
  const fields = new Set(SERVER_OWNED[t] ?? []);
  for (const p of participants) for (const f of p.serverOwned?.[t] ?? []) fields.add(f);
  return [...fields];
}

function heldFor(t: Tbl, localRow: Row | undefined): string[] {
  if (!localRow) return [];
  const rules = [...(HOLDS[t] ?? []), ...participants.flatMap((p) => p.holds?.[t] ?? [])];
  const held: string[] = [];
  for (const rule of rules) if (localRow[rule.marker] === 1) held.push(...rule.fields);
  return held;
}

async function runParticipants(
  phase: "beforePush" | "afterPull",
  failures: string[],
): Promise<void> {
  for (const participant of [...participants]) {
    const step = participant[phase];
    if (!step) continue;
    try {
      await step();
    } catch (error) {
      console.warn(`[sync] ${participant.name} (${phase}) failed`, syncErrorCode(error));
      failures.push(participant.name);
    }
  }
}

// ---------------------------------------------------------------------------
// Who is syncing
// ---------------------------------------------------------------------------

/** The online (Supabase) user on this device, or null. Never throws. */
async function currentCloudUser(): Promise<{ id: string; email: string | null } | null> {
  try {
    const auth = sb?.auth;
    if (!auth || typeof auth.getSession !== "function") return null;
    const { data } = await auth.getSession();
    const user = data?.session?.user;
    return user?.id ? { id: user.id, email: user.email ?? null } : null;
  } catch {
    return null;
  }
}

/**
 * The staff member signed in online on this device: the local account and
 * the online account must be the same person. null otherwise.
 */
export async function currentCommandSender(): Promise<CommandSender | null> {
  const cloud = await currentCloudUser();
  if (!cloud) return null;
  const { currentUser: user, authMode } = useAuthStore.getState();
  if (!user) return null;
  // A PIN session never sends to the server, whatever sign-in is stored.
  if (authMode !== "online") return null;
  const sameAccount =
    user.id === cloud.id ||
    (!!user.email && !!cloud.email && user.email.toLowerCase() === cloud.email.toLowerCase());
  if (!sameAccount) return null;
  return { localUserId: user.id, cloudUserId: cloud.id, role: user.role };
}

/** Staff accounts are uploaded only by someone who may manage them. */
function mayUploadStaffAccounts(): boolean {
  const role = useAuthStore.getState().currentUser?.role as Role | undefined;
  return !!role && can(role, "users");
}

/** Server columns of a staff row that grant access. */
const STAFF_PRIVILEGE_COLUMNS = ["role", "admin_access", "admin_permanent"] as const;

/**
 * The staff row's current values were saved on the Users screen (which
 * checks the users permission and records who saved them).
 */
function staffEditFromUsersScreen(record: Row): boolean {
  return typeof record._staffEditBy === "string" && record._staffEditBy !== "";
}

function isPermissionRefusal(error: unknown, status?: number): boolean {
  const code =
    error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  return code === "42501" || status === 403;
}

function isMissingColumn(error: unknown): boolean {
  const code =
    error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  return code === "PGRST204" || code === "42703";
}

/** A record the server refused for this online user less than 6 hours ago. */
function blockedFor(record: Row, cloudUserId: string | null, now: number): boolean {
  const block = record._syncBlock as
    | { reason?: string; refusedFor?: string; at?: number }
    | undefined;
  if (!block || block.reason !== "permission") return false;
  if (!cloudUserId || block.refusedFor !== cloudUserId) return false;
  return now - (block.at ?? 0) < PERMISSION_RETRY_MS;
}

// ---------------------------------------------------------------------------
// Command outbox wiring (db.serverCommands)
// ---------------------------------------------------------------------------

/** A Dexie table used as a command outbox (typed for commandOutbox). */
export function asCommandStore(table: unknown): CommandStore {
  return table as CommandStore;
}

/**
 * Everything drainCommands needs to send commands as the person signed in
 * online. Packages with their own outbox table (for example the pharmacy
 * database) use it with drainCommands(theirTable, commandDeps()).
 */
export function commandDeps(): DrainDeps {
  return {
    callRpc: async (rpc, args) => {
      if (!sb) throw namedSyncError("SyncNotConfigured");
      const response = await sb.rpc(rpc, args);
      return {
        data: response.data,
        error: response.error
          ? { code: response.error.code, message: response.error.message }
          : null,
        status: response.status,
      };
    },
    sender: currentCommandSender,
    hasPermission: (role, permission) =>
      can(role as Role, permission as Parameters<typeof can>[1]),
    onRejected: async (command: ServerCommand) => {
      const settled = new Date(command.settledAt ?? Date.now()).toISOString();
      // Records the command touched, by table and id only (never names).
      const records = (command.entityRefs ?? [])
        .map((ref) => `${ref.table} ${ref.id}`)
        .join(", ");
      const field: ConflictField = {
        field: "server_command",
        label: "Change refused by the server",
        localValue: records ? `${command.rpc} (${records})` : command.rpc,
        remoteValue: command.rejectReason ?? "rejected_by_server",
        type: "string",
      };
      const user = useAuthStore.getState().currentUser;
      // Filed under the command, not the patient record: a notice keyed by
      // the record would hide a real sync conflict on it (one open review
      // entry per record) and would offer to write "server_command" onto
      // the record when resolved. This entry can only be reviewed and
      // dismissed; the command's handler already restored the record.
      await queueSyncConflicts(
        [
          {
            entityType: "server_command",
            entityId: command.id,
            localTimestamp: new Date(command.createdAt).toISOString(),
            remoteTimestamp: settled,
            conflicts: [field],
          },
        ],
        user ? { id: user.id, role: user.role } : undefined,
      );
    },
  };
}

/** Send this device's queued commands (db.serverCommands). */
export async function drainServerCommands(): Promise<DrainSummary | null> {
  if (!sb) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = (db as any).serverCommands;
  if (!table) return null;
  return drainCommands(asCommandStore(table), commandDeps());
}

/**
 * Records saved on this device that have not been uploaded yet (rows with
 * _dirty = 1 in every synced table) plus commands the server has not
 * answered yet. Safe to call inside a Dexie liveQuery.
 */
export async function countUnsyncedRecords(): Promise<number> {
  let total = 0;
  for (const t of tables) {
    if (PULL_ONLY.has(t)) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const table = (db as any)[localTableMap[t]];
    if (!table) continue;
    total += await table
      .where("_dirty")
      .equals(1)
      .count()
      .catch(() => 0);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const commands = (db as any).serverCommands;
  if (commands) {
    total += await countOpenCommands(asCommandStore(commands)).catch(() => 0);
  }
  return total;
}

/**
 * Records and commands the server refused for the person signed in online
 * (permission). They stay on this device, unsent, until someone allowed to
 * send them signs in online and syncs. Show them as "waiting for an
 * authorised person to sync". Included in countUnsyncedRecords(). Safe
 * inside a Dexie liveQuery.
 */
export async function countAwaitingAuthorisedSync(): Promise<number> {
  let total = await countBlockedIn(uploadLocalTables());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const commands = (db as any).serverCommands;
  if (commands) {
    total += await countWaitingPermission(asCommandStore(commands)).catch(() => 0);
  }
  return total;
}

// --- Cursor helpers (per-table) ---
const DEFAULT_TS = "1970-01-01T00:00:00.000Z";
const CURSOR_KEY = (t: Tbl) => `sync_cursor:${t}`;

async function getCursor(table: Tbl): Promise<string> {
  // settings store shape: { key: string, value: any }

  const row = await db.settings.get(CURSOR_KEY(table)).catch(() => undefined);
  const ts = row?.value?.ts ?? row?.ts ?? row?.value ?? undefined; // be liberal in what we accept
  // A cursor in the future may have skipped rows: download from the start.
  if (typeof ts === "string" && ts && !isCursorAhead(ts)) return ts;
  return DEFAULT_TS;
}

async function setCursor(table: Tbl, ts: string) {
  const iso = new Date(ts).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.settings.put({ key: CURSOR_KEY(table), value: iso as any });
}

// Detect conflicts by comparing local and remote versions
type ConflictDetectionResult = {
  hasConflict: boolean;
  /** The server answered and has no row with this id. */
  remoteMissing?: boolean;
  conflicts?: ConflictField[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  localData?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  remoteData?: any;
};

async function detectConflict(
  table: Tbl,
  id: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  localData: any,
): Promise<ConflictDetectionResult> {
  if (!sb) return { hasConflict: false };

  try {
    const { data: remoteData, error } = await sb
      .from(table)
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) return { hasConflict: false };
    if (!remoteData) return { hasConflict: false, remoteMissing: true };

    const remoteVersion = Number(remoteData.row_version);
    const localVersion = localData._serverVersion;
    const seenStamp = serverStampOf(localData._serverUpdatedAt);
    if (
      VERSIONED.has(table) &&
      Number.isFinite(remoteVersion) &&
      typeof localVersion === "number"
    ) {
      // The server has not changed the record since this device last saw
      // it: this device's edit is the only change. (Server version numbers,
      // not device clocks, so clock differences cannot fake a conflict.)
      if (remoteVersion === localVersion) return { hasConflict: false };
    } else if (comparesServerStamp(table) && seenStamp !== undefined) {
      // Same rule with the server's own updated_at as this device last saw
      // it: unchanged means this device's edit is the only change. Changed:
      // compare the fields below. (Server stamps on both sides, so a device
      // clock running behind or ahead cannot fake or hide a conflict.)
      if (serverUnchangedSince(remoteData.updated_at, seenStamp)) {
        return { hasConflict: false };
      }
    } else {
      // No server version or stamp seen yet (records from before the stamp
      // was kept, records not downloaded or read back since, queued
      // operations): compare with this device's clock.
      const localUpdated = new Date(
        localData.updatedAt || localData.updated_at,
      ).getTime();
      const remoteUpdated = new Date(remoteData.updated_at).getTime();

      // No conflict if local is newer or same timestamp
      if (localUpdated >= remoteUpdated) return { hasConflict: false };

      // Check if there's a synced timestamp and data hasn't changed since
      if (localData._syncedAt) {
        const syncedAt = new Date(localData._syncedAt).getTime();
        if (remoteUpdated <= syncedAt) return { hasConflict: false };
      }
    }

    // Detect field-level conflicts. Values are normalised first (Date vs
    // ISO string, null vs missing, JSON key order) so a different shape of
    // the same value is not reported as a conflict.
    const conflicts: ConflictField[] = findFieldConflicts(
      localData,
      remoteData,
      mapToDB[table],
    );

    if (conflicts.length === 0) return { hasConflict: false };

    return {
      hasConflict: true,
      conflicts,
      localData,
      remoteData,
    };
  } catch {
    return { hasConflict: false };
  }
}

/** Upload one row; retries once without foundation columns on an old server. */
async function upsertRow(
  t: Tbl,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  record: any,
): Promise<{ error: unknown; status?: number; serverVersion?: number }> {
  if (!sb) return { error: namedSyncError("SyncNotConfigured") };
  const payload = toDB(record, mapToDB[t]);
  if (t === "app_users" && !staffEditFromUsersScreen(record)) {
    // Role and admin access travel only with an edit made on the Users
    // screen; any other local change to a staff row uploads its name only.
    for (const column of STAFF_PRIVILEGE_COLUMNS) delete payload[column];
  }
  if (serverLacksFoundation) {
    for (const column of FOUNDATION_COLUMNS[t] ?? []) delete payload[column];
  }
  const options = { onConflict: "id", ignoreDuplicates: APPEND_ONLY.has(t) };
  const wantVersion = VERSIONED.has(t) && !serverLacksFoundation;

  const send = async (withVersion: boolean) => {
    const query = sb!.from(t).upsert(payload, options);
    if (!withVersion) {
      const { error, status } = await query;
      return { error, status, serverVersion: undefined as number | undefined };
    }
    const { data, error, status } = await query.select("id,row_version");
    const row = Array.isArray(data) ? data[0] : data;
    const version = Number((row as { row_version?: unknown } | null)?.row_version);
    return { error, status, serverVersion: Number.isFinite(version) ? version : undefined };
  };

  let result = await send(wantVersion);
  if (result.error && isMissingColumn(result.error) && !serverLacksFoundation) {
    // The server has not been migrated yet (row_version or the new queue
    // columns are missing): upload what it can take, and say so once.
    serverLacksFoundation = true;
    console.warn(`[sync] server is missing sync columns; uploading ${t} without them`);
    for (const column of FOUNDATION_COLUMNS[t] ?? []) delete payload[column];
    result = await send(false);
  }
  return result;
}

/** Rows per request when the server's updated_at is read back after uploads. */
const READ_BACK_CHUNK = 100;

/**
 * After uploads to `t`: read the server's updated_at of the uploaded rows
 * and keep it (_serverUpdatedAt) on each row the server still holds as this
 * device uploaded it, so the next edit is compared with the server's stamp,
 * not this device's clock. A separate read, not a reply to the upload: an
 * upload that returns rows needs read permission, and roles that may upload
 * but not read back would be refused. Best effort: a failed read fails
 * nothing. A row it did not stamp keeps none (the upload made the earlier
 * one stale): its next edit falls back to the clock check, as before stamps
 * were kept, instead of always being compared field by field with this
 * device's own upload.
 */
async function readBackServerStamps(
  t: Tbl,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  uploaded: Row[],
): Promise<void> {
  if (!sb || uploaded.length === 0) return;
  const byId = new Map(uploaded.map((record) => [String(record.id), record]));
  const ids = [...byId.keys()];
  const columns = [...new Set(["id", "updated_at", ...Object.values(mapToDB[t])])].join(",");
  for (let i = 0; i < ids.length; i += READ_BACK_CHUNK) {
    try {
      const { data, error } = await sb
        .from(t)
        .select(columns)
        .in("id", ids.slice(i, i + READ_BACK_CHUNK));
      if (error) {
        console.warn(`[sync] could not read back ${t} after upload`, syncErrorCode(error));
        return;
      }
      for (const serverRow of (data ?? []) as unknown as Row[]) {
        const record = byId.get(String(serverRow.id));
        if (!record) continue;
        // Another change reached the server in between: put back the stamp
        // the upload was checked against, so that change is still compared
        // at the next upload.
        const stamp =
          stampAfterUpload(record, serverRow, mapToDB[t]) ??
          serverStampOf(record._serverUpdatedAt);
        if (stamp === undefined) continue;
        await table.update(record.id, { _serverUpdatedAt: stamp }).catch(() => undefined);
      }
    } catch (error) {
      console.warn(`[sync] could not read back ${t} after upload`, syncErrorCode(error));
      return;
    }
  }
}

export interface PushSummary {
  conflicts: ConflictData[];
  /** Rows the server accepted. */
  uploaded: number;
  /**
   * Rows the server refused for the person signed in online (permission).
   * Kept on this device, unsent, waiting for an authorised person to sync;
   * not retried under the same sign-in for a while.
   */
  awaitingAuthorised: number;
  /** Other refusals (retried on the next sync). */
  failed: number;
}

export async function pushChanges(): Promise<PushSummary> {
  const summary: PushSummary = {
    conflicts: [],
    uploaded: 0,
    awaitingAuthorised: 0,
    failed: 0,
  };
  if (!sb) return summary;

  const cloud = await currentCloudUser();
  const now = Date.now();

  for (const t of tables) {
    if (PULL_ONLY.has(t)) continue;
    // Staff accounts: only someone who may manage them uploads them (the
    // server refuses anyone else).
    if (t === "app_users" && !mayUploadStaffAccounts()) continue;
    const localTable = localTableMap[t];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const table = (db as any)[localTable];
    if (!table || typeof table.where !== "function") continue;
    const dirty = await table
      .where("_dirty")
      .equals(1)
      .toArray()
      .catch((e: unknown) => {
        console.error(
          `[sync] failed to read dirty records for ${t}:`,
          syncErrorCode(e),
        );
        return [];
      });
    if (!dirty?.length) continue;
    const uploaded: Row[] = [];

    for (const record of dirty) {
      // Refused for this person recently: leave it for someone authorised.
      if (blockedFor(record, cloud?.id ?? null, now)) {
        summary.awaitingAuthorised += 1;
        continue;
      }

      // Check for conflicts before pushing (append-only rows cannot conflict)
      const conflictCheck: ConflictDetectionResult = APPEND_ONLY.has(t)
        ? { hasConflict: false }
        : await detectConflict(t, record.id, record);

      if (conflictCheck.hasConflict && conflictCheck.conflicts) {
        summary.conflicts.push({
          entityType: t,
          entityId: record.id,
          localTimestamp: record.updatedAt || new Date().toISOString(),
          remoteTimestamp: conflictCheck.remoteData.updated_at,
          conflicts: conflictCheck.conflicts,
        });
        continue; // Skip this record, needs manual resolution
      }

      // A patient this device has seen on the server (it holds a server
      // version) is no longer there: it was deleted on the server. Do not
      // create it again from this device's copy; it stays here, unsent.
      if (
        t === "patients" &&
        conflictCheck.remoteMissing === true &&
        typeof record._serverVersion === "number"
      ) {
        console.warn("[sync] a patient deleted on the server was not uploaded again");
        summary.failed += 1;
        continue;
      }

      // No conflict, proceed with push. Append-only rows: insert if absent,
      // so a retry after a lost reply succeeds without needing (or getting)
      // update rights on the server.
      const { error, status, serverVersion } = await upsertRow(t, record);

      if (!error) {
        // Mark it clean only if it was not edited during the upload; a
        // newer edit stays marked unsent (and safe from the download).
        const syncedAt = new Date().toISOString();
        await db.transaction("rw", table, async () => {
          const current = await table.get(record.id);
          await table.update(record.id, {
            ...markersAfterUpload(record, current, syncedAt),
            _syncBlock: undefined,
            ...(serverVersion !== undefined ? { _serverVersion: serverVersion } : {}),
            // This upload changed the server's updated_at, so the one seen
            // before it is stale; the read-back below records the new one.
            ...(comparesServerStamp(t) ? { _serverUpdatedAt: undefined } : {}),
          });
        });
        summary.uploaded += 1;
        uploaded.push(record);
      } else if (isPermissionRefusal(error, status)) {
        // Not this person's to upload (e.g. a nurse's vitals on a tablet
        // now signed in by a pharmacist). Keep it, unsent, for someone
        // authorised; do not retry it under this sign-in in a loop.
        await table
          .update(record.id, {
            _syncBlock: { reason: "permission", refusedFor: cloud?.id ?? "", at: now },
          })
          .catch(() => undefined);
        summary.awaitingAuthorised += 1;
        console.warn(`[sync] upload refused for ${t} (permission)`, syncErrorCode(error));
      } else {
        // The row stays marked unsent and is retried on the next sync.
        summary.failed += 1;
        console.warn(`[sync] upload refused for ${t}`, syncErrorCode(error));
      }
    }

    // The server's stamp of what was just uploaded (versioned tables got
    // their row_version with the upload itself).
    if (comparesServerStamp(t)) await readBackServerStamps(t, table, uploaded);
  }

  return summary;
}

export interface PullSummary {
  /** Downloaded rows written on this device. */
  applied: number;
  /**
   * Downloaded rows not written because this device has changes to them
   * that are not uploaded yet. The upload step compares those rows with the
   * server copy and raises a conflict when both sides changed. (Server-owned
   * fields of those rows, such as a merge link, are still updated.)
   */
  keptLocalEdits: number;
  /** Server tables whose download failed in this run. */
  failedTables: string[];
}

/** Write downloaded server rows for table `t` into `table` (one transaction). */
async function applyPulledRows(
  t: Tbl,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  rows: Row[],
  summary: { applied: number; keptLocalEdits: number },
  onRow?: (row: Row) => void,
): Promise<void> {
  const syncedAt = new Date().toISOString();
  const serverOwned = serverOwnedFor(t);
  const keepsStamp = !APPEND_ONLY.has(t) && !PULL_ONLY.has(t);
  // Read and write each row in one transaction so an edit saved on this
  // device between the read and the write cannot be overwritten.
  await db.transaction("rw", table, async () => {
    for (const row of rows) {
      onRow?.(row);
      const mapped = transformPulled(t, row, fromDB(row, mapFromDB[t]));
      const localRow = await table.get(mapped.id);
      // Rows with unsent changes are kept (only their server-owned fields
      // are updated); others get the server row laid over the local one,
      // so device-only fields survive (patient search keys, staff PIN
      // hashes). Only a row laid over takes the server's updated_at: a row
      // with unsent changes keeps the stamp its edit was made against, so
      // a change made meanwhile on another device is still found.
      const decision = mergePulledRow(
        localRow,
        mapped,
        { _dirty: 0, _syncedAt: syncedAt, ...(keepsStamp ? serverStampMarker(row) : {}) },
        { serverOwned, held: heldFor(t, localRow) },
      );
      if (decision.kind === "kept-local") {
        summary.keptLocalEdits += 1;
        continue;
      }
      await table.put(
        t === "app_users" ? keepLocalRevocation(localRow, decision.row) : decision.row,
      );
      if (decision.kind === "server-owned") summary.keptLocalEdits += 1;
      else summary.applied += 1;
    }
  });
}

export async function pullChanges(): Promise<PullSummary> {
  const summary: PullSummary = {
    applied: 0,
    keptLocalEdits: 0,
    failedTables: [],
  };
  if (!sb) return summary;
  for (const t of tables) {
    if (APPEND_ONLY.has(t)) continue; // upload-only audit tables
    const localTable = localTableMap[t];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const table = (db as any)[localTable];
    const since = await getCursor(t); // ALWAYS a valid ISO string
    // If it's the default, don't send a gt filter to avoid corner cases
    let q = sb.from(t).select("*");
    if (since !== DEFAULT_TS) q = q.gt("updated_at", since);

    // Oldest changes first: the cursor moves to the newest row of this page,
    // so a page cut off by the limit continues on the next sync instead of
    // skipping the rows it did not return.
    const { data, error } = await q
      .order("updated_at", { ascending: true })
      .limit(1000);
    if (error) {
      console.warn(`[sync] download failed for ${t}`, syncErrorCode(error));
      summary.failedTables.push(t);
      continue;
    }

    const rows = (data ?? []) as Row[];
    let maxTs = since;
    const now = Date.now();
    if (rows.length > 0) {
      await applyPulledRows(t, table, rows, summary, (row) => {
        // The cursor advances past every row, applied or kept local, but
        // not past this device's clock (see cursorGuard).
        maxTs = advanceCursor(maxTs, row.updated_at, now);
      });
    }
    await setCursor(t, maxTs);
  }
  return summary;
}

/**
 * Download specific server rows again and write them on this device, for
 * example to restore the server's values after a command was rejected.
 * `column` is this device's field name ("id", "patientId", ...). Rows with
 * unsent edits keep them; their server-owned fields are updated. Resolves to
 * the number of rows written. Throws an error carrying only a name when
 * sync is not set up, the device is offline or the request fails.
 */
export async function refetchRows(
  t: SyncTable,
  column: string,
  values: string[],
): Promise<number> {
  if (!sb) throw namedSyncError("SyncNotConfigured");
  if (!(tables as string[]).includes(t) || APPEND_ONLY.has(t)) {
    throw namedSyncError("UnknownRecordType");
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw namedSyncError("Offline");
  }
  const dbColumn = mapToDB[t][column] ?? pullOnlyMap[t]?.[column] ?? column;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const table = (db as any)[localTableMap[t]];
  if (!table) throw namedSyncError("UnknownRecordType");

  const unique = [...new Set(values.filter((v) => typeof v === "string" && v))];
  const summary = { applied: 0, keptLocalEdits: 0 };
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const { data, error } = await sb.from(t).select("*").in(dbColumn, chunk);
    if (error) {
      console.warn(`[sync] could not download ${t} again`, syncErrorCode(error));
      throw namedSyncError("RemoteReadFailed");
    }
    const rows = (data ?? []) as Row[];
    if (rows.length > 0) await applyPulledRows(t, table, rows, summary);
  }
  return summary.applied + summary.keptLocalEdits;
}

// Process operations queue and sync with conflict detection
export async function processOperationsQueue(): Promise<ConflictData[]> {
  const detectedConflicts: ConflictData[] = [];

  await processQueue(async (operation: PendingOperation) => {
    const table =
      operation.entity === "patient"
        ? "patients"
        : operation.entity === "visit"
          ? "visits"
          : operation.entity === "vital"
            ? "vitals"
            : operation.entity === "consultation"
              ? "consultations"
              : operation.entity === "dispense"
                ? "dispenses"
                : operation.entity === "inventory"
                  ? "inventory"
                  : operation.entity === "patient_allergy"
                    ? "patient_allergies"
                    : operation.entity === "patient_preference"
                      ? "patient_preferences"
                      : null;

    if (!table) throw new Error(`Unknown entity type: ${operation.entity}`);

    // Check for conflicts
    const conflictCheck = await detectConflict(
      table as Tbl,
      operation.entityId,
      operation.data,
    );

    if (conflictCheck.hasConflict && conflictCheck.conflicts) {
      detectedConflicts.push({
        entityType: table,
        entityId: operation.entityId,
        localTimestamp:
          (operation.data.updatedAt as string) || new Date().toISOString(),
        remoteTimestamp: conflictCheck.remoteData.updated_at,
        conflicts: conflictCheck.conflicts,
      });
      throw new Error("Conflict detected - needs resolution");
    }

    // Process operation based on type
    if (operation.type === "create" || operation.type === "update") {
      const payload = toDB(operation.data, mapToDB[table as Tbl]);
      const { error } = await sb!
        .from(table)
        .upsert(payload, { onConflict: "id" });
      if (error) throw error;

      // Mark as synced in local DB
      const localTable = localTableMap[table as Tbl];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any)[localTable].update(operation.entityId, {
        _dirty: 0,
        _syncedAt: new Date().toISOString(),
      });
    } else if (operation.type === "delete") {
      const { error } = await sb!
        .from(table)
        .delete()
        .eq("id", operation.entityId);
      if (error) throw error;
    }
  });

  return detectedConflicts;
}

let syncInProgress = false;

const SYNC_IN_PROGRESS = "Sync already in progress";

export interface SyncNowResult {
  success: boolean;
  conflicts: ConflictData[];
  error?: string;
  /** Server tables whose download failed in this run. */
  downloadFailedTables?: string[];
  /**
   * Downloaded rows not applied because this device has unsent changes to
   * them (kept until they upload or their conflict is resolved).
   */
  keptLocalEdits?: number;
  /**
   * Records the server refused for the person signed in online, kept on
   * this device for an authorised person to sync (see
   * countAwaitingAuthorisedSync for the running total, commands included).
   */
  awaitingAuthorised?: number;
  /** Uploads refused for other reasons (retried next sync). */
  uploadFailed?: number;
  /** What happened to queued server commands (null: none were sent). */
  commands?: DrainSummary | null;
  /** Sync participants that failed in this run (names). */
  participantFailures?: string[];
}

export async function syncNow(): Promise<SyncNowResult> {
  if (!isOnlineSyncEnabled()) return { success: false, conflicts: [] };
  // A PIN unlock after logout opens the local workspace only: never sync
  // (or show a sync error) without an online sign-in.
  if (!(await checkCloudSession())) {
    return { success: false, conflicts: [], error: NO_CLOUD_SESSION };
  }
  if (syncInProgress) {
    return { success: false, conflicts: [], error: SYNC_IN_PROGRESS };
  }

  syncInProgress = true;
  const syncStore = useSyncStore.getState();
  syncStore.setStatus("syncing");
  const participantFailures: string[] = [];

  try {
    // Server-authoritative commands first (portal access, merges, ...), so
    // the download below already reflects their outcome.
    let commands: DrainSummary | null = null;
    try {
      commands = await drainServerCommands();
    } catch (error) {
      console.warn("[sync] sending queued commands failed", syncErrorCode(error));
    }

    // Process operations queue
    const queueConflicts = await processOperationsQueue();

    await runParticipants("beforePush", participantFailures);

    // Then push remaining dirty records
    const pushed = await pushChanges();

    // Pull remote changes
    const pulled = await pullChanges();

    await runParticipants("afterPull", participantFailures);

    const allConflicts = [...queueConflicts, ...pushed.conflicts];

    syncStore.setLastSuccessAt(Date.now());
    syncStore.setStatus("ok");

    return {
      success: true,
      conflicts: allConflicts,
      downloadFailedTables: pulled.failedTables,
      keptLocalEdits: pulled.keptLocalEdits,
      awaitingAuthorised: pushed.awaitingAuthorised,
      uploadFailed: pushed.failed,
      commands,
      participantFailures,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed";
    syncStore.setLastErrorAt(Date.now(), message);
    syncStore.setStatus("error");
    return { success: false, conflicts: [], error: message };
  } finally {
    syncInProgress = false;
  }
}

export function isConfigured() {
  return !!sb;
}

/**
 * The server's current copy of one record (server column names), used to
 * resolve a sync conflict. Resolves to null when the server has no such
 * record. Throws an error that carries only a name when the copy cannot be
 * read: cloud sync not set up, unknown record type, offline, or the
 * request failed.
 */
export async function fetchRemoteRecord(
  entityType: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  if (!sb) throw namedSyncError("SyncNotConfigured");
  if (!(tables as string[]).includes(entityType)) {
    throw namedSyncError("UnknownRecordType");
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw namedSyncError("Offline");
  }
  const { data, error } = await sb
    .from(entityType)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.warn(
      `[sync] could not read the server copy from ${entityType}`,
      syncErrorCode(error),
    );
    throw namedSyncError("RemoteReadFailed");
  }
  return (data as Record<string, unknown> | null) ?? null;
}

/**
 * The server's current row_version of one record, for tables that carry
 * one (patients, queue). Used when a conflict is resolved on this device,
 * so the next upload is compared with the server copy the decision was
 * made against. Undefined when the table has no version, the record is not
 * on the server, or the server cannot be reached (the conflict is then
 * raised again at the next sync).
 */
export async function fetchServerVersion(
  entityType: string,
  id: string,
): Promise<number | undefined> {
  if (!sb || !VERSIONED.has(entityType as Tbl)) return undefined;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return undefined;
  }
  try {
    const { data, error } = await sb
      .from(entityType)
      .select("row_version")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return undefined;
    const raw = (data as { row_version?: unknown }).row_version;
    if (raw === null || raw === undefined || raw === "") return undefined;
    const version = Number(raw);
    return Number.isFinite(version) ? version : undefined;
  } catch {
    return undefined;
  }
}

// Auto-sync on network reconnection
if (typeof window !== "undefined") {
  window.addEventListener("online", async () => {
    const syncStore = useSyncStore.getState();
    if (syncStore.isOnline && isOnlineSyncEnabled()) {
      setTimeout(() => {
        syncNow()
          // No dialog on automatic runs: queue conflicts for review.
          .then((result) => queueSyncConflicts(result.conflicts))
          .catch((err) => {
            console.error(
              "Auto-sync on reconnection failed:",
              syncErrorCode(err),
            );
          });
      }, 2000); // Wait 2s for stable connection
    }
  });
}

// Background opportunistic push.
//
// Without this, dirty rows could sit on a tablet for hours before the user
// thinks to press "sync" — and if the tablet is lost or wiped before then,
// those rows are gone. The interval below pushes every dirty row at most
// BACKGROUND_SYNC_INTERVAL_MS old, even with no user action.
//
// Guard rails:
//   - skipped while a sync is already running (avoids overlap)
//   - skipped while offline (the network listener handles reconnects)
//   - consecutive failures back off exponentially up to 5 minutes
const BACKGROUND_SYNC_INTERVAL_MS = 60_000; // 60s opportunistic push
const BACKGROUND_SYNC_MAX_BACKOFF_MS = 5 * 60_000;

let backgroundSyncTimer: ReturnType<typeof setTimeout> | null = null;
let backgroundSyncFailures = 0;
let backgroundSyncActive = false;

function scheduleNextBackgroundSync(delayMs: number): void {
  if (typeof window === "undefined") return;
  if (!backgroundSyncActive) return; // stopped while a run was in flight
  if (backgroundSyncTimer) clearTimeout(backgroundSyncTimer);
  backgroundSyncTimer = setTimeout(runBackgroundSync, delayMs);
}

async function runBackgroundSync(): Promise<void> {
  try {
    if (!isOnlineSyncEnabled()) {
      backgroundSyncFailures = 0;
      scheduleNextBackgroundSync(BACKGROUND_SYNC_INTERVAL_MS);
      return;
    }
    const store = useSyncStore.getState();
    if (!store.isOnline) {
      // Network listener will resume on `online`.
      backgroundSyncFailures = 0;
      scheduleNextBackgroundSync(BACKGROUND_SYNC_INTERVAL_MS);
      return;
    }
    if (store.status === "syncing") {
      scheduleNextBackgroundSync(BACKGROUND_SYNC_INTERVAL_MS);
      return;
    }
    const result = await syncNow();
    // No dialog on background runs: queue conflicts for review so they are
    // not dropped. Records already queued are skipped.
    if (result.conflicts.length > 0) {
      await queueSyncConflicts(result.conflicts);
    }
    // syncNow reports failure in its result rather than throwing; count it
    // so repeated failures back off.
    if (!result.success && result.error !== SYNC_IN_PROGRESS && result.error !== NO_CLOUD_SESSION) {
      throw namedSyncError("BackgroundSyncFailed");
    }
    backgroundSyncFailures = 0;
    scheduleNextBackgroundSync(BACKGROUND_SYNC_INTERVAL_MS);
  } catch (err) {
    backgroundSyncFailures += 1;
    const backoff = Math.min(
      BACKGROUND_SYNC_INTERVAL_MS * 2 ** backgroundSyncFailures,
      BACKGROUND_SYNC_MAX_BACKOFF_MS,
    );
    console.warn(
      `[sync] background push failed (attempt ${backgroundSyncFailures}); retry in ${backoff}ms`,
      syncErrorCode(err),
    );
    scheduleNextBackgroundSync(backoff);
  }
}

// Kick off after a small startup delay so the rest of the app can finish
// mounting before we start hitting the network.
export function startBackgroundSync(): void {
  if (typeof window === "undefined") return;
  if (backgroundSyncActive) return; // already running
  backgroundSyncActive = true;
  backgroundSyncFailures = 0;
  scheduleNextBackgroundSync(5_000);
}

/** Stop background sync (for example on sign-out). Safe to call twice. */
export function stopBackgroundSync(): void {
  backgroundSyncActive = false;
  backgroundSyncFailures = 0;
  if (backgroundSyncTimer) clearTimeout(backgroundSyncTimer);
  backgroundSyncTimer = null;
}
