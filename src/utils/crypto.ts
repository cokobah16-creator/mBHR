/**
 * PHI field-level encryption for IndexedDB.
 *
 * Design: docs/PHI_ENCRYPTION_SPIKE.md
 * Tracking: github.com/cokobah16-creator/mBHR/issues/107
 *
 * Key hierarchy (all keys ephemeral — never written to storage):
 *   pin + salt → PBKDF2-SHA256(200k) → master_key
 *   master_key → HKDF-SHA256(info="mbhr-data-v1") → data_key
 *
 * Per-row encryption:
 *   AES-256-GCM(data_key, iv=random(12), aad=id+tableName)
 *   over JSON.stringify of the PHI field subset.
 *
 * Multi-user: one data_key per device, wrapped per user with AES-KW.
 *   app_users.wrapped_key = AES-KW(user_master_key, data_key)
 *   On unlock: unwrap → data_key in memory until session expires.
 */

// ── In-memory key store ──────────────────────────────────────────────────────
// Cleared by clearDataKey() when the PIN session expires (15-min idle hook
// in useAuthStore). Never persisted to IndexedDB or localStorage.

let _dataKey: CryptoKey | null = null;

export function setDataKey(key: CryptoKey): void {
  _dataKey = key;
}

export function getDataKey(): CryptoKey | null {
  return _dataKey;
}

export function clearDataKey(): void {
  _dataKey = null;
}

export function isEncryptionReady(): boolean {
  return _dataKey !== null;
}

// ── Key derivation ────────────────────────────────────────────────────────────

/**
 * Derive master_key and data_key from a PIN + salt.
 * Called at unlock time; results held in memory only.
 */
export async function deriveKeys(
  pin: string,
  pinSalt: string,
): Promise<{ masterKey: CryptoKey; dataKey: CryptoKey }> {
  const enc = new TextEncoder();

  // Import raw PIN as key material for PBKDF2.
  const pinMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(pin),
    "PBKDF2",
    false,
    ["deriveKey", "deriveBits"],
  );

  const saltBytes = hexToBytes(pinSalt).buffer as ArrayBuffer;

  // TODO(encryption_v1): PBKDF2 → AES-256 intermediate, then HKDF.
  // Temporary direct derivation until HKDF chaining is wired.
  const masterKeyRaw = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: 200_000 },
    pinMaterial,
    { name: "AES-GCM", length: 256 },
    true, // extractable so we can use it for HKDF input
    ["encrypt", "decrypt"],
  );

  // data_key = HKDF-SHA256(master_key_bits, info="mbhr-data-v1")
  const masterBits = (await crypto.subtle.exportKey(
    "raw",
    masterKeyRaw,
  )) as ArrayBuffer;
  const hkdfMaterial = await crypto.subtle.importKey(
    "raw",
    masterBits,
    "HKDF",
    false,
    ["deriveKey"],
  );

  const dataKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32).buffer as ArrayBuffer,
      info: enc.encode("mbhr-data-v1"),
    },
    hkdfMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  // Re-derive a non-extractable master key for AES-KW wrapping.
  const wrapKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBytes as unknown as BufferSource,
      iterations: 200_000,
    },
    pinMaterial,
    { name: "AES-KW", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );

  return { masterKey: wrapKey, dataKey };
}

// ── Per-row encryption ────────────────────────────────────────────────────────

export interface EncryptedPayload {
  _enc: string; // base64(AES-GCM ciphertext)
  _iv: string; // base64(12-byte random IV)
  _v: 1;
}

/**
 * Encrypt a subset of row fields.
 *
 * @param phiFields  Plain object containing only the PHI columns.
 * @param id         Row primary key — used as AAD to prevent row swapping.
 * @param tableName  Store name — part of AAD.
 */
export async function encryptPhi(
  phiFields: Record<string, unknown>,
  id: string,
  tableName: string,
): Promise<EncryptedPayload> {
  const key = _dataKey;
  if (!key) throw new Error("[crypto] data_key not set — PIN session expired?");

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(`${tableName}:${id}`);
  const plaintext = new TextEncoder().encode(JSON.stringify(phiFields));

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    key,
    plaintext,
  );

  return {
    _enc: bytesToBase64(new Uint8Array(ciphertext)),
    _iv: bytesToBase64(iv),
    _v: 1,
  };
}

/**
 * Decrypt a row's PHI payload back to plain fields.
 */
export async function decryptPhi(
  payload: EncryptedPayload,
  id: string,
  tableName: string,
): Promise<Record<string, unknown>> {
  const key = _dataKey;
  if (!key) throw new Error("[crypto] data_key not set — PIN session expired?");

  const iv = base64ToBytes(payload._iv);
  const ciphertext = base64ToBytes(payload._enc);
  const aad = new TextEncoder().encode(`${tableName}:${id}`);

  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv.buffer as ArrayBuffer,
      additionalData: aad.buffer as ArrayBuffer,
    },
    key,
    ciphertext.buffer as ArrayBuffer,
  );

  return JSON.parse(new TextDecoder().decode(plaintext)) as Record<
    string,
    unknown
  >;
}

// ── Key wrapping (multi-user shared-device) ───────────────────────────────────

/**
 * Wrap the device data_key under a user's master key for storage in app_users.
 * The wrapped key survives device restarts; the data_key itself does not.
 */
export async function wrapDataKey(
  dataKey: CryptoKey,
  masterKey: CryptoKey,
): Promise<string> {
  const wrapped = await crypto.subtle.wrapKey(
    "raw",
    dataKey,
    masterKey,
    "AES-KW",
  );
  return bytesToBase64(new Uint8Array(wrapped));
}

/**
 * Unwrap and return the data_key from app_users.wrapped_key.
 * Called at unlock after master_key is derived from the user's PIN.
 */
export async function unwrapDataKey(
  wrappedKey: string,
  masterKey: CryptoKey,
): Promise<CryptoKey> {
  const wrappedBytes = base64ToBytes(wrappedKey);
  return crypto.subtle.unwrapKey(
    "raw",
    wrappedBytes.buffer as ArrayBuffer,
    masterKey,
    "AES-KW",
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
