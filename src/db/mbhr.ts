// src/db/mbhr.ts
import Dexie, { Table } from "dexie";
import { ulid as _ulid } from "ulid";
import type { ServerCommand } from "@/db";

export interface Ticket {
  id: string;
  number: string;
  patientId?: string;
  category: "adult" | "child" | "antenatal" | string;
  priority: "urgent" | "normal" | "low" | string;
  createdAt: string;
  siteId: string;
  state: "waiting" | "in_progress" | "done" | "skipped";
  currentStage: "registration" | "vitals" | "consult" | "pharmacy" | string;
}

export interface InventoryNM {
  id: string;
  itemName: string;
  unit: string;
  onHandQty: number;
  reorderThreshold: number;
  minQty?: number;
  maxQty?: number;
  updatedAt: string;
  siteId?: string;
}

/**
 * Pharmacy stock (items and lots) follows a server ledger when cloud sync is
 * set up (supabase/migrations/20260925100400_pharmacy_stock_ledger.sql):
 *
 * - The server owns every balance. A device never uploads a quantity; it
 *   queues commands (receive, adjust, dispense) in rx_commands and records
 *   the matching change as a pending row in stock_movements.
 * - The quantity shown on this device is
 *     serverQtyOnHand (last downloaded) + pending local movements,
 *   recomputed after every download and every server answer.
 * - Stock with localOnly = 1 exists only on this device: it was recorded
 *   before the ledger existed (Dexie v4 upgrade) or while no server was set
 *   up. It is changed directly, as before, until a pharmacist uploads it as
 *   the site's opening stock or discards it for the server's stock
 *   (Pharmacy stock page).
 */
export interface PharmacyItem {
  id: string;
  medName: string;
  form: string;
  strength: string;
  unit: string;
  /** Shown quantity: serverQtyOnHand + pending movements (localOnly: the device's count). */
  onHandQty: number;
  reorderThreshold: number;
  isControlled?: boolean;
  updatedAt: string;
  /** Last balance downloaded from (or confirmed by) the server. */
  serverQtyOnHand?: number;
  /** Server row_version of that balance. */
  rowVersion?: number;
  /** 1: kept only on this device (see above). */
  localOnly?: 0 | 1;
  /** 1: waiting for the server to register this medicine. */
  pendingRegister?: 0 | 1;
  /** The server refused to register it (reason code). */
  registerRejected?: string;
  /** false: deactivated (kept for history; not offered for prescribing). */
  isActive?: boolean;
  siteKey?: string;
}

export interface PharmacyBatch {
  id: string;
  itemId: string;
  lotNumber: string;
  expiryDate: string;
  /** Shown quantity: serverQtyOnHand + pending movements (localOnly: the device's count). */
  qtyOnHand: number;
  receivedAt: string;
  supplier?: string;
  serverQtyOnHand?: number;
  rowVersion?: number;
  localOnly?: 0 | 1;
}

export interface Gamification {
  id: string;
  volunteerId: string;
  tokens: number;
  badges: string[];
  updatedAt: string;
}

export interface QueueMetric {
  id: string;
  stage: "registration" | "vitals" | "consult" | "pharmacy";
  avgServiceSec: number;
  updatedAt: string;
}

export interface DailyCounter {
  id: string;
  siteId: string;
  dateStr: string;
  category: string;
  seq: number;
}

export interface StockMoveNM {
  id: string;
  itemId: string;
  qtyDelta: number;
  reason: "restock" | "consume" | "adjust";
  actorId?: string;
  note?: string;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
}

export interface StockMoveRx {
  id: string;
  itemId: string;
  batchId?: string;
  qtyDelta: number;
  reason: "receipt" | "dispense" | "adjust";
  actorId?: string;
  createdAt: string;
}

export interface RestockSession {
  id: string;
  volunteerId: string;
  startedAt: string;
  finishedAt?: string;
  deltas: Array<{ itemId: string; qty: number }>;
  tokensEarned: number;
  committed: boolean;
}

export interface AlertNM {
  id: string;
  itemId: string;
  level: "low" | "critical";
  triggeredAt: string;
  clearedAt?: string;
}

export interface StageEvent {
  id: string;
  ticketId?: string;
  visitId?: string;
  patientId?: string;
  stage: string;
  startedAt?: string;
  finishedAt?: string;
  actorId?: string;
}

export interface Notification {
  id: string;
  ticketId: string;
  channel: string;
  payload: Record<string, unknown>;
  sentAt?: string;
  status: string;
}

export type PrescriptionStatus = "open" | "dispensed" | "partial" | "void";

