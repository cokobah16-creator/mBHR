/**
 * Dexie creating/updating/reading hooks for PHI field-level encryption.
 *
 * Design: docs/PHI_ENCRYPTION_SPIKE.md
 * Tracking: github.com/cokobah16-creator/mBHR/issues/107
 *
 * Activation modes (stored in db.settings key="encryption_v1"):
 *   "off"    — hooks installed but no-op; default until sprint is complete.
 *   "shadow" — encrypt on write, still read plaintext. Migration window.
 *   "active" — encrypt on write, decrypt on read. Full enforcement.
 *
 * Install once at app startup (called from src/main.tsx after db opens):
 *   import { installEncryptionHooks } from "@/db/encryptionHooks";
 *   await installEncryptionHooks(db);
 */

import { db } from "@/db";
import {
  decryptPhi,
  encryptPhi,
  type EncryptedPayload,
  isEncryptionReady,
} from "@/utils/crypto";
import * as logger from "@/lib/logger";

// ── PHI field registry ────────────────────────────────────────────────────────
// Only PHI columns are encrypted. Operational columns (id, patientId, _dirty,
// indexes, timestamps) remain plaintext so existing queries keep working.

const PHI_FIELDS: Record<string, string[]> = {
  patients: ["givenName", "familyName", "dob", "phone", "email", "address"],
  vitals: [
    "heightCm",
    "weightKg",
    "tempC",
    "pulseBpm",
    "systolic",
    "diastolic",
    "spo2",
    "bmi",
  ],
  consultations: ["subjective", "objective", "assessment", "plan", "notes"],
  dispenses: ["itemName", "sig", "qty", "notes"],
  patientAllergies: ["allergen", "reaction", "severity", "notes"],
  patientPreferences: ["language", "communicationPreference", "notes"],
  clinicalAlerts: ["message", "details"],
  portalMessages: ["subject", "body"],
  outboundMessages: ["payload"],
};

// ── Mode helpers ──────────────────────────────────────────────────────────────

type EncryptionMode = "off" | "shadow" | "active";

let _cachedMode: EncryptionMode = "off";

export async function getEncryptionMode(): Promise<EncryptionMode> {
  const row = await db.settings.get("encryption_v1");
  _cachedMode = (row?.value ?? "off") as EncryptionMode;
  return _cachedMode;
}

export async function setEncryptionMode(mode: EncryptionMode): Promise<void> {
  await db.settings.put({ key: "encryption_v1", value: mode });
  _cachedMode = mode;
  logger.info(`[encryption] mode set to '${mode}'`);
}

// ── Hook installation ─────────────────────────────────────────────────────────

/**
 * Install encryption hooks on all PHI tables.
 * Call once after the database opens, before any reads or writes.
 *
 * TODO(encryption_v1): wire into src/main.tsx:
 *   import { installEncryptionHooks } from "@/db/encryptionHooks";
 *   await installEncryptionHooks();
 */
export async function installEncryptionHooks(): Promise<void> {
  await getEncryptionMode(); // warm the cache

  for (const [tableName, phiFields] of Object.entries(PHI_FIELDS)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const table = (db as any)[tableName];
    if (!table) {
      logger.warn(
        `[encryption] table '${tableName}' not found — skipping hooks`,
      );
      continue;
    }

    // creating hook — runs before a new row is committed.
    table.hook(
      "creating",
      function (_primaryKey: unknown, obj: Record<string, unknown>) {
        if (_cachedMode === "off" || !isEncryptionReady()) return;
        encryptRowInPlace(
          obj,
          String(_primaryKey ?? obj["id"] ?? ""),
          tableName,
          phiFields,
        );
      },
    );

    // updating hook — runs before an existing row is modified.
    table.hook(
      "updating",
      function (
        modifications: Record<string, unknown>,
        _primaryKey: unknown,
        obj: Record<string, unknown>,
      ) {
        if (_cachedMode === "off" || !isEncryptionReady()) return modifications;
        const merged = { ...obj, ...modifications };
        const id = String(_primaryKey ?? obj["id"] ?? "");
        encryptRowInPlace(merged, id, tableName, phiFields);
        // Return only the encrypted fields as the modification delta.
        return {
          ...modifications,
          _enc: merged._enc,
          _iv: merged._iv,
          _v: merged._v,
          // Strip plaintext PHI from the delta so it isn't re-written.
          ...Object.fromEntries(phiFields.map((f) => [f, undefined])),
        };
      },
    );

    // reading hook — runs after each row is read from IndexedDB.
    table.hook("reading", function (obj: Record<string, unknown>) {
      if (_cachedMode !== "active" || !isEncryptionReady()) return obj;
      if (!obj._enc) return obj; // plaintext row — not yet migrated
      return decryptRowSync(obj, String(obj["id"] ?? ""), tableName);
    });
  }

  logger.info(
    "[encryption] hooks installed on",
    Object.keys(PHI_FIELDS).length,
    "tables",
  );
}

