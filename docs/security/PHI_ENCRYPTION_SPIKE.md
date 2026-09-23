# Spike: field-level PHI encryption in IndexedDB

> **Status:** investigation only. No encryption code is shipped. After
> reading this, the team decides whether to schedule the implementation.

## 1. Why we're considering this

Patient names, dates of birth, vitals, and consultation notes are stored
**plaintext** in IndexedDB on every device that runs mBHR. The PIN that
gates login is hashed (PBKDF2-100k, `src/utils/pin.ts`), but once a
device is unlocked — or pulled apart with browser dev tools, or imaged
off the storage — the PHI is readable. The cloud side is already
covered: TLS in transit, RLS in Postgres, and (after Phase A) no
`USING (true)` policies leaking rows across patients.

The remaining risk is **the device itself**: a tablet left on a clinic
table, a stolen volunteer phone, or a malicious co-worker borrowing a
device while logged in. PIN mode buys us a lock screen; it does not buy
us encryption-at-rest in IndexedDB.

## 2. Threat model

| Attacker                                     | What they get today                          | What encryption would prevent                               |
| -------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| Casual borrower, screen unlocked             | Full app access                              | Nothing — they're past the PIN; field encryption can't help |
| Lost / stolen tablet, locked                 | Plaintext IndexedDB via dev tools or imaging | Everything in the encrypted columns                         |
| Forensic recovery from sold device           | Same as above                                | Everything                                                  |
| Malicious co-worker with their own staff PIN | Their own access scope (limited by RBAC)     | Nothing — they're a legitimate user                         |
| Compromised browser extension                | Whatever the running app can see in memory   | Nothing while the app is unlocked; minor for closed tabs    |
| Server-side compromise                       | RLS-scoped data                              | Nothing — encryption is for local storage, not cloud        |

The honest answer: encryption-at-rest in IndexedDB is **specifically a
defence against device loss / forensic recovery on a locked-but-not-OS-encrypted
device**. That's a real threat for clinic-issued Android tablets in the
field, but it's not a universal mitigation.

## 3. Field-by-field PHI inventory

Source: `src/db/index.ts`. Columns marked PHI must be encrypted; columns
marked OP (operational) stay plaintext so the existing indexes still work.

| Store              | PHI columns                                                         | OP columns                                         | Read hotness | Write hotness |
| ------------------ | ------------------------------------------------------------------- | -------------------------------------------------- | ------------ | ------------- |
| patients           | givenName, familyName, dob, phone, email, address                   | id, sex, state, lga, createdAt, \_dirty            | very high    | medium        |
| vitals             | heightCm, weightKg, tempC, pulseBpm, systolic, diastolic, spo2, bmi | id, patientId, visitId, takenAt, \_dirty           | high         | high          |
| consultations      | subjective, objective, assessment, plan, notes                      | id, patientId, visitId, status, createdAt, \_dirty | high         | medium        |
| dispenses          | itemName, sig, qty, notes                                           | id, patientId, visitId, createdAt, \_dirty         | medium       | medium        |
| visits             | (none)                                                              | all                                                | high         | low           |
| queue              | (none — only IDs)                                                   | all                                                | very high    | very high     |
| patientAllergies   | substance, reaction, severity, notes                                | id, patientId, \_dirty                             | low          | low           |
| patientPreferences | language, communicationPreference, notes                            | id, patientId, \_dirty                             | low          | low           |
| clinicalAlerts     | message, details                                                    | id, patientId, severity, \_dirty                   | low          | low           |
| portalMessages     | subject, body                                                       | id, patientId, threadId, sentAt, \_dirty           | medium       | medium        |
| auditLogs          | (action description may include patient names)                      | id, actor, action, at                              | low          | high          |
| outboundMessages   | payload (rendered phone/name/dosage)                                | id, status, channel                                | low          | high          |

Stores with NO PHI columns (sites, settings, meta, messageTemplates,
quizQuestions, vitalsRanges, etc.) stay plaintext.

## 4. Crypto design sketch

### Key derivation

A per-device AES-256-GCM key derived from the PIN at unlock time:

```
salt        = users[currentUser].pinSalt        (already exists)
master_key  = PBKDF2-SHA256(pin, salt, 200_000 iter, 32 bytes)
data_key    = HKDF-SHA256(master_key, info="mbhr-data-v1", length=32)
```

`master_key` stays in memory only. `data_key` is what we encrypt with.
Both go away the moment the PIN session expires (15 min idle, per the
existing session policy).

### Record encryption

Per-row, per-field encryption is too chatty (Dexie reads are
per-record, but we want a stable IV per row). Use **per-record envelope
encryption**: encrypt the full set of PHI columns of a row into one blob,
keep the OP columns plaintext.

```
record_iv  = randomBytes(12)
plaintext  = JSON.stringify({ givenName, familyName, dob, phone, … })
ciphertext = AES-GCM.encrypt(data_key, record_iv, plaintext, aad = id + tableName)
row        = { id, …OP cols, _enc: ciphertext, _iv: record_iv, _v: 1 }
```

Use `aad` (additional authenticated data) so that swapping a ciphertext
between rows fails to decrypt — defends against record-rebinding tampering.

