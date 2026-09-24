# Staff authentication and session model: where the app stands

The target model (owner, 2026-09-24): identify the staff member, authenticate
them, load permissions, establish a session, audit actions. A PIN is never an
identity. This page maps each part of the model to the code, and lists what
is still open.

| # | Model requirement | Status | Where |
|---|---|---|---|
| 1 | Individual accounts; server authoritative for identity, role, active status | Done | `public.app_users`; `src/sync/staffRoster.ts`; `readServerStaffAccount` in `src/stores/auth.ts` |
| 2A | Online sign-in: Supabase email and password, server staff record, role, sync allowed | Done (no magic link or MFA yet) | `loginOnline` in `src/stores/auth.ts` |
| 2B | Offline sign-in: choose staff, 6-digit PIN checked only against that account, cached permissions, sync blocked | Done | `login` in `src/stores/auth.ts`; `src/pages/Login.tsx` |
| 3 | PIN is a device credential: salted PBKDF2, device database only, never synced or logged | Done. The signed-in user kept in localStorage no longer carries the hash or salt (`sessionUser`) | `src/utils/pin.ts`, `src/db/devicePin.ts`, `mapToDB` in `src/sync/adapter.ts` |
| 4 | New device needs an online sign-in; no local admin in production | Done | `src/db/offlineAccess.ts`; `/setup` only when online sign-in is not built in |
| 5 | Known to device vs offline access enrolled | Done | `offlineSignInState`; Users > Offline access |
| 6 | PIN enrollment at first online sign-in, no skip; admin-assisted set/reset | Done | `DevicePinSetup` in `Login.tsx`; `src/components/UserManagement.tsx` |
| 7 | "Who's signing in?", then PIN; "Welcome, Ada · Offline mode · Last verified online" | Done | `Login.tsx` (welcome notice and last-verified line) |
| 8 | ONLINE_AUTHENTICATED and OFFLINE_AUTHENTICATED are different; a PIN never creates a cloud session | Done: `authMode` on the auth store and on each session row | `src/stores/auth.ts`; regression suite `src/test/offlinePinNoSync.test.ts` |
| 9 | Back online: "Offline — sign in online to sync"; never "Synced" before the server accepts | Done | `src/lib/cloudSession.ts`, `src/lib/syncIndicator.ts` |
| 10 | Roles composed from permissions, enforced at the action and server layer | Done | `src/auth/roles.ts`, RLS migrations |
| 11 | Offline uses the cached permission snapshot, with `permissions_cached_at` and `last_online_verification` | Done: `permissionsCachedAt`, `lastOnlineVerifiedAt` (device-only fields) | `src/db/index.ts` `User` |
| 12 | Server deactivation disables offline PIN and ends the session; no silent re-enable | Done: roster pull runs on every sync and ends a revoked session; online sign-in refuses a server-deactivated or device-deactivated account | `src/sync/staffRosterSync.ts`, `endSessionIfRevoked` |
| 13 | 6 digits, throttling, 5 failures then 15-minute lockout, audited failures, no PIN in telemetry | Done. The lockout counter is per device, not per account | `src/stores/auth.ts` |
| 14 | Forgot PIN: sign in online, choose a new PIN; or supervised admin reset | Done | "Forgot PIN?" in `Login.tsx`; Users > Reset PIN |
| 15 | Every audit event records user, device, session type, time done | Done for the device audit log (`userId`, `deviceId`, `sessionType` stamped on every row). The device audit log is not uploaded yet, so there is no server `synced_at` for it | `src/stores/auth.ts` (`stampAuditRow`), `src/db/index.ts` `AuditLog` |
| 16 | Device identity (id, name, site, status) | Partly: a stable device id per browser profile, on sessions, audit rows and queue transitions. No device name, enrollment record or server registry yet | `src/db/deviceIdentity.ts` |
| 17 | One origin, https://mbhr.app | Done in the app (banner on other addresses). Still outside the code: Supabase Site URL and redirect URLs, and the m-bhr.vercel.app redirect as 308 | `src/config/canonicalOrigin.ts` |
| 18 | Two explicit modes with their supporting messages | Done | `Login.tsx` |
| 19 | Messages for the actual state (new device, no PINs, this person not enrolled) | Done | `Login.tsx` |

## Still open

- **Magic link and MFA** for online sign-in (section 2A). Needs Supabase Auth
  settings and a decision on which roles require MFA.
- **Server-side audit trail** (section 15): upload the device audit log to a
  server table so it carries `synced_at` next to the device time, as queue
  transitions already do.
- **Device registry** (section 16): device name, site, enrolled and last-seen
  times, status, and a server table to revoke a device.
- **Per-account lockout**: today one device-wide counter covers every account
  on the device, which is stricter than the model but lets one person's typos
  pause sign-in for everyone for 15 minutes.
- **Device reset approval** (`findAdminByPin` in `src/db/deviceReset.ts`)
  still tries the PIN against every active administrator on the device. It is
  not a sign-in, but it should also ask who is approving first.
