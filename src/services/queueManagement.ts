import {
  db,
  QueueItem,
  Patient,
  generateId,
  epochDay,
  type QueueTransition,
} from "@/db";
import { supabase } from "@/lib/supabase";
import logger from "@/lib/logger";
import { isRealtimeAvailable } from "@/lib/realtimeAvailable";
import {
  addTransition,
  buildTransition,
  currentQueueActor,
  getDeviceId,
  SYSTEM_ACTOR,
  type QueueActor,
  type TransitionInput,
} from "./queueAudit";
import {
  insertionPosition,
  isDowngrade,
  isEscalation,
  MAX_REASON_LENGTH,
  mayDowngradePriority,
  mayMoveQueue,
  normalisePriority,
  normaliseReason,
  orderAfterInsert,
  promotionPosition,
  type QueuePriority,
} from "./queuePriority";
import { findTodaysTicket, type QueueRow, type TicketAssignment } from "./queueTickets";
import { canonicalPatientId } from "./patientMerge";
import {
  currentTicketContext,
  issueTicketLocal,
  prepareTicketNumbers,
  type TicketContext,
} from "./queueTicketStore";
// Registers the queue-ticket sync participant (server-confirmed ticket
// numbers, number blocks, transition-driven status) wherever the queue is
// used.
import "@/sync/queueSync";

export type QueueStage = "registration" | "vitals" | "consult" | "pharmacy";
export type QueueStatus = "waiting" | "in_progress" | "done";
export type { QueuePriority } from "./queuePriority";
export type { QueueActor } from "./queueAudit";

/** The signed-in role may not make this queue change. Nothing was saved. */
export class QueuePermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueuePermissionError";
  }
}

/** The change is not valid (e.g. missing reason). Nothing was saved. */
export class QueueValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueueValidationError";
  }
}

interface QueueStats {
  stage: QueueStage;
  waiting: number;
  inProgress: number;
  done: number;
  /**
   * Average minutes from joining this stage's queue to finishing it, for
   * tickets finished today that have a queued time. 0 when there are none.
   */
  averageWaitTime: number;
}

interface QueueConfig {
  enablePriority: boolean;
  urgentThreshold: number; // minutes before urgent patients skip queue
  maxWaitTime: number; // minutes before automatic escalation
}

const DEFAULT_CONFIG: QueueConfig = {
  enablePriority: true,
  urgentThreshold: 5,
  maxWaitTime: 60,
};

export interface DowngradePriorityInput {
  newPriority: QueuePriority;
  reason: string;
  /** The clinician making the change. Must hold the consult permission. */
  user: QueueActor;
}

export interface EscalatePriorityInput {
  /** Defaults to the signed-in staff member. */
  user?: QueueActor;
  reason?: string;
}

export class QueueManagement {
  private config: QueueConfig;
  private subscribers: Map<string, (update: QueueItem[]) => void> = new Map();