export interface Prescription {
  id: string;
  visitId: string;
  patientId: string;
  prescriberId: string;
  createdAt: string;
  status: PrescriptionStatus;
  lines: Array<{
    itemId: string;
    dosage: string;
    frequency: string;
    durationDays: number;
    qty: number;
    notes?: string;
  }>;
  /** 1: not uploaded yet (new prescriptions are uploaded as written). */
  _dirty?: 0 | 1;
  _syncedAt?: string;
  /** 1: recorded before the server ledger; uploaded with the opening stock. */
  localOnly?: 0 | 1;
  rowVersion?: number;
  dispensedAt?: string;
  /** A dispense or void command the server has not answered yet. */
  pendingCommandId?: string;
  /** Why the server refused the last command (reason code). */
  lastRejectReason?: string;
  /** Units the server could not cover from stock (dispensed offline). */
  uncoveredQty?: number;
  /**
   * 1: the medicine was handed over (saved offline, or reported saved after
   * the confirm wait) but the server refused the dispense. The dispense
   * stays recorded on this device and is listed for reconciliation; the
   * prescription is not reopened.
   */
  handoverRefused?: 0 | 1;
}

export interface Dispense {
  id: string;
  prescriptionId: string;
  patientId: string;
  itemId: string;
  batchId: string;
  qty: number;
  dispensedBy: string;
  dispensedAt: string;
  /** The rx_dispense command that recorded it. */
  commandId?: string;
  /** 1: saved on this device, not yet confirmed by the server. */
  pending?: 0 | 1;
  /** 1: dispensed from stock kept only on this device. */
  localOnly?: 0 | 1;
}

/** One change to stock, as recorded in the server's append-only ledger. */
export type StockMovementReason =
  | "receipt"
  | "dispense"
  | "adjust"
  | "expire"
  | "reversal"
  | "opening_balance";

export interface StockMovement {
  id: string;
  itemId: string;
  batchId?: string;
  qtyDelta: number;
  reason: StockMovementReason;
  /** pending: saved on this device, waiting for the server; confirmed: downloaded. */
  status: "pending" | "confirmed";
  /** Command that carries a pending movement. */
  commandId?: string;
  prescriptionId?: string;
  dispenseId?: string;
  actorId?: string;
  /** Device clock when it happened. */
  occurredAt: string;
  /** Server time it was recorded (confirmed rows). */
  recordedAt?: string;
}

/** Units dispensed offline that the server's stock could not cover. */
export interface StockDiscrepancy {
  id: string;
  itemId: string;
  batchId?: string;
  qtyUncovered: number;
  prescriptionId?: string;
  dispenseId?: string;
  status: "open" | "resolved";
  createdAt: string;
  updatedAt?: string;
}

/** Download cursor per server table (pharmacy sync). */
export interface PharmacySyncCursor {
  id: string;
  ts: string;
}
class MBHRDB extends Dexie {
  tickets!: Table<Ticket, string>;
  inventory_nm!: Table<InventoryNM, string>;
  pharmacy_items!: Table<PharmacyItem, string>;
  pharmacy_batches!: Table<PharmacyBatch, string>;
  gamification!: Table<Gamification, string>;
  queue_metrics!: Table<QueueMetric, string>;
  daily_counters!: Table<DailyCounter, string>;
  stock_moves_nm!: Table<StockMoveNM, string>;
  stock_moves_rx!: Table<StockMoveRx, string>;
  prescriptions!: Table<Prescription, string>;
  dispenses!: Table<Dispense, string>;
  restock_sessions!: Table<RestockSession, string>;
  alerts_nm!: Table<AlertNM, string>;
  stage_events!: Table<StageEvent, string>;
  notifications!: Table<Notification, string>;
  /** Pharmacy command outbox (ServerCommand shape, src/sync/commandOutbox.ts). */
  rx_commands!: Table<ServerCommand, string>;
  stock_movements!: Table<StockMovement, string>;
  stock_discrepancies!: Table<StockDiscrepancy, string>;
  rx_cursors!: Table<PharmacySyncCursor, string>;

