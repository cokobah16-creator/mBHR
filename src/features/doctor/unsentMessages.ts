// Messages a clinician has written but the online service has not confirmed.
//
// Staff and patient messages are stored online only. While a message is on
// its way, or after a send fails, it is held here, in memory, so it survives
// the messaging panel being closed and reopened. It is deliberately NOT
// written to device storage: message text can contain patient details and
// must not sit in plain browser storage outside the encrypted database.
// Reloading the app discards it, and the UI says so.
//
// Every store is keyed by a scope (the signed-in user's id) so a colleague
// who signs in on the same tablet never sees someone else's unsent messages.

import type { SendMessageParams } from "@/services/palaverRoom";

export type UnsentState = "waiting" | "sending" | "failed";

export interface UnsentMessage<P> {
  localId: string;
  /** The conversation it belongs to: the colleague's or the patient's id. */
  threadKey: string;
  params: P;
  state: UnsentState;
  /** Staff-facing reason when state is "failed". */
  errorText?: string;
  createdAt: string;
}

export interface UnsentStore<P> {
  list(scope: string): UnsentMessage<P>[];
  add(scope: string, message: UnsentMessage<P>): void;
  update(
    scope: string,
    localId: string,
    patch: Partial<Pick<UnsentMessage<P>, "state" | "errorText">>,
  ): void;
  remove(scope: string, localId: string): void;
  subscribe(listener: () => void): () => void;
}

const EMPTY: never[] = [];

export function createUnsentStore<P>(): UnsentStore<P> {
  const byScope = new Map<string, UnsentMessage<P>[]>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const set = (scope: string, next: UnsentMessage<P>[]) => {
    if (next.length === 0) byScope.delete(scope);
    else byScope.set(scope, next);
    emit();
  };

  return {
    list: (scope) => byScope.get(scope) ?? EMPTY,
    add(scope, message) {
      set(scope, [...(byScope.get(scope) ?? []), message]);
    },
    update(scope, localId, patch) {
      const current = byScope.get(scope);
      if (!current || !current.some((m) => m.localId === localId)) return;
      set(
        scope,
        current.map((m) => (m.localId === localId ? { ...m, ...patch } : m)),
      );
    },
    remove(scope, localId) {
      const current = byScope.get(scope);
      if (!current) return;
      set(
        scope,
        current.filter((m) => m.localId !== localId),
      );
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Reply drafts per conversation, kept in memory only (same reasons). */
export interface DraftStore {
  get(scope: string, threadKey: string): string;
  set(scope: string, threadKey: string, text: string): void;
}

export function createDraftStore(): DraftStore {
  const drafts = new Map<string, string>();
  const key = (scope: string, threadKey: string) => `${scope}\u0000${threadKey}`;
  return {
    get: (scope, threadKey) => drafts.get(key(scope, threadKey)) ?? "",
    set(scope, threadKey, text) {
      if (text) drafts.set(key(scope, threadKey), text);
      else drafts.delete(key(scope, threadKey));
    },
  };
}

/** Parameters for a staff message to a patient (see sendDoctorMessage). */
export interface PatientMessageParams {
  staffId: string;
  staffName: string;
  patientId: string;
  subject: string;
  body: string;
  /** Row id chosen on this device so a retry cannot store it twice. */
  clientId?: string;
}

/**
 * A UUID for a message row, chosen before the first send attempt so every
 * retry of that message carries the same id. Undefined when the browser
 * cannot generate one; the server then assigns the id (retries after a lost
 * response could store the message twice).
 */
export function newMessageRowId(): string | undefined {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return typeof c?.randomUUID === "function" ? c.randomUUID() : undefined;
}

export const palaverUnsent = createUnsentStore<SendMessageParams>();
export const palaverDrafts = createDraftStore();
export const patientUnsent = createUnsentStore<PatientMessageParams>();
export const patientDrafts = createDraftStore();
