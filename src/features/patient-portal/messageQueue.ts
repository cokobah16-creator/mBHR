/**
 * Messages a patient wrote while this phone was offline.
 *
 * They live only in this browser's localStorage until the patient taps
 * "Send now" while online. Nothing sends them automatically, so the UI must
 * always label them "Not sent".
 */

export const MESSAGE_QUEUE_KEY = "patient_message_queue";

export interface QueuedMessage {
  id: string;
  subject: string;
  body: string;
  from_patient: true;
  from_name: string;
  created_at: string;
  read: boolean;
  patient_id: string;
  staff_id?: string | null;
}

/** Parse the stored queue, dropping anything that is not a usable message. */
export function parseMessageQueue(raw: string | null): QueuedMessage[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is QueuedMessage =>
        !!m &&
        typeof m === "object" &&
        typeof (m as QueuedMessage).id === "string" &&
        typeof (m as QueuedMessage).subject === "string" &&
        typeof (m as QueuedMessage).body === "string",
    );
  } catch {
    return [];
  }
}

/**
 * Only messages saved for this patient. Older entries saved without a patient
 * id cannot be attributed, so they are never shown (the phone may be shared).
 */
export function queuedForPatient(
  queue: readonly QueuedMessage[],
  patientId: string,
): QueuedMessage[] {
  if (!patientId) return [];
  return queue.filter((m) => m.patient_id === patientId);
}

export function withoutQueued(
  queue: readonly QueuedMessage[],
  id: string,
): QueuedMessage[] {
  return queue.filter((m) => m.id !== id);
}

export function readMessageQueue(): QueuedMessage[] {
  try {
    return parseMessageQueue(localStorage.getItem(MESSAGE_QUEUE_KEY));
  } catch {
    return [];
  }
}

/** Returns false when the phone would not let us save (storage full or blocked). */
export function writeMessageQueue(queue: readonly QueuedMessage[]): boolean {
  try {
    localStorage.setItem(MESSAGE_QUEUE_KEY, JSON.stringify(queue));
    return true;
  } catch {
    return false;
  }
}

/**
 * Forget every unsent message on this phone. Sign-out calls it, so the next
 * person on a shared phone cannot read what was written.
 */
export function clearMessageQueue(): void {
  try {
    localStorage.removeItem(MESSAGE_QUEUE_KEY);
  } catch {
    // Storage blocked: nothing to clear.
  }
}
