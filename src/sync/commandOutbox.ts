// Command outbox: server-authoritative actions made on this device.
//
// Some decisions belong to the server (portal access, patient merges,
// pharmacy stock, ...). The device applies them optimistically and queues a
// command: an idempotent RPC call with a client UUID (p_command_id). This
// module sends queued commands and records the server's answer.
//
// Rules
// - Oldest first. After a transient failure, later commands for the same
//   record wait for the next run, so they are not applied out of order.
// - Author-gated: a command is sent only while its author is the person
//   signed in online on this device. A decision made by one staff member is
//   never sent under another's sign-in. Commands with no author (automatic
//   backfills) are sent by anyone signed in online who holds the command's
//   requiredPermission.
// - Resending is safe: the RPC returns its stored result for a command id
//   it has already processed.
// - Errors:
//   * network, 5xx, 401 and other unexpected errors: retried with backoff;
//   * RPC not on the server yet (PGRST202 / 42883 / 404): kept, retried
//     after 30 minutes (no retry storm while a migration is pending);
//   * permission (42501 / 403): an authored command is rejected (its author
//     may not do this); an author-less one waits for someone authorised
//     ("waiting for an authorised person to sync") and is not retried under
//     the same sign-in for 6 hours;
//   * P0001 (RAISE in the RPC), 22xxx / 23xxx (invalid request) or a
//     {"outcome": "rejected"} result: rejected. Nothing is retried.
// - Each RPC registers a handler (registerCommandHandler) that updates the
//   device when the answer arrives: confirm the optimistic change, or undo
//   it and raise a notice. Answers that arrive before their handler is
//   registered are handled on the next run.
//
// The store is passed in (db.serverCommands for the main database; a
// package may keep its own table, e.g. in the pharmacy database, so the
// optimistic change and the command are written in one Dexie transaction).
// No row data or server message text is logged or stored: only codes.

import type { ServerCommand } from "@/db";

export type { ServerCommand, ServerCommandStatus } from "@/db";

/** The subset of a Dexie table the outbox uses. */
export interface CommandStore {
  add(command: ServerCommand): Promise<unknown>;
  get(id: string): Promise<ServerCommand | undefined>;
  update(id: string, changes: Partial<ServerCommand>): Promise<unknown>;
  delete(id: string): Promise<unknown>;
  where(index: string): {
    anyOf(values: string[]): {
      toArray(): Promise<ServerCommand[]>;
      count(): Promise<number>;
    };
  };
}

export interface EntityRef {
  table: string;
  id: string;
}

export interface EnqueueInput {
  /** Client UUID; generated when not given. */
  id?: string;
  rpc: string;
  /** RPC arguments (p_* names) without p_command_id. */
  args: Record<string, unknown>;
  /** Local staff user id; null only for automatic backfills. */
  authorId: string | null;
  /** Permission the sender needs (required when authorId is null). */
  requiredPermission?: string;
  entityRefs: EntityRef[];
}

/** The person signed in online on this device. */
export interface CommandSender {
  /** Local staff user id (currentUser.id). */
  localUserId: string;
  /** Online (Supabase) user id. */
  cloudUserId: string;
  role: string;
}

export interface RpcError {
  code?: string;
  message?: string;
}

export interface RpcResponse {
  data: unknown;
  error: RpcError | null;
  /** HTTP status when known (0 or missing: no response). */
  status?: number;
}

export interface DrainDeps {
  callRpc(rpc: string, args: Record<string, unknown>): Promise<RpcResponse>;
  /** The person signed in online, or null (then nothing is sent). */
  sender(): Promise<CommandSender | null>;
  hasPermission(role: string, permission: string): boolean;
  /** Called once per rejected command (for example to queue it for review). */
  onRejected?(command: ServerCommand): Promise<void> | void;
  now?(): number;
}

export interface DrainSummary {
  applied: number;
  rejected: number;
  /** Transient failures; retried later. */
  retrying: number;
  /** RPC not on the server yet; retried later. */
  unavailable: number;
  /** Refused for permission; waiting for an authorised person. */
  waitingPermission: number;
  /** Made by someone else, or needing a permission the sender lacks. */
  notSender: number;
  /** Not due yet (backoff) or held behind an earlier failed command. */
  deferred: number;
  /** Nothing was sent: no online sign-in, or another drain was running. */
  skipped?: "no_sender" | "busy";
}