  constructor(config: Partial<QueueConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── write path helpers ──────────────────────────────────────────────────

  /**
   * Runs a queue change and its audit rows in one Dexie transaction, so a
   * change is never saved without its audit row (or the other way round).
   */
  private tx<T>(fn: () => Promise<T>): Promise<T> {
    return db.transaction(
      "rw",
      [
        db.queue,
        db.queueTransitions,
        db.settings,
        db.patients,
        db.visits,
        db.ticketLeases,
      ],
      fn,
    );
  }

  private resolveActor(actor?: QueueActor): QueueActor {
    const who = actor ?? currentQueueActor();
    if (!who) {
      throw new QueuePermissionError("Sign in to change the queue.");
    }
    return who;
  }

  private assertMayMove(actor: QueueActor, stage: QueueStage): void {
    if (actor.id === SYSTEM_ACTOR.id && actor.role === SYSTEM_ACTOR.role) return;
    if (!mayMoveQueue(actor.role, stage)) {
      throw new QueuePermissionError(
        "Your role cannot call or move patients in the queue.",
      );
    }
  }

  private async audit(
    input: TransitionInput,
    actor: QueueActor,
    deviceId: string,
    at: Date,
  ): Promise<QueueTransition> {
    const row = buildTransition(input, actor, deviceId, at);
    await addTransition(row);
    return row;
  }

  private async waitingAt(stage: QueueStage): Promise<QueueItem[]> {
    return db.queue
      .where("stage")
      .equals(stage)
      .and((item) => item.status === "waiting")
      .toArray();
  }

  /** Writes positions 1..n in the given id order, touching only rows that change. */
  private async applyOrder(
    order: string[],
    rows: Array<Pick<QueueItem, "id" | "position">>,
  ): Promise<void> {
    const current = new Map(rows.map((r) => [r.id, r.position]));
    for (let i = 0; i < order.length; i++) {
      if (current.get(order[i]) !== i + 1) {
        await db.queue.update(order[i], {
          position: i + 1,
          updatedAt: new Date(),
          _dirty: 1,
        });
      }
    }
  }

  /**
   * Site, Lagos service day and ticket numbers for a change that may add a
   * ticket. Runs before the transaction: it reads the active site (not in
   * the transaction's tables) and, online, may reserve a block of numbers.
   */
  private async ticketContext(deviceId: string, now: Date): Promise<TicketContext> {
    const ctx = await currentTicketContext(now);
    await prepareTicketNumbers(ctx, deviceId);
    return ctx;
  }

  /**
   * The patient's ticket for this site and day, or a new one. Must run
   * inside tx().
   */
  private async ticketFor(
    patientId: string,
    ctx: TicketContext,
    deviceId: string,
  ): Promise<{ ticket: TicketAssignment; reused: boolean }> {
    const rows = (await db.queue
      .where("patientId")
      .equals(patientId)
      .toArray()) as QueueRow[];
    const existing = findTodaysTicket(rows, patientId, ctx.siteKey, ctx.serviceDate);
    if (existing) {
      // Rows from older app versions have a number but no ticket id: give
      // them one, keep the number the patient was given, and let the
      // server confirm it.
      const legacy = !existing.ticketId;
      return {
        reused: true,
        ticket: {
          ticketId: existing.ticketId ?? generateId(),
          ticketNumber: existing.ticketNumber,
          ticketProvisional: legacy && ctx.syncEnabled ? 1 : (existing.ticketProvisional ?? 0),
          ticketPending: legacy ? (ctx.syncEnabled ? 1 : 0) : (existing.ticketPending ?? 0),
          siteKey: ctx.siteKey,
          serviceDate: ctx.serviceDate,
        },
      };
    }
    return { reused: false, ticket: await issueTicketLocal(ctx, deviceId) };
  }

  /**
   * The record a new queue entry goes on. A record merged into another on
   * this device is queued on the kept record (the server moves late queue
   * rows there too). Falls back to the given id when the kept record is not
   * on this device.
   */
  private async keptRecordId(patientId: string): Promise<string> {
    const keptId = await canonicalPatientId(patientId);
    if (keptId === patientId) return patientId;
    return (await db.patients.get(keptId)) ? keptId : patientId;
  }

  /**
   * The patient's open queue entry. After a merge on this device the entry
   * is on the kept record, so the merged record's id still finds it. Must
   * run inside tx().
   */
  private async openItemFor(patientId: string): Promise<QueueItem | undefined> {
    const open = (id: string) =>
      db.queue
        .where("patientId")
        .equals(id)
        .and((item) => item.status !== "done")
        .first();
    const item = await open(patientId);
    if (item) return item;
    const keptId = await canonicalPatientId(patientId);
    return keptId === patientId ? undefined : open(keptId);
  }

  /** Throws when the patient already has an open queue entry. Must run inside tx(). */
  private async assertNotQueued(patientId: string): Promise<void> {
    const existing = await db.queue
      .where("patientId")
      .equals(patientId)
      .and((item) => item.status !== "done")
      .first();

    if (existing) {
      logger.warn(
        `Patient ${patientId} already in queue at stage ${existing.stage}`,
      );
      throw new Error(`Patient is already in queue at ${existing.stage} stage`);
    }
  }

  /**
   * Adds a waiting ticket at a stage. Must run inside tx(). Does not audit:
   * the caller records the transition (enqueue, requeue or send_on).
   */
  private async enqueue(
    patientId: string,
    stage: QueueStage,
    priority: QueuePriority,
    createdBy: string | undefined,
    now: Date,
    ctx: TicketContext,
    deviceId: string,
  ): Promise<{ item: QueueItem; reusedTicket: boolean }> {
    // Check if patient already in queue
    await this.assertNotQueued(patientId);

    // Urgent tickets go ahead of every non-urgent waiting ticket (after
    // urgent ones already ahead); others join the end of the line.
    const waiting = await this.waitingAt(stage);
    const position = insertionPosition(waiting, priority);

    // Reuse the patient's ticket for this site and (Lagos) day, e.g. when
    // they move from vitals to consult. Otherwise issue a new one so desks
    // can call patients by a short label.
    const { ticket, reused: reusedTicket } = await this.ticketFor(patientId, ctx, deviceId);

    const queueItem: QueueRow = {
      id: generateId(),
      patientId,
      stage,
      position,
      status: "waiting",
      priority,
      createdBy,
      ticketId: ticket.ticketId,
      ticketNumber: ticket.ticketNumber,
      ticketProvisional: ticket.ticketProvisional,
      ticketPending: ticket.ticketPending,
      siteKey: ticket.siteKey,
      serviceDate: ticket.serviceDate,
      queuedAt: now,
      updatedAt: now,
      _dirty: 1,
    };

    await db.queue.add(queueItem);

    // Shift everyone at or after the new ticket back by one.
    await this.applyOrder(orderAfterInsert(waiting, queueItem.id, position), [
      ...waiting,
      queueItem,
    ]);

    return { item: queueItem, reusedTicket };
  }

  // ── public write API (every change is audited) ──────────────────────────

  async addToQueue(
    patientId: string,
    stage: QueueStage,
    priority: QueuePriority = "normal",
    createdBy?: string,
    actor?: QueueActor,
  ): Promise<QueueItem> {
    const who = this.resolveActor(actor);
    this.assertMayMove(who, stage);
    const deviceId = await getDeviceId();
    const now = new Date();
    const ctx = await this.ticketContext(deviceId, now);
    // Resolved just before the write: a merged record's patient is queued
    // on the kept record, so they hold one ticket.
    const queuedId = await this.keptRecordId(patientId);

    const queueItem = await this.tx(async () => {
      // Validate patient exists
      const patient = await db.patients.get(queuedId);
      if (!patient) {
        throw new Error(`Patient ${queuedId} not found`);
      }
      // An entry not yet moved from the merged record still counts.
      if (queuedId !== patientId) await this.assertNotQueued(patientId);

      const { item, reusedTicket } = await this.enqueue(
        queuedId,
        stage,
        priority,
        createdBy,
        now,
        ctx,
        deviceId,
      );
      await this.audit(
        {
          queueItemId: item.id,
          patientId: queuedId,
          kind: reusedTicket ? "requeue" : "enqueue",
          fromStage: null,
          toStage: stage,
          fromStatus: null,
          toStatus: "waiting",
          toPriority: priority,
        },
        who,
        deviceId,
        now,
      );
      return item;
    });

    // Notify subscribers
    this.notifySubscribers(stage);

    logger.log(
      `Added patient ${queuedId} to ${stage} queue at position ${queueItem.position} with priority ${priority}`,
    );
    return queueItem;
  }

  /**
   * Finishes the patient's current stage and sends them to the next one, or
   * after pharmacy ends the visit. The patient's triage priority is carried
   * to the next stage: urgent status never drops because they moved on.
   */
  async moveToNextStage(patientId: string, actor?: QueueActor): Promise<void> {
    const who = this.resolveActor(actor);
    const deviceId = await getDeviceId();
    const now = new Date();
    const ctx = await this.ticketContext(deviceId, now);

    const { from, nextStage } = await this.tx(async () => {
      const currentItem = await this.openItemFor(patientId);

      if (!currentItem) {
        throw new Error(`Patient ${patientId} not found in queue`);
      }
      this.assertMayMove(who, currentItem.stage);
      // The next stage goes on the entry's own record, so the ticket
      // follows it. That is the given record unless it was merged into
      // another on this device.
      const owner = currentItem.patientId || patientId;

      // Mark current stage as done
      await db.queue.update(currentItem.id, {
        status: "done",
        updatedAt: now,
        _dirty: 1,
        transitionPending: 1,
      });

      const next = this.getNextStage(currentItem.stage);
      const carried = normalisePriority(currentItem.priority);
      let nextItem: QueueItem | undefined;

      if (next) {
        nextItem = (
          await this.enqueue(owner, next, carried, undefined, now, ctx, deviceId)
        ).item;
      } else {
        // Pharmacy was the last stage: the patient has left the flow, so
        // their open visit ends here. Without this, visits stayed open for
        // ever and a returning patient's new care was filed under an old visit.
        try {
          for (const id of new Set([patientId, owner])) {
            const open = await db.visits
              .where("patientId")
              .equals(id)
              .and((v) => v.status === "open")
              .toArray();
            for (const v of open) {
              await db.visits.update(v.id, { status: "closed", _dirty: 1 });
            }
          }
        } catch (err) {
          logger.warn(
            "Could not close visit after pharmacy:",
            err instanceof Error ? err.name : err,
          );
        }
      }

      await this.audit(
        {
          queueItemId: currentItem.id,
          toQueueItemId: nextItem?.id,
          patientId: owner,
          kind: "send_on",
          fromStage: currentItem.stage,
          toStage: next ?? "done",
          fromStatus: currentItem.status,
          // toStatus describes queueItemId (the row just finished), which
          // the server applies. The next stage's row travels as its own
          // queue upload, referenced by toQueueItemId.
          toStatus: "done",
          fromPriority: carried,
          toPriority: carried,
        },
        who,
        deviceId,
        now,
      );

      // Reorder current stage
      await this.reorderQueue(currentItem.stage);
      return { from: currentItem.stage, nextStage: next };
    });

    // Notify both stages
    this.notifySubscribers(from);
    if (nextStage) {
      this.notifySubscribers(nextStage);
    }
  }

  private getNextStage(currentStage: QueueStage): QueueStage | null {
    const stages: QueueStage[] = [
      "registration",
      "vitals",
      "consult",
      "pharmacy",
    ];
    const currentIndex = stages.indexOf(currentStage);

    if (currentIndex === -1 || currentIndex === stages.length - 1) {
      return null;
    }

    return stages[currentIndex + 1];
  }

  /** Calls a ticket: waiting → in service. */
  async startService(
    queueItemId: string,
    assignee?: { id: string; name: string },
    actor?: QueueActor,
  ): Promise<void> {
    const who = this.resolveActor(actor);
    const deviceId = await getDeviceId();
    const now = new Date();

    const stage = await this.tx(async () => {
      const item = await db.queue.get(queueItemId);
      if (!item) return null;
      this.assertMayMove(who, item.stage);

      await db.queue.update(queueItemId, {
        status: "in_progress",
        updatedAt: now,
        _dirty: 1,
        transitionPending: 1,
        ...(assignee
          ? { assignedTo: assignee.id, assignedName: assignee.name }
          : {}),
      });
      const priority = normalisePriority(item.priority);
      await this.audit(
        {
          queueItemId,
          patientId: item.patientId,
          kind: "call",
          fromStage: item.stage,
          toStage: item.stage,
          fromStatus: item.status,
          toStatus: "in_progress",
          fromPriority: priority,
          toPriority: priority,
        },
        who,
        deviceId,
        now,
      );
      return item.stage;
    });

    if (stage) {
      this.notifySubscribers(stage);
    }
  }

  /** Ends the ticket at its current stage without sending it on. */
  async completeService(queueItemId: string, actor?: QueueActor): Promise<void> {
    const who = this.resolveActor(actor);
    const deviceId = await getDeviceId();
    const now = new Date();

    const stage = await this.tx(async () => {
      const item = await db.queue.get(queueItemId);
      if (!item) return null;
      this.assertMayMove(who, item.stage);

      await db.queue.update(queueItemId, {
        status: "done",
        updatedAt: now,
        _dirty: 1,
        transitionPending: 1,
      });
      const priority = normalisePriority(item.priority);
      await this.audit(
        {
          queueItemId,
          patientId: item.patientId,
          kind: "end_here",
          fromStage: item.stage,
          toStage: "done",
          fromStatus: item.status,
          toStatus: "done",
          fromPriority: priority,
          toPriority: priority,
        },
        who,
        deviceId,
        now,
      );

      await this.reorderQueue(item.stage);
      return item.stage;
    });

    if (stage) this.notifySubscribers(stage);
  }

  /**
   * "Move to front": moves a waiting ticket ahead of every waiting ticket of
   * the same or lower priority. It never passes a ticket with a higher
   * priority, so a normal or low ticket always stays behind waiting urgent
   * ones (see promotionPosition). Throws QueueValidationError when the
   * ticket is already as far forward as its priority allows.
   */
  async skipQueue(
    patientId: string,
    reason: string = "urgent",
    actor?: QueueActor,
  ): Promise<void> {
    const who = this.resolveActor(actor);
    const stage = await this.promote(patientId, reason, who, false);
    if (!stage) return;
    this.notifySubscribers(stage);
    logger.log(`Patient ${patientId} moved forward in the ${stage} queue`);
  }

  /**
   * Moves the patient's waiting ticket forward within its priority and
   * audits it. Resolves to the stage, or null when there was nothing to
   * move and `quiet` is set (then nothing is written).
   */
  private async promote(
    patientId: string,
    reason: string,
    who: QueueActor,
    quiet: boolean,
  ): Promise<QueueStage | null> {
    const deviceId = await getDeviceId();
    const now = new Date();

    return this.tx(async () => {
      const item = await db.queue
        .where("patientId")
        .equals(patientId)
        .and((i) => i.status === "waiting")
        .first();

      if (!item) {
        if (quiet) return null;
        throw new Error(`Patient ${patientId} not found in waiting queue`);
      }
      this.assertMayMove(who, item.stage);

      const waiting = await this.waitingAt(item.stage);
      const line = waiting.some((w) => w.id === item.id) ? waiting : [...waiting, item];
      const target = promotionPosition(line, item.id);
      const priority = normalisePriority(item.priority);
      if (target === null) {
        if (quiet) return null;
        throw new QueueValidationError(
          priority === "urgent"
            ? "This ticket is already at the front of the line."
            : "This ticket is already as far forward as it can go. Waiting urgent tickets stay ahead of it.",
        );
      }

      // Everyone else keeps their order around it.
      const others = line.filter((w) => w.id !== item.id);
      await this.applyOrder(orderAfterInsert(others, item.id, target), line);

      await this.audit(
        {
          queueItemId: item.id,
          patientId,
          kind: "prioritise",
          fromStage: item.stage,
          toStage: item.stage,
          fromStatus: item.status,
          toStatus: item.status,
          fromPriority: priority,
          toPriority: priority,
          reason: normaliseReason(reason).slice(0, MAX_REASON_LENGTH) || undefined,
        },
        who,
        deviceId,
        now,
      );
      return item.stage;
    });
  }

  /**
   * Raises the patient's triage priority to urgent. Available to queue
   * staff. A waiting ticket moves ahead of every non-urgent waiting ticket.
   */
  async escalatePriority(
    patientId: string,
    input: EscalatePriorityInput = {},
  ): Promise<void> {
    const who = this.resolveActor(input.user);
    const deviceId = await getDeviceId();
    const now = new Date();

    const stage = await this.tx(async () => {
      const item = await db.queue
        .where("patientId")
        .equals(patientId)
        .and((i) => i.status !== "done")
        .first();
      if (!item) {
        throw new Error(`Patient ${patientId} not found in queue`);
      }
      this.assertMayMove(who, item.stage);

      const from = normalisePriority(item.priority);
      if (!isEscalation(from, "urgent")) {
        throw new QueueValidationError("This patient is already marked urgent.");
      }

      await db.queue.update(item.id, {
        priority: "urgent",
        updatedAt: now,
        _dirty: 1,
      });

      if (item.status === "waiting") {
        const others = (await this.waitingAt(item.stage)).filter(
          (w) => w.id !== item.id,
        );
        const position = insertionPosition(others, "urgent");
        await this.applyOrder(orderAfterInsert(others, item.id, position), [
          ...others,
          item,
        ]);
      }

      await this.audit(
        {
          queueItemId: item.id,
          patientId,
          kind: "priority_escalate",
          fromStage: item.stage,
          toStage: item.stage,
          fromStatus: item.status,
          toStatus: item.status,
          fromPriority: from,
          toPriority: "urgent",
          reason: normaliseReason(input.reason).slice(0, MAX_REASON_LENGTH) || undefined,
        },
        who,
        deviceId,
        now,
      );
      return item.stage;
    });

    this.notifySubscribers(stage);
  }

  /**
   * Lowers the patient's triage priority. Only an authorised clinician
   * (consult permission) may do this, and only with a reason. The change is
   * recorded as a "priority_downgrade" audit row: who, when, from, to, why.
   * The ticket keeps its place in line.
   */
  async downgradePriority(
    patientId: string,
    input: DowngradePriorityInput,
  ): Promise<void> {
    const given = input?.user;
    if (!given || !given.id) {
      throw new QueuePermissionError("Sign in to change triage priority.");
    }
    // The clinician must be the person signed in on this device, and the
    // role checked is the signed-in role, not one supplied by the caller.
    const signedIn = currentQueueActor();
    if (!signedIn || signedIn.id !== given.id) {
      throw new QueuePermissionError(
        "Sign in as the clinician lowering the priority.",
      );
    }
    const who: QueueActor = { ...given, role: signedIn.role };
    if (!mayDowngradePriority(who.role)) {
      throw new QueuePermissionError(
        "Only a clinician with consultation access can lower triage priority.",
      );
    }
    const reason = normaliseReason(input.reason);
    if (!reason) {
      throw new QueueValidationError("Give a reason for lowering the priority.");
    }
    if (reason.length > MAX_REASON_LENGTH) {
      throw new QueueValidationError(
        `Keep the reason under ${MAX_REASON_LENGTH} characters.`,
      );
    }
    const to = normalisePriority(input.newPriority);
    const deviceId = await getDeviceId();
    const now = new Date();

    const stage = await this.tx(async () => {
      const item = await db.queue
        .where("patientId")
        .equals(patientId)
        .and((i) => i.status !== "done")
        .first();
      if (!item) {
        throw new Error(`Patient ${patientId} not found in queue`);
      }
      const from = normalisePriority(item.priority);
      if (!isDowngrade(from, to)) {
        throw new QueueValidationError(
          "The new priority must be lower than the current one.",
        );
      }

      // The server applies a downgrade only through its audited transition
      // (an upload alone cannot lower an urgent priority), so keep the new
      // priority on this device until that transition has been sent.
      await db.queue.update(item.id, {
        priority: to,
        updatedAt: now,
        _dirty: 1,
        transitionPending: 1,
      });
      await this.audit(
        {
          queueItemId: item.id,
          patientId,
          kind: "priority_downgrade",
          fromStage: item.stage,
          toStage: item.stage,
          fromStatus: item.status,
          toStatus: item.status,
          fromPriority: from,
          toPriority: to,
          reason,
        },
        who,
        deviceId,
        now,
      );
      return item.stage;
    });

    this.notifySubscribers(stage);
  }

  private async reorderQueue(stage: QueueStage): Promise<void> {
    const items = await db.queue
      .where("stage")
      .equals(stage)
      .and((item) => item.status === "waiting")
      .sortBy("position");

    // Reassign positions sequentially
    for (let i = 0; i < items.length; i++) {
      if (items[i].position !== i + 1) {
        await db.queue.update(items[i].id, {
          position: i + 1,
          updatedAt: new Date(),
          _dirty: 1,
        });
      }
    }
  }

  async getQueueForStage(stage: QueueStage): Promise<QueueItem[]> {
    return await db.queue
      .where("stage")
      .equals(stage)
      .and((item) => item.status !== "done")
      .sortBy("position");
  }

  async getQueueWithPatients(stage: QueueStage): Promise<
    Array<{
      queueItem: QueueItem;
      patient: Patient;
    }>
  > {
    const queueItems = await this.getQueueForStage(stage);

    const withPatients = await Promise.all(
      queueItems.map(async (item) => {
        const patient = await db.patients.get(item.patientId);
        return { queueItem: item, patient: patient! };
      }),
    );

    return withPatients.filter((item) => item.patient);
  }

  async getQueueStats(stage: QueueStage): Promise<QueueStats> {
    const items = await db.queue.where("stage").equals(stage).toArray();

    const waiting = items.filter((i) => i.status === "waiting").length;
    const inProgress = items.filter((i) => i.status === "in_progress").length;
    const done = items.filter((i) => i.status === "done").length;

    // Measured, not estimated: minutes from joining the queue to finishing
    // the stage, for tickets finished today that recorded a queued time.
    const today = epochDay(new Date());
    const measured = items.filter(
      (i) =>
        i.status === "done" &&
        i.queuedAt &&
        epochDay(new Date(i.updatedAt)) === today,
    );

    let averageWaitTime = 0;
    if (measured.length > 0) {
      const totalWait = measured.reduce((sum, i) => {
        const ms =
          new Date(i.updatedAt).getTime() - new Date(i.queuedAt!).getTime();
        return sum + Math.max(0, ms / 60000);
      }, 0);
      averageWaitTime = Math.floor(totalWait / measured.length);
    }

    return {
      stage,
      waiting,
      inProgress,
      done,
      averageWaitTime,
    };
  }

  async getAllQueueStats(): Promise<QueueStats[]> {
    const stages: QueueStage[] = [
      "registration",
      "vitals",
      "consult",
      "pharmacy",
    ];
    return await Promise.all(stages.map((stage) => this.getQueueStats(stage)));
  }

  /** Takes the patient out of every queue (each ticket is audited as "removed"). */
  async removeFromQueue(patientId: string, actor?: QueueActor): Promise<void> {
    const who = this.resolveActor(actor);
    const deviceId = await getDeviceId();
    const now = new Date();

    const stages = await this.tx(async () => {
      const items = await db.queue
        .where("patientId")
        .equals(patientId)
        .and((item) => item.status !== "done")
        .toArray();

      for (const item of items) this.assertMayMove(who, item.stage);

      for (const item of items) {
        await db.queue.update(item.id, {
          status: "done",
          updatedAt: now,
          _dirty: 1,
          transitionPending: 1,
        });
        const priority = normalisePriority(item.priority);
        await this.audit(
          {
            queueItemId: item.id,
            patientId,
            kind: "remove",
            fromStage: item.stage,
            toStage: "removed",
            fromStatus: item.status,
            toStatus: "done",
            fromPriority: priority,
            toPriority: priority,
          },
          who,
          deviceId,
          now,
        );
        await this.reorderQueue(item.stage);
      }
      return items.map((i) => i.stage);
    });

    for (const stage of stages) this.notifySubscribers(stage);

    logger.log(`Removed patient ${patientId} from all queue stages`);
  }

  /**
   * Moves tickets waiting longer than maxWaitTime forward in their line,
   * within their priority: never ahead of a waiting ticket with a higher
   * priority (a normal ticket stays behind urgent ones). It only ever moves
   * tickets forward; each move is audited with user "system", and a ticket
   * that cannot move is left alone (nothing written).
   */
  async checkStaleQueues(): Promise<void> {
    const now = Date.now();
    const maxWaitMs = this.config.maxWaitTime * 60 * 1000;

    const staleItems = await db.queue
      .where("status")
      .equals("waiting")
      .filter((item) => {
        const waitTime = now - new Date(item.updatedAt).getTime();
        return waitTime > maxWaitMs;
      })
      .toArray();

    for (const item of staleItems) {
      logger.warn(
        `Stale queue item detected: Patient ${item.patientId} waiting ${Math.floor((now - new Date(item.updatedAt).getTime()) / 60000)} minutes`,
      );

      // Auto-escalate within the ticket's priority.
      const stage = await this.promote(
        item.patientId,
        "auto-escalation due to long wait",
        SYSTEM_ACTOR,
        true,
      );
      if (stage) this.notifySubscribers(stage);
    }
  }

  subscribe(
    stage: QueueStage,
    callback: (update: QueueItem[]) => void,
  ): () => void {
    const key = `${stage}-${Date.now()}`;
    this.subscribers.set(key, callback);

    // Return unsubscribe function
    return () => {
      this.subscribers.delete(key);
    };
  }

  private async notifySubscribers(stage: QueueStage): Promise<void> {
    const items = await this.getQueueForStage(stage);

    this.subscribers.forEach((callback, key) => {
      if (key.startsWith(stage)) {
        callback(items);
      }
    });
  }

  async setupRealtimeSync(stage: QueueStage): Promise<void> {
    if (!supabase) return;
    if (!isRealtimeAvailable()) return;

    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _channel = supabase
        .channel(`queue:${stage}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "queue",
            filter: `stage=eq.${stage}`,
          },
          async (payload) => {
            // Log the event type only, never the row.
            logger.log("Queue update received from Supabase", payload.eventType);

            // Reload queue from local DB (which will have synced)
            this.notifySubscribers(stage);
          },
        )
        .subscribe();

      logger.log(`Realtime sync enabled for ${stage} queue`);
    } catch (err) {
      logger.warn(
        `[queue] Realtime unavailable for ${stage}; live updates disabled:`,
        err instanceof Error ? err.name : err,
      );
    }
  }

  async exportQueueData(stage?: QueueStage): Promise<string> {
    const stages: QueueStage[] = stage
      ? [stage]
      : ["registration", "vitals", "consult", "pharmacy"];

    const data = [];
    for (const s of stages) {
      const items = await this.getQueueWithPatients(s);

      for (const { queueItem, patient } of items) {
        data.push({
          stage: s,
          position: queueItem.position,
          status: queueItem.status,
          patientName: `${patient.givenName} ${patient.familyName}`,
          patientPhone: patient.phone,
          updatedAt: queueItem.updatedAt.toISOString(),
        });
      }
    }

    return JSON.stringify(data, null, 2);
  }
}

export const queueManagement = new QueueManagement();
