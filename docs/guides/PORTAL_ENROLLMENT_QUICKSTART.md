# Portal Enrollment Quick Start Guide

What staff and administrators can do to give a patient portal access, and
what the patient does next. Portal accounts are for adults only: the app
refuses portal access, invitations and sign-up for anyone under 18 by their
date of birth.

## For Clinical Staff

Staff whose role can register patients (registration volunteer, nurse,
doctor, administrator) can do this.

### During registration

1. Fill in the patient's details. Add an email address or a phone number.
2. Tick "Enable patient portal access". You cannot tick it for a patient
   under 18.
3. Tick "I have explained portal access terms to the patient and they
   agree".
4. Save. mBHR then tries to make a portal account on the server. This
   needs an internet connection and can fail, for example before the
   patient's record is uploaded. No message is sent to the patient, and
   the patient's record on this device still shows portal access as off.
   If the form stops to ask about a possible duplicate and you create a new
   patient, it does not try.

To turn access on, send an invitation or share a registration link, use the
patient's record afterwards.

### On the patient's record

The "Patient portal" card shows whether access is on, the contact method,
the last portal sign-in and the invitation count.

- **Portal access switch.** Turning access on asks you to tick that the
  patient agreed. The change is saved on this device. It also goes to the
  server, which the online portal checks, only when the device is online,
  you are signed in online (not just unlocked with a PIN), and the patient's
  record is already on the server. The message after the change says which
  happened. Other staff devices are not updated. For a patient under 18 the
  switch can only turn access off.
- **Send portal invitation.** Shown when access is on and the patient has
  an email. The server emails a registration link. It sends only when this
  device is online and you are signed in online, and only if email is set
  up on the server. When no email goes out, the card says so, gives the
  reason when it knows it, and shows the link for you to share.
- **Create registration link.** Shown instead when the patient has no email,
  or the device is offline or has no server connection. Invitations are
  never sent by SMS. Share the link yourself: read it out, show it on
  screen, or send it by WhatsApp or SMS.
- After a send, you can send again after 60 seconds.

## What the Patient Does

1. Open the registration link, or go to `/patient/login` and choose
   "Register here". The link fills in the email or phone number.
2. Enter a full name, an email address, a date of birth and a password,
   and tick the three consent boxes. An email address is always required.
   On a device with no server connection, a 6-digit PIN replaces the
   password. People under 18 cannot register.
3. Sign in at `/patient/login` with their email and password (or email and
   PIN on a device with no server connection).

Linking to the clinic record:

- Online, sign-up links the account to the clinic record with the same
  email address, or with the same phone number and date of birth. A patient
  the clinic has only a phone number for must enter that phone number and
  the date of birth on their record. Otherwise sign-up tries to make a new,
  empty record that is not linked to the clinic's. A child's record is
  never linked.
- The patient sees their clinic records in the online portal only while
  portal access is on for that record on the server.
- On a device with no server connection, registration looks for a record
  on that device with the same email or phone number. It links to it only
  if portal access is on for it and the date of birth matches, and refuses
  otherwise. With no match it makes a new record.

## For Administrators

Only an administrator can use these pages.

- **Patient portal overview** (`/admin/portal-dashboard`). Counts and a
  searchable list from the patient records on this device: portal enabled,
  verified, pending verification, active in the last 30 days, and invited.
- **Enable portal access** (`/admin/portal-migration`). Turns access on for
  patients stored on this device. Filter by registration date, state and
  contact method; patients under 18 are left out. "Enable access only"
  sends nothing. "Enable and send invitations" also requests an email for
  each patient who has one, with the same limits as the record page; the
  server sends at most about 10 emails a minute from one internet
  connection. Access goes to the server under the same conditions as the
  record page switch. You can download a CSV report of the run.
- **Create portal accounts on the server**
  (`/admin/bulk-portal-migration`). Works on the server's patient records,
  online only. Lists up to 100 of the newest patients with an email or
  phone number and no portal access; patients under 18 are left out. It
  uses the same server step as the registration form, so it can fail the
  same way; the result lists why. No invitation is sent: tell patients to
  register as described above.

Only use these pages for patients who agreed to use the portal. The pages
do not ask them.

## Troubleshooting

- **The portal box is greyed out on the registration form.** The date of
  birth entered makes the patient under 18.
- **The button says "Create registration link" for a patient with an
  email.** The device is offline or has no server connection.
- **"No email was sent".** The card gives the reason when it knows it: you
  are not signed in online, the server does not accept your staff account,
  or the server is not set up to send email. Share the link shown.
- **"Resend available in …".** Wait for the 60-second countdown.
- **The patient registered but sees none of their records.** Check that
  portal access is on for their record on the server, and that they
  registered with the email on their record, or with its phone number and
  date of birth.
- **The patient is under 18.** Sign-up refuses them, and a child's record
  cannot be linked to an account. The messages send a parent or guardian to
  clinic staff.

## Technical Details

- Invitations are sent at once by `sendPortalInvitation`
  (`src/services/portalEnrollment.ts`) through the `send-otp-email` Edge
  Function. Nothing queues or retries them.
- `send-otp-email` needs `RESEND_API_KEY` (and optionally `SENDER_EMAIL`) on
  the server. Without it, it sends nothing and the card says email is not
  set up.
- The portal sync worker (`src/services/portalSyncWorker.ts`) runs every 30
  seconds while the app is open and online. It copies portal activity (a
  linked account, a verified contact, the last portal activity) from the
  server for patients with access on. It sends no invitations.
- The rule for "under 18" is `isMinor` in `src/utils/patient.ts`.

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