export interface CommandHandlers {
  /** The server applied the command; `result` is its answer. */
  onApplied?(command: ServerCommand, result: unknown): Promise<void> | void;
  /** The server refused the command; undo the optimistic change here. */
  onRejected?(command: ServerCommand, reason: string): Promise<void> | void;
}

const OPEN: ServerCommand["status"][] = ["pending", "waiting_permission"];
const SETTLED: ServerCommand["status"][] = ["applied", "rejected"];

const MINUTE = 60_000;
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 30 * MINUTE;
export const UNAVAILABLE_RETRY_MS = 30 * MINUTE;
export const PERMISSION_RETRY_MS = 6 * 60 * MINUTE;
const HANDLER_MAX_ATTEMPTS = 3;
const KEEP_SETTLED_MS = 30 * 24 * 60 * MINUTE;

// ---------------------------------------------------------------------------
// Pure rules (exported for tests)
// ---------------------------------------------------------------------------

export type RpcOutcome =
  | { kind: "applied"; result: unknown }
  | { kind: "rejected"; reason: string; result?: unknown }
  | { kind: "permission"; code: string }
  | { kind: "unavailable"; code: string }
  | { kind: "retry"; code: string; network: boolean };

const SAFE_REASON = /^[a-z][a-z0-9_]{0,59}$/;
const SAFE_CODE = /^[A-Za-z0-9_.-]{1,40}$/;

/** A short reason code safe to store and show; never free text. */
export function safeReason(value: unknown, fallback = "rejected_by_server"): string {
  return typeof value === "string" && SAFE_REASON.test(value) ? value : fallback;
}

function safeCode(error: RpcError | null, status?: number): string {
  if (error?.code && SAFE_CODE.test(error.code)) return error.code;
  if (status) return `http_${status}`;
  return "network";
}

/** What a server answer means for the command. */
export function classifyRpcResponse(response: RpcResponse): RpcOutcome {
  const { data, error, status } = response;
  if (!error) {
    if (
      data &&
      typeof data === "object" &&
      (data as { outcome?: unknown }).outcome === "rejected"
    ) {
      return {
        kind: "rejected",
        reason: safeReason((data as { reason?: unknown }).reason),
        result: data,
      };
    }
    return { kind: "applied", result: data };
  }
  const code = error.code ?? "";
  if (code === "42501" || status === 403) {
    return { kind: "permission", code: safeCode(error, status) };
  }
  if (code === "PGRST202" || code === "42883" || status === 404) {
    return { kind: "unavailable", code: safeCode(error, status) };
  }
  if (code === "P0001") {
    // RAISE EXCEPTION '<reason_code>' in the RPC.
    return { kind: "rejected", reason: safeReason(error.message) };
  }
  if (/^2[23][0-9A-Z]{3}$/.test(code)) {
    return { kind: "rejected", reason: "invalid_request" };
  }
  const network = !status && !code;
  return { kind: "retry", code: safeCode(error, status), network };
}

/** Wait before the next attempt after `attempts` transient failures. */
export function retryDelayMs(attempts: number): number {
  const n = Math.max(1, attempts);
  return Math.min(RETRY_BASE_MS * 2 ** (n - 1), RETRY_MAX_MS);
}

export type SendDecision = "send" | "not_due" | "other_author" | "no_permission";

/** May `sender` send `command` now? */
export function sendDecision(
  command: ServerCommand,
  sender: CommandSender,
  hasPermission: (role: string, permission: string) => boolean,
  now: number,
): SendDecision {
  if (command.authorId !== null && command.authorId !== undefined) {
    if (command.authorId !== sender.localUserId) return "other_author";
  } else if (
    !command.requiredPermission ||
    !hasPermission(sender.role, command.requiredPermission)
  ) {
    return "no_permission";
  }
  if (command.status === "waiting_permission") {
    // Someone else signed in online: try now. Same person: wait.
    if (command.refusedFor && command.refusedFor !== sender.cloudUserId) return "send";
  }
  if (command.nextAttemptAt && command.nextAttemptAt > now) return "not_due";
  return "send";
}