### Shared-device handling

A clinic tablet has multiple staff PINs. We have two reasonable choices:

- **Per-user data partitioning** (simpler). Each user only sees rows
  they created or are assigned. Each user's `data_key` decrypts only
  their own subset. Reduces utility but is the cleanest model.

- **Shared data key wrapped per user** (Dexie-friendly). One actual
  `data_key` for the device's data. Each user has a `wrapped_key`
  stored under their `app_users` row: `wrap(user_master_key, data_key)`.
  At unlock, that user's master derives the data key. Admin can rotate
  by re-wrapping. This is the one the implementation should use.

### Recovery

When a device is lost and the user is provisioned on a new one, the
**wrapped key** is fetched from `app_users.wrapped_key` and unwrapped
with their PIN-derived master. **There is no recovery if the user
forgets their PIN** — that's a feature, not a bug, for an offline
encryption scheme. Admins can reset the user's PIN, but that means
re-issuing a wrapped key and treating the old local data as lost.

## 5. Search / index blast radius

The four indexes in `src/db/index.ts` that have to keep working:

| Index      | Purpose                         | Encrypted?  | Workaround                                                                |
| ---------- | ------------------------------- | ----------- | ------------------------------------------------------------------------- |
| `phoneN`   | Normalised phone for dedup      | yes (phone) | Keep `phoneN = SHA-256(normalisedPhone)` plaintext. Lossy lookup is fine. |
| `nameKey`  | Phonetic key (Metaphone)        | yes (names) | Keep `nameKey = metaphone(given + family)` plaintext.                     |
| `dobDay`   | Day-of-year for fuzzy matching  | yes (dob)   | Keep plaintext. Reveals dob day of year; that's acceptable.               |
| `epochDay` | Epoch-day for sorting/filtering | yes (dob)   | Keep plaintext as a derived column.                                       |

UX losses we need to swallow:

- **Free-text name search** stops working. UI must filter on Metaphone
  or fall back to a server-side decrypt path (which only works online).
- **Sort by lastname** in registration UI stops working — switch to
  sort by `createdAt` or `epochDay`.
- **Patient picker shows "Patient #12347"** until decrypt completes —
  add a tiny "decrypting…" shimmer.

## 6. Migration cost

| Item                                                                                    | Estimate                     |
| --------------------------------------------------------------------------------------- | ---------------------------- |
| Dexie v16: add `_enc, _iv, _v` columns to PHI tables                                    | 1 day                        |
| Implement `encryptRow` / `decryptRow` + Dexie hooks (`creating`, `updating`, `reading`) | 2 days                       |
| Migrate existing plaintext rows lazily on next write (or eager via batch job)           | 2 days                       |
| Add `wrapped_key` to app_users + key-wrapping helpers                                   | 2 days                       |
| UI for "decrypting…" placeholders + free-text-search fallback                           | 3 days                       |
| Sync impact: decide whether sync pushes plaintext (decrypted before push) or ciphertext | 1 day decision + 2 days impl |
| Tests: round-trip, lost-PIN recovery, multi-user wrap                                   | 3 days                       |
| Documentation + runbook for "user forgot PIN" reset                                     | 1 day                        |
| **Total**                                                                               | **~17 person-days**          |

Plus 1-2 weeks of soak / shadow deploy before flipping the encryption
flag on production tablets.

## 7. Sync question

**Decision point**: do we push ciphertext to Supabase, or decrypt before
push?

| Push ciphertext                                                              | Decrypt before push                                         |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Encryption is end-to-end (E2EE)                                              | Server-side queries, search, FHIR exports still work        |
| Server can't read patient names — RLS becomes structural-only                | Cloud encryption-at-rest is already on (Supabase)           |
| Loses cloud-side analytics, FHIR API, OAuth/SMART                            | Cloud is the source-of-truth; local cache is encrypted only |
| Disaster recovery: if the server is the only copy, it's useless without keys | Standard architecture                                       |

**Recommendation**: decrypt before push. The threat model says we're
protecting against device theft, not cloud breach. Supabase already
encrypts at rest. E2EE is a different feature (separate decision).

## 8. Recommendation

**Conditional GO.** This is worth doing **if** any of the following are
true:

- The device fleet has even one tablet that won't be OS-encrypted (no
  PIN at the OS lock screen, no device admin enforcement).
- A regulator or partner (TEFCA, state Medicaid) explicitly requires
  "encryption-at-rest on all endpoints, including mobile cache".
- Lost-device incidents are non-zero per year.

**HOLD** if all three are false. In that case the security win is small
relative to the UX cost (free-text name search loss). Document the
decision and re-evaluate in 6 months when the fleet has grown.

If the team says **GO**, schedule it as its own ~3-week sprint, behind a
`encryption_v1` feature flag, with a shadow-write period before flip.

## 9. Open questions for the team

1. Is the tablet fleet OS-encrypted today? Who owns confirming?
2. Are there regulatory drivers we don't know about?
3. Are we OK losing free-text name search on tablets, or do we need a
   server-side decrypt fallback (which means devices must be online to
   search by name)?
4. How does this interact with the planned device-key escrow from WS9?
   They share a key-wrapping primitive; doing them together saves work.
