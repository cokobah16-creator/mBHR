# Portal Enrollment Quick Start Guide

What staff and administrators can do to give a patient portal access, and
what the patient does next. Portal accounts are for adults only: the app
refuses portal access, invitations and sign-up for anyone under 18 by their
date of birth.

Portal access is decided by the clinic server. When you turn it on or off,
the change is saved on this device, shown as "waiting for the server", and
queued. It is sent to the server (`set_patient_portal_access`) only while
you are signed in online on this device (a PIN unlock is not enough). The
server confirms it or refuses it, and the patient's record shows the answer.
On a device with no server connection, the change stays on that device.

## Who can do what

- **Turn portal access on or off** (`portal_manage`): registration
  volunteer, nurse, doctor, registration lead, lead clinician and
  administrator.
- **Send portal invitations** (`portal_invite`): registration lead, lead
  clinician and administrator. The server checks this again.

## For Clinical Staff

### During registration

1. Fill in the patient's details. Add an email address or a phone number.
2. Tick "Enable patient portal access" only if the patient agrees. It is
   never ticked for you, and you cannot tick it for a patient under 18.
3. Tick "I have explained portal access terms to the patient and they
   agree".
4. Save. Portal access is asked for:
   - Online, mBHR first makes a portal account on the server
     (`patient_portal_users`), then queues the access request. On a server
     built from `supabase/migrations`, that insert fails (it sends columns
     the table does not have), and the message says portal enrolment
     failed; turn access on from the patient's record instead.
   - Offline, it only queues the access request.
   - With no server connection, access is turned on for this device only.

   If the form stops to ask about a possible duplicate and you create a new
   patient, it does not ask for portal access.

The form sends no invitation and has no box for one. Send it from the
patient's record once the server has confirmed access.

### On the patient's record

The "Patient portal" card shows whether access is on, where the decision
stands (waiting for the server, confirmed by the server, refused by the
server, or kept on this device only), the contact method, the last portal
sign-in and the invitation count.

- **Portal access switch.** Turning access on opens a dialog: tick
  "*Name* has agreed to use the patient portal." before "Turn on access"
  can be pressed. The tick is not stored on the server: the request
  carries only the reason code `staff_choice`. Turning access off asks you
  to confirm. If you are not signed in online, the card says the change is
  queued and sent to the server when you sign in online. For a patient
  under 18 the switch can only turn access off.
- **Send portal invitation.** Shown when access is on and your role may
  send invitations; it can be pressed once the server has confirmed
  access. The server looks up the
  stored contact and sends by email if the patient has an email address,
  otherwise by SMS. It builds the text and link itself and records who
  sent it. It sends only for staff signed in online. When no message goes
  out (not signed in online, the email or SMS service is not set up or
  fails), the card shows the registration link for you to share.
- **Create registration link.** Shown instead when the device is offline or
  has no server connection. Share the link yourself: read it out, show it
  on screen, or send it by WhatsApp or SMS.
- After a send, you can send again after 60 seconds. The server also limits
  how many invitations one account and one patient can get.
- A patient under 18 gets no invitation and no registration link.

## What the Patient Does

1. Open the registration link, or go to `/patient/login` and choose
   "Register here". The link fills in the email or phone number.
2. Enter a full name, an email address, a date of birth and a password,
   and tick the three consent boxes. A phone number is optional. An email
   address is always required. On a device with no server connection, a
   6-digit PIN replaces the password. People under 18 cannot register.
3. If asked, confirm the email address with the link sent to it.
4. Sign in at `/patient/login` with their email and password (or email and
   PIN on a device with no server connection).

Linking to the clinic record (online):

- The server (`portal_link_patient_record`) links the new account to the
  clinic record whose email address is the account's confirmed email, when
  portal access is on for that record and the date of birth matches. A
  phone number typed at registration is not used to find the record, so
  for a patient the clinic has only a phone number for, add their email to
  their record before they register. The SMS invitation says to use the
  phone number and date of birth; the patient still needs that email.
- If no clinic record matches, the server makes a new record for the
  account. It is not the clinic's record.
- A child's record is never linked, and no record is made for an under-18
  date of birth. The patient is told to ask clinic staff.
- The patient can use the online portal only while portal access is on for
  that record on the server.