const entityKey = (ref: EntityRef) => `${ref.table}:${ref.id}`;

/** A random UUID (the RPCs' p_command_id is a uuid). */
export function newCommandId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function namedError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const handlers = new Map<string, CommandHandlers>();

/**
 * Register what to do on this device when the server answers `rpc`
 * commands. Returns a function that removes the registration. Register at
 * module load of the feature's service so answers are handled promptly;
 * answers that arrived earlier are handled on the next drain.
 */
export function registerCommandHandler(rpc: string, commandHandlers: CommandHandlers): () => void {
  handlers.set(rpc, commandHandlers);
  return () => {
    if (handlers.get(rpc) === commandHandlers) handlers.delete(rpc);
  };
}

async function runHandler(store: CommandStore, command: ServerCommand, now: number): Promise<void> {
  const handler = handlers.get(command.rpc);
  if (!handler) return; // handled once a handler is registered
  try {
    if (command.status === "applied") {
      await handler.onApplied?.(command, command.result);
    } else if (command.status === "rejected") {
      await handler.onRejected?.(command, command.rejectReason ?? "rejected_by_server");
    }
    await store.update(command.id, { handledAt: now });
  } catch (error) {
    const attempts = (command.handlerAttempts ?? 0) + 1;
    console.warn(
      `[outbox] handler for ${command.rpc} failed`,
      error instanceof Error ? error.name : "unknown",
    );
    await store.update(command.id, {
      handlerAttempts: attempts,
      // Stop after a few tries so one broken record cannot loop forever.
      ...(attempts >= HANDLER_MAX_ATTEMPTS ? { handledAt: now, lastErrorCode: "handler_failed" } : {}),
    });
  }
}

/** Run handlers for answers not yet handled (e.g. registered late). */
export async function settleUnhandled(store: CommandStore, now = Date.now()): Promise<number> {
  const settled = await store.where("status").anyOf(SETTLED).toArray();
  let handled = 0;
  for (const command of settled) {
    if (command.handledAt || !handlers.has(command.rpc)) continue;
    await runHandler(store, command, now);
    handled += 1;
  }
  return handled;
}

// ---------------------------------------------------------------------------
// Queue and send
// ---------------------------------------------------------------------------

/**
 * Queue a command. Call it inside the same Dexie transaction as the
 * optimistic change on this device (include the store in the transaction).
 */
export async function enqueueCommand(
  store: CommandStore,
  input: EnqueueInput,
  now = Date.now(),
): Promise<ServerCommand> {
  if (input.authorId === null && !input.requiredPermission) {
    throw namedError("CommandNeedsAuthorOrPermission");
  }
  const args = { ...input.args };
  delete args.p_command_id; // added when sent
  const command: ServerCommand = {
    id: input.id ?? newCommandId(),
    rpc: input.rpc,
    args,
    authorId: input.authorId,
    requiredPermission: input.requiredPermission,
    entityRefs: input.entityRefs,
    status: "pending",
    createdAt: now,
    attempts: 0,
  };
  await store.add(command);
  return command;
}

const draining = new Set<CommandStore>();

function emptySummary(): DrainSummary {
  return {
    applied: 0,
    rejected: 0,
    retrying: 0,
    unavailable: 0,
    waitingPermission: 0,
    notSender: 0,
    deferred: 0,
  };
}