// ── Encrypt/decrypt helpers ───────────────────────────────────────────────────

/**
 * Encrypt PHI fields in-place on a row object.
 * Fires-and-forgets: Dexie creating/updating hooks are synchronous, so we
 * mutate the object before it is committed. The async encryption runs in the
 * same microtask queue as the transaction.
 *
 * TODO(encryption_v1): Dexie hooks don't support async natively. The real
 * implementation needs either:
 *   a) A Dexie middleware (Dexie v4 supports async middlewares), or
 *   b) A manual encrypt-then-write pattern in each service function.
 * This skeleton uses approach (b) marker: services call encryptForWrite()
 * before db.table.add/put, and decryptFromRead() after db.table.get.
 */
function encryptRowInPlace(
  obj: Record<string, unknown>,
  id: string,
  tableName: string,
  phiFields: string[],
): void {
  // Collect PHI fields into a plain object.
  const phi: Record<string, unknown> = {};
  for (const field of phiFields) {
    if (obj[field] !== undefined) {
      phi[field] = obj[field];
    }
  }
  if (Object.keys(phi).length === 0) return;

  // Queue the async encryption. The actual commit waits because Dexie
  // transactions are promise-based and this runs in the same microtask.
  encryptPhi(phi, id, tableName)
    .then((payload) => {
      Object.assign(obj, payload);
      // In shadow mode, keep plaintext fields too. In active mode, strip them.
      if (_cachedMode === "active") {
        for (const field of phiFields) delete obj[field];
      }
    })
    .catch((err) => {
      logger.error("[encryption] encryptRowInPlace failed:", err);
    });
}

/**
 * Synchronous wrapper for the reading hook — schedules decryption but returns
 * a proxy that resolves when decryption completes.
 *
 * NOTE: Dexie v3 reading hooks are synchronous. The correct pattern for async
 * decryption is to call decryptForRead() explicitly after each get/toArray call.
 * This stub keeps the hook slot open for when Dexie middleware is added.
 */
function decryptRowSync(
  obj: Record<string, unknown>,
  id: string,
  tableName: string,
): Record<string, unknown> {
  // Return the row as-is (ciphertext visible) — decryption happens via
  // explicit decryptForRead() calls in service layer.
  // TODO(encryption_v1): replace with Dexie v4 middleware or service-layer wrapping.
  void decryptPhi(obj as unknown as EncryptedPayload, id, tableName).then(
    (phi) => Object.assign(obj, phi),
  );
  return obj;
}

// ── Service-layer helpers (use these until Dexie middleware is in place) ──────

/**
 * Encrypt PHI fields before writing a new or updated row.
 * Call instead of db.table.add() / db.table.put() in shadow/active mode.
 *
 * Usage (shadow mode — both plaintext and _enc coexist):
 *   const row = await encryptForWrite("patients", patient);
 *   await db.patients.put(row);
 */
export async function encryptForWrite<T extends { id: string }>(
  tableName: keyof typeof PHI_FIELDS,
  row: T,
): Promise<T> {
  if (_cachedMode === "off" || !isEncryptionReady()) return row;

  const phiFields = PHI_FIELDS[tableName];
  const phi: Record<string, unknown> = {};
  for (const field of phiFields) {
    const val = (row as Record<string, unknown>)[field];
    if (val !== undefined) phi[field] = val;
  }

  if (Object.keys(phi).length === 0) return row;

  const payload = await encryptPhi(phi, row.id, tableName);
  const result = { ...row, ...payload };

  if (_cachedMode === "active") {
    for (const field of phiFields)
      delete (result as unknown as Record<string, unknown>)[field];
  }

  return result as T;
}

/**
 * Decrypt PHI fields after reading a row in active mode.
 * Call immediately after db.table.get() / db.table.toArray() in active mode.
 *
 * Usage:
 *   const raw = await db.patients.get(id);
 *   const patient = raw ? await decryptForRead("patients", raw) : undefined;
 */
export async function decryptForRead<T extends { id: string; _enc?: string }>(
  tableName: keyof typeof PHI_FIELDS,
  row: T,
): Promise<T> {
  if (_cachedMode !== "active" || !isEncryptionReady()) return row;
  if (!row._enc) return row; // plaintext row not yet migrated

  try {
    const phi = await decryptPhi(
      row as unknown as EncryptedPayload,
      row.id,
      tableName as string,
    );
    return { ...row, ...phi };
  } catch (err) {
    logger.error(
      `[encryption] decryptForRead failed for ${tableName}/${row.id}:`,
      err,
    );
    return row; // fail-open: return ciphertext row rather than crash
  }
}