On a device with no server connection, registration looks for a record on
that device with the same email or phone number. It links to it only if
portal access is on for it and the date of birth matches, and refuses
otherwise. It never links a child's record. With no match it makes a new
record.

## For Administrators

Only an administrator can use these pages.

- **Patient portal overview** (`/admin/portal-dashboard`). Counts and a
  searchable list from the patient records on this device: portal enabled,
  verified, pending verification, active in the last 30 days, and invited.
- **Enable portal access** (`/admin/portal-migration`). Asks the server to
  turn access on for patients stored on this device. Filter by
  registration date, state and contact method; patients under 18 are left
  out. "Enable access only" queues the requests. "Enable and send
  invitations" sends the queued requests once, then invites only the
  patients whose access the server confirmed; it needs you signed in
  online. The result follows the server's answers. You can download a CSV
  report of the run.
- **Create portal accounts on the server**
  (`/admin/bulk-portal-migration`). Works on the server's patient records,
  online only. Lists up to 100 of the newest patients with an email or
  phone number and no portal access; patients under 18 are left out before
  the limit. It makes a portal account on the server for each one and asks
  for access, like the registration form, so it can fail the same way; the
  result lists why and follows the server's answers. No invitation is
  sent: tell patients to register as described above.

Only use these pages for patients who agreed to use the portal. The pages
do not ask them, and no record of their agreement is stored.

## Troubleshooting

- **The portal box is greyed out on the registration form.** The date of
  birth entered makes the patient under 18.
- **"Waiting for the server" does not go away.** The change is sent only
  while the person who made it is signed in online and the device syncs.
  If the server has not answered, it is sent again at each sync.
- **"The server refused the last change".** The card shows the server's
  reason and its current setting.
- **"Invitations can be sent once the server confirms portal access."**
  Wait for the server's answer.
- **"No email or SMS was sent".** Share the link shown. Check that you are
  signed in online and that email (`RESEND_API_KEY`) or SMS is set up on
  the server.
- **"Resend available in …".** Wait for the 60-second countdown.
- **The patient registered but sees none of their records.** Check that
  portal access is on for their record on the server, that the record has
  their email address, and that they confirmed it.
- **The patient is under 18.** Sign-up refuses them, and a child's record
  cannot be linked to an account. The messages send a parent or guardian to
  clinic staff.

## Technical Details

- Portal access: `requestPortalAccessChange` (`src/services/portalAccess.ts`)
  queues `set_patient_portal_access`
  (`supabase/migrations/20260925100100_portal_access_authoritative.sql`)
  in the command outbox (`src/sync/commandOutbox.ts`). A guard trigger
  puts back `patients.portal_enabled` when an API write tries to change it
  directly. Auto-enrolment on insert is off
  (`20260926120000_consent_defaults_off.sql` sets `auto_enrollment_enabled`
  to false).
- Invitations: `sendPortalInvitation` (`src/services/portalEnrollment.ts`)
  calls `send-otp-email` or `send-sms-reminder` with purpose
  `portal_invitation` and the patient id. The server checks the role and the
  patient with `portal_invitation_begin()` and records the outcome with
  `portal_invitation_finish()`
  (`20260925100600_registration_lead_portal_invite.sql`). Nothing queues or
  retries them.
- Children are refused in the app (`isMinor` in `src/utils/patient.ts`) and
  by `portal_link_patient_record`
  (`20260926120100_portal_link_adults_only.sql`).
  `set_patient_portal_access` and `portal_invitation_begin` do not check age
  yet.
- `send-otp-email` needs `RESEND_API_KEY` (and optionally `SENDER_EMAIL`) on
  the server. Without it, it sends nothing and the card shows the link.
- The portal sync worker (`src/services/portalSyncWorker.ts`) runs every 30
  seconds while the app is open and online. It copies portal activity (a
  linked account, a verified contact, the last portal activity) from the
  server for patients with access on. It sends no invitations.

### Configuration

```bash
# Wait between invitations to the same patient (milliseconds)
VITE_INVITE_RATE_MS=60000  # Default: 60 seconds

# Server connection. Leave empty for a device with no server.
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
```

## URLs

- **Patient portal overview**: `/admin/portal-dashboard`
- **Enable portal access**: `/admin/portal-migration`
- **Create portal accounts on the server**: `/admin/bulk-portal-migration`
- **Patient login**: `/patient/login`
- **Patient registration**: `/patient/register`