/** Send every command that may be sent now, oldest first. */
export async function drainCommands(store: CommandStore, deps: DrainDeps): Promise<DrainSummary> {
  const summary = emptySummary();
  if (draining.has(store)) return { ...summary, skipped: "busy" };
  draining.add(store);
  try {
    const clock = deps.now ?? Date.now;
    await settleUnhandled(store, clock());

    const sender = await deps.sender();
    if (!sender) return { ...summary, skipped: "no_sender" };

    const open = (await store.where("status").anyOf(OPEN).toArray()).sort(
      (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    const held = new Set<string>();

    for (const command of open) {
      const now = clock();
      const refs = command.entityRefs ?? [];
      if (refs.some((ref) => held.has(entityKey(ref)))) {
        summary.deferred += 1;
        continue;
      }
      const decision = sendDecision(command, sender, deps.hasPermission, now);
      if (decision === "other_author" || decision === "no_permission") {
        summary.notSender += 1;
        continue;
      }
      if (decision === "not_due") {
        refs.forEach((ref) => held.add(entityKey(ref)));
        summary.deferred += 1;
        continue;
      }

      let outcome: RpcOutcome;
      try {
        const response = await deps.callRpc(command.rpc, {
          ...command.args,
          p_command_id: command.id,
        });
        outcome = classifyRpcResponse(response);
      } catch {
        outcome = { kind: "retry", code: "network", network: true };
      }

      const attempts = (command.attempts ?? 0) + 1;
      if (outcome.kind === "permission" && command.authorId) {
        // The author may not do this at all: undo it rather than wait.
        outcome = { kind: "rejected", reason: "permission_denied" };
      }

      switch (outcome.kind) {
        case "applied": {
          const changes: Partial<ServerCommand> = {
            status: "applied",
            result: outcome.result,
            attempts,
            settledAt: now,
            nextAttemptAt: undefined,
            lastErrorCode: undefined,
          };
          await store.update(command.id, changes);
          await runHandler(store, { ...command, ...changes }, now);
          summary.applied += 1;
          break;
        }
        case "rejected": {
          const changes: Partial<ServerCommand> = {
            status: "rejected",
            rejectReason: outcome.reason,
            result: outcome.result,
            attempts,
            settledAt: now,
            nextAttemptAt: undefined,
          };
          await store.update(command.id, changes);
          const settled = { ...command, ...changes };
          await runHandler(store, settled, now);
          try {
            await deps.onRejected?.(settled);
          } catch (error) {
            console.warn(
              `[outbox] could not report a rejected ${command.rpc}`,
              error instanceof Error ? error.name : "unknown",
            );
          }
          summary.rejected += 1;
          break;
        }
        case "permission": {
          await store.update(command.id, {
            status: "waiting_permission",
            refusedFor: sender.cloudUserId,
            attempts,
            lastErrorCode: outcome.code,
            nextAttemptAt: now + PERMISSION_RETRY_MS,
          });
          summary.waitingPermission += 1;
          break;
        }
        case "unavailable": {
          await store.update(command.id, {
            attempts,
            lastErrorCode: "rpc_unavailable",
            nextAttemptAt: now + UNAVAILABLE_RETRY_MS,
          });
          refs.forEach((ref) => held.add(entityKey(ref)));
          summary.unavailable += 1;
          break;
        }
        case "retry": {
          await store.update(command.id, {
            attempts,
            lastErrorCode: outcome.code,
            nextAttemptAt: now + retryDelayMs(attempts),
          });
          refs.forEach((ref) => held.add(entityKey(ref)));
          summary.retrying += 1;
          break;
        }
      }
      // No connection: stop; everything else would fail the same way.
      if (outcome.kind === "retry" && outcome.network) break;
    }

    await pruneSettled(store, clock());
    return summary;
  } finally {
    draining.delete(store);
  }
}

/** Remove answered, handled commands older than 30 days. */
async function pruneSettled(store: CommandStore, now: number): Promise<void> {
  const settled = await store.where("status").anyOf(SETTLED).toArray();
  for (const command of settled) {
    if (command.handledAt && command.settledAt && now - command.settledAt > KEEP_SETTLED_MS) {
      await store.delete(command.id);
    }
  }
}

/** Commands not yet accepted or refused by the server (for "waiting to sync"). */
export async function countOpenCommands(store: CommandStore): Promise<number> {
  return store.where("status").anyOf(OPEN).count();
}

/** Commands waiting for an authorised person to sync. */
export async function countWaitingPermission(store: CommandStore): Promise<number> {
  return store.where("status").anyOf(["waiting_permission"]).count();
}