  constructor() {
    super("mbhr");
    this.version(1).stores({
      tickets: "id, number, currentStage, state, createdAt",
      inventory_nm: "id, itemName, updatedAt, reorderThreshold",
      pharmacy_items: "id, medName, updatedAt",
      pharmacy_batches: "id, itemId, expiryDate",
      gamification: "id, volunteerId, updatedAt",
      queue_metrics: "id, stage, updatedAt",
      daily_counters: "id, siteId, dateStr, category",
      stock_moves_nm: "id, itemId, createdAt",
      stock_moves_rx: "id, itemId, batchId, createdAt",
      prescriptions: "id, patientId, status, createdAt",
      dispenses: "id, prescriptionId, patientId, dispensedAt",
    });
    this.version(2).stores({
      tickets: "id, number, currentStage, state, createdAt",
      inventory_nm: "id, itemName, updatedAt, reorderThreshold",
      pharmacy_items: "id, medName, updatedAt",
      pharmacy_batches: "id, itemId, expiryDate",
      gamification: "id, volunteerId, updatedAt",
      queue_metrics: "id, stage, updatedAt",
      daily_counters: "id, siteId, dateStr, category",
      stock_moves_nm: "id, itemId, createdAt",
      stock_moves_rx: "id, itemId, batchId, createdAt",
      prescriptions: "id, patientId, status, createdAt",
      dispenses: "id, prescriptionId, patientId, dispensedAt",
      restock_sessions: "id, volunteerId, startedAt",
      alerts_nm: "id, itemId, triggeredAt",
      stage_events: "id, ticketId, stage",
      notifications: "id, ticketId, status",
    });
    // v3 — stage_events gains visitId/patientId/actorId/startedAt indexes so
    // form submits (vitals, consult, dispense) can record handoffs alongside
    // queue ticket transitions, and the outreach report can filter by date.
    this.version(3).stores({
      tickets: "id, number, currentStage, state, createdAt",
      inventory_nm: "id, itemName, updatedAt, reorderThreshold",
      pharmacy_items: "id, medName, updatedAt",
      pharmacy_batches: "id, itemId, expiryDate",
      gamification: "id, volunteerId, updatedAt",
      queue_metrics: "id, stage, updatedAt",
      daily_counters: "id, siteId, dateStr, category",
      stock_moves_nm: "id, itemId, createdAt",
      stock_moves_rx: "id, itemId, batchId, createdAt",
      prescriptions: "id, patientId, status, createdAt",
      dispenses: "id, prescriptionId, patientId, dispensedAt",
      restock_sessions: "id, volunteerId, startedAt",
      alerts_nm: "id, itemId, triggeredAt",
      stage_events:
        "id, ticketId, visitId, patientId, stage, actorId, startedAt, finishedAt",
      notifications: "id, ticketId, status",
    });
    // v4 — pharmacy stock follows the server ledger (see PharmacyItem).
    // Everything recorded before this version exists only on this device,
    // so it is marked localOnly and never uploaded automatically: two
    // devices holding copies of the same stock would otherwise both upload
    // it and double the count. A pharmacist uploads one device's stock per
    // site as opening stock (Pharmacy stock page).
    this.version(4)
      .stores({
        tickets: "id, number, currentStage, state, createdAt",
        inventory_nm: "id, itemName, updatedAt, reorderThreshold",
        pharmacy_items: "id, medName, updatedAt, localOnly, pendingRegister",
        pharmacy_batches: "id, itemId, expiryDate, localOnly",
        gamification: "id, volunteerId, updatedAt",
        queue_metrics: "id, stage, updatedAt",
        daily_counters: "id, siteId, dateStr, category",
        stock_moves_nm: "id, itemId, createdAt",
        stock_moves_rx: "id, itemId, batchId, createdAt",
        prescriptions:
          "id, patientId, status, createdAt, _dirty, _syncedAt, localOnly, pendingCommandId",
        dispenses: "id, prescriptionId, patientId, dispensedAt, commandId, localOnly",
        restock_sessions: "id, volunteerId, startedAt",
        alerts_nm: "id, itemId, triggeredAt",
        stage_events:
          "id, ticketId, visitId, patientId, stage, actorId, startedAt, finishedAt",
        notifications: "id, ticketId, status",
        rx_commands: "id, status, rpc, authorId, createdAt",
        stock_movements: "id, itemId, batchId, recordedAt, commandId, status",
        stock_discrepancies: "id, itemId, status",
        rx_cursors: "id",
      })
      .upgrade(async (tx) => {
        await tx.table("pharmacy_items").toCollection().modify({ localOnly: 1 });
        await tx.table("pharmacy_batches").toCollection().modify({ localOnly: 1 });
        await tx.table("prescriptions").toCollection().modify({ localOnly: 1 });
        await tx.table("dispenses").toCollection().modify({ localOnly: 1 });
      });
  }
}

export const db = new MBHRDB();

// small helper passthrough so other files can do `import { ulid } from '@/db/mbhr'`
export const ulid = () => _ulid();

// ✅ add alias export so `import { mbhrDb } ...` works
export const mbhrDb = db;
export default db;
