# Televisits

Video visits between a patient and a clinician, built from the mBHR patient portal, the staff app, and a Jitsi Meet room. This guide covers the flows, data model, configuration, deployment, and known limitations.

## What a televisit is

- A televisit is an `appointments` row with `visit_mode = 'televisit'` and a generated `meeting_link`.
- A patient's request for one is a `patient_appointment_requests` row with `visit_mode = 'televisit'` and `appointment_type = 'Televisit'`.
- The call itself runs in Jitsi Meet. mBHR only creates the room URL and shares it; there is no SDK, recording, or in-app video.

## Patient flow

1. The patient signs in to the portal and opens **Telehealth** (`/patient/telehealth`).
2. They submit a request: reason, preferred date and time slot (morning / afternoon / evening), optional notes. This inserts a `patient_appointment_requests` row with status `pending`.
3. Staff schedule the visit (below). The patient receives one SMS with the date, time, and meeting link.
4. The visit then appears under upcoming televisits. **Join** opens the link in a new tab from 10 minutes before the scheduled time until 30 minutes after the scheduled end. Pending requests can be cancelled by the patient; past visits are listed for reference.

## Staff flow

1. Doctors, nurses, and admins open **Televisits** (`/televisits`) from the sidebar. The Doctor Dashboard also shows a **Televisits** button with a badge counting pending requests.
2. Pending requests are listed oldest first. Staff pick a date and time (pre-filled from the patient's preferred date and slot), a duration (default 20 minutes), and schedule, or decline with a note.
3. Scheduling inserts an `appointments` row (`status = 'scheduled'`, `visit_mode = 'televisit'`, fresh `meeting_link`) and marks the request `scheduled` with the reviewer and appointment id. The patient's phone (local Dexie record first, then Supabase) is used to send the `televisit_scheduled` SMS. If the SMS fails the visit is still scheduled and a toast reports the failure so staff can share the link another way.
4. Upcoming televisits show **Join Call** during the same join window, plus status controls (**Start** = in-progress, **Complete**, **No-show**, **Cancel**).
5. The Appointment Calendar also offers **Televisit** as an appointment type; choosing it sets `visit_mode`, generates a meeting link when the appointment is created, and sends the same `televisit_scheduled` SMS (the toast reports whether it was sent).

## Data model

Migration: `supabase/migrations/20260910120000_add_televisits.sql`.

| Table                          | Column                                         | Notes                              |
| ------------------------------ | ---------------------------------------------- | ---------------------------------- |
| `appointments`                 | `visit_mode text NOT NULL DEFAULT 'in_person'` | CHECK `in_person` / `televisit`    |
| `appointments`                 | `meeting_link text`                            | Jitsi room URL; null for in-person |
| `patient_appointment_requests` | `visit_mode text NOT NULL DEFAULT 'in_person'` | Same CHECK                         |

RLS summary:

- Staff (`public.is_staff()` / active `app_users` roles) can read, create, and update `appointments`, and manage all `patient_appointment_requests`.
- Portal patients read and create their own `patient_appointment_requests` through the existing owner policies. The migration adds `patient_appointment_requests_owner_cancel`, which lets a patient set `status = 'cancelled'` on their own pending requests; `cancelTelevisitRequest` treats a zero-row update as an error so the page never reports a cancellation that RLS rejected.
- The migration replaces the staff-only SELECT policy on `appointments` with one combined policy, `appointments_select_staff_or_owner`, so patients can see their own televisits, including the meeting link, without a second permissive SELECT policy. Portal identity is matched by `app_metadata.portal_user_id`, by `patients.auth_uid = auth.uid()` (email/password portal login), or by the JWT phone claim (legacy phone sessions).
- It also replaces the legacy wide-open `Appointments insertable` / `Appointments updatable` policies with `appointments_staff_insert` / `appointments_staff_update` (`is_staff()`), so every staff role that can reach the appointments screen, volunteers included, can still create and update appointments while portal and anonymous sessions cannot.

Service layer: `src/services/televisits.ts` (pure helpers `generateMeetingLink`, `canJoinTelevisit`, `televisitJoinOpensAt`, `isTelevisitServiceAvailable`, plus the patient- and staff-side Supabase calls). Tests: `src/services/televisits.test.ts`.

## Configuration

| Variable                                             | Where                          | Default               | Purpose                                                 |
| ---------------------------------------------------- | ------------------------------ | --------------------- | ------------------------------------------------------- |
| `VITE_TELEVISIT_BASE_URL`                            | app `.env`                     | `https://meet.jit.si` | Jitsi server used to build links (`<base>/mbhr-<uuid>`) |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`        | app `.env`                     | —                     | Required; televisits are online-only                    |
| `TERMII_API_KEY`, `TERMII_SENDER_ID` (or `TWILIO_*`) | Supabase edge function secrets | —                     | SMS provider for the scheduling message                 |
| `SMS_DEMO_MODE`                                      | edge function secret           | unset                 | Log instead of send (development only)                  |

- Anyone can self-host Jitsi Meet. Point `VITE_TELEVISIT_BASE_URL` at your own instance to keep calls on infrastructure you control; the public `meet.jit.si` is fine for pilots but is operated by a third party.
- SMS goes through the `send-sms-reminder` edge function, called with the anon key. Termii/Twilio credentials live only in edge function secrets and are never shipped to the browser.
- The SMS body is the `televisit_scheduled` template. It is currently sent in English (the `en` row, or the built-in fallback in `src/services/messageTemplates.ts`) because the app has no per-patient locale source yet; the migration also seeds pcm, ha, yo and ig rows (`ON CONFLICT DO NOTHING`, so locally edited copies are kept) so localized SMS switches on as soon as `getPatientContact()` in `src/services/televisits.ts` is given a `preferredLanguage`.

## Deploying

```bash
supabase db push                              # applies 20260910120000_add_televisits.sql
supabase functions deploy send-sms-reminder   # only if not already deployed
supabase secrets set TERMII_API_KEY=... TERMII_SENDER_ID=...
```

Then set `VITE_TELEVISIT_BASE_URL` in the app environment if you are not using the default server, and rebuild.

## Connectivity and offline behaviour

- Televisits need Supabase and a network connection. When Supabase is not configured (offline-only install) or `navigator.onLine` is false, the Telehealth and Televisits pages show an explanatory notice and disable request, schedule, and join actions. Nothing is queued for later sync.
- Call quality depends on both parties' bandwidth; Jitsi falls back to audio-only on poor links. Encourage patients to join on Wi-Fi or a stable mobile data connection.
- The staff page refreshes its lists on an interval; there is no push notification for new requests.

## Privacy and safety

- Room ids are random UUIDs (`mbhr-<uuid>`) from `crypto.randomUUID`. URLs never contain names, phone numbers, or other PHI.
- Links are single-purpose but **not authenticated**: anyone holding the URL can enter the room. Treat a meeting link like a private link. Send it only to the patient's verified phone number and never paste it into public channels, group chats, or shared documents.
- On public Jitsi servers the first person to join becomes moderator and can enable a lobby or password from the security menu. Clinicians should join first.
- The SMS contains the patient's name and the link. Keep it short and do not add clinical details.
- Document the consultation in mBHR (SOAP note / visit record) exactly as you would for an in-person visit.

## Limitations and next steps

- No in-app video, waiting room, or call quality metrics; everything after the link is Jitsi.
- Links are not expired server-side; the join window is enforced only in the UI.
- One SMS on scheduling only. No reminder, reschedule, or cancellation SMS yet (the reminder worker could be reused).
- Requests and televisits live in Supabase only and are not available offline.
- Follow-ups worth considering: JWT-authenticated rooms on a self-hosted Jitsi, a reminder SMS shortly before the visit, provider assignment from the request screen, calendar sync, and a WhatsApp fallback via the existing outbox.
