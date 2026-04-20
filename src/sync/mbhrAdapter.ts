// src/sync/mbhrAdapter.ts
import { db as mbhrDb } from "@/db/mbhr";

export const isOnlineSyncEnabled = () =>
  localStorage.getItem("mbhr-sync") === "on";
export const setOnlineSync = (on: boolean) =>
  localStorage.setItem("mbhr-sync", on ? "on" : "off");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabase: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const setSupabaseClient = (client: any) => {
  supabase = client;
};

async function pushTable<T extends { updatedAt?: string; createdAt?: string }>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  localTable: any,
  remoteName: string,
  mapToRemote: (x: T) => Record<string, unknown>,
) {
  const rows = await localTable.toArray();
  if (!rows.length) return;
  const { error } = await supabase
    .from(remoteName)
    .upsert(rows.map(mapToRemote), { onConflict: "id" });
  if (error) console.error(`[sync] push ${remoteName} failed`, error);
}

export async function syncNow() {
  if (!supabase) return console.log("[sync] supabase client not set — skipped");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await pushTable(mbhrDb.inventory_nm, "inventory_nm", (x: any) => ({
    id: x.id,
    item_name: x.itemName,
    unit: x.unit,
    on_hand_qty: x.onHandQty,
    reorder_threshold: x.reorderThreshold,
    min_qty: x.minQty ?? null,
    max_qty: x.maxQty ?? null,
    updated_at: x.updatedAt,
    site_id: x.siteId ?? null,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await pushTable(mbhrDb.stock_moves_nm, "stock_moves_nm", (x: any) => ({
    id: x.id,
    item_id: x.itemId,
    qty_delta: x.qtyDelta,
    reason: x.reason,
    actor_id: x.actorId ?? null,
    note: x.note ?? null,
    created_at: x.createdAt,
    approved_by: x.approvedBy ?? null,
    approved_at: x.approvedAt ?? null,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await pushTable(mbhrDb.alerts_nm, "alerts_nm", (x: any) => ({
    id: x.id,
    item_id: x.itemId,
    level: x.level,
    triggered_at: x.triggeredAt,
    cleared_at: x.clearedAt ?? null,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await pushTable(mbhrDb.restock_sessions, "restock_sessions", (x: any) => ({
    id: x.id,
    volunteer_id: x.volunteerId,
    started_at: x.startedAt,
    finished_at: x.finishedAt ?? null,
    deltas: x.deltas,
    tokens_earned: x.tokensEarned,
    committed: x.committed,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await pushTable(mbhrDb.gamification, "gamification", (x: any) => ({
    id: x.id,
    volunteer_id: x.volunteerId,
    tokens: x.tokens,
    badges: x.badges,
    updated_at: x.updatedAt,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await pushTable(mbhrDb.pharmacy_items, "pharmacy_items", (x: any) => ({
    id: x.id,
    med_name: x.medName,
    form: x.form,
    strength: x.strength,
    unit: x.unit,
    on_hand_qty: x.onHandQty,
    reorder_threshold: x.reorderThreshold,
    is_controlled: x.isControlled ?? false,
    updated_at: x.updatedAt,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await pushTable(mbhrDb.pharmacy_batches, "pharmacy_batches", (x: any) => ({
    id: x.id,
    item_id: x.itemId,
    lot_number: x.lotNumber,
    expiry_date: x.expiryDate,
    qty_on_hand: x.qtyOnHand,
    received_at: x.receivedAt,
    supplier: x.supplier ?? null,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await pushTable(mbhrDb.prescriptions, "prescriptions", (x: any) => ({
    id: x.id,
    visit_id: x.visitId,
    patient_id: x.patientId,
    prescriber_id: x.prescriberId,
    lines: x.lines,
    created_at: x.createdAt,
    status: x.status,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await pushTable(mbhrDb.dispenses, "dispenses", (x: any) => ({
    id: x.id,
    prescription_id: x.prescriptionId,
    patient_id: x.patientId,
    item_id: x.itemId,
    batch_id: x.batchId,
    qty: x.qty,
    dispensed_by: x.dispensedBy,
    dispensed_at: x.dispensedAt,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await pushTable(mbhrDb.stock_moves_rx, "stock_moves_rx", (x: any) => ({
    id: x.id,
    item_id: x.itemId,
    batch_id: x.batchId ?? null,
    qty_delta: x.qtyDelta,
    reason: x.reason,
    actor_id: x.actorId ?? null,
    created_at: x.createdAt,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await pushTable(mbhrDb.tickets, "tickets", (x: any) => ({
    id: x.id,
    number: x.number,
    patient_id: x.patientId ?? null,
    category: x.category,
    priority: x.priority,
    created_at: x.createdAt,
    site_id: x.siteId,
    state: x.state,
    current_stage: x.currentStage,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await pushTable(mbhrDb.stage_events, "stage_events", (x: any) => ({
    id: x.id,
    ticket_id: x.ticketId,
    stage: x.stage,
    started_at: x.startedAt ?? null,
    finished_at: x.finishedAt ?? null,
    actor_id: x.actorId ?? null,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await pushTable(mbhrDb.queue_metrics, "queue_metrics", (x: any) => ({
    id: x.id,
    stage: x.stage,
    avg_service_sec: x.avgServiceSec,
    updated_at: x.updatedAt,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await pushTable(mbhrDb.daily_counters, "daily_counters", (x: any) => ({
    id: x.id,
    site_id: x.siteId,
    date_str: x.dateStr,
    category: x.category,
    seq: x.seq,
  }));

  console.log("[sync] done");
}
