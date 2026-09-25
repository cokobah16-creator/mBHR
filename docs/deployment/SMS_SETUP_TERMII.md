# SMS Setup (Termii)

mBHR sends SMS (medication reminders, follow-up reminders, televisit links,
portal OTPs) through two edge functions: `send-sms-reminder` and
`send-otp-sms`. Both use a shared provider module
(`supabase/functions/_shared/sms/provider.ts`) that prefers **Termii** and
falls back to **Twilio** if only Twilio secrets are set.

Why Termii: naira billing, Nigerian local routes, and a **DND channel** that
delivers to the large share of Nigerian numbers with Do-Not-Disturb enabled.
Messages sent via generic international routes silently disappear for those
subscribers.

## Security model (release blocker)

SMS is sent **only by the server**, **only for a signed-in staff account**,
and **only to the number on the patient's record**.

| Rule | What it means |
| --- | --- |
| Staff sign-in required | Callers send the signed-in user's Supabase **access token** (`Authorization: Bearer <access_token>`) plus the project `apikey`. The anon key alone gets **401 `not_authenticated`**. A PIN-only unlock of an offline workspace has no online session, so it cannot send SMS: the app says "Sign in online to send SMS" and keeps messages queued on the device. |
| Roles | The caller's `app_users` role must be one of `pharmacist`, `doctor`, `nurse`, `lead_clinician`, `admin` (`SMS_SENDER_ROLES` in `supabase/functions/_shared/security/staffAuth.ts`). `volunteer`, `auditor`, `guest` and deactivated accounts get **403 `not_permitted`**. |
| Recipient from the server | The body is `{ patientId, message }` or `{ reminderId }`. The server looks up `patients.phone` or `medication_reminders.phone_number`. A `to` field is ignored. To text a different number, update the patient's record (and sync). |
| Nigerian numbers only | Only Nigerian mobile numbers are sent to (`0803 123 4567`, `+2348031234567`, `2348031234567`). Anything else gets **422 `invalid_recipient`**; no number gets **422 `no_phone`**. |
| Rate limits | 30 SMS/minute per staff user and 5 SMS/hour per recipient number (**429 `rate_limited`** with `Retry-After`), plus a coarse 120/minute per-IP guard. If the limit cannot be checked, nothing is sent (**503 `rate_limit_unavailable`**). |
| No double texts | A stored reminder already marked `sent` gets **409 `already_sent`** and is not sent again. |
| Outcome recorded by the server | For `{ reminderId }` the function (service role) writes the result to `medication_reminders`: `sent` + `sent_at` + the marker `accepted by sms provider (<id>)` only after the provider accepted it; `failed` + a code when the provider rejected it, demo mode only logged it, or the stored number or text is unusable. When no provider is configured (503 `sms_not_configured`) nothing is recorded: the reminder stays `pending` and is tried again by a later send run, so it can go out (late) once a provider is set up. Devices no longer write reminder status (RLS lets only `dispense` holders update that table). |
| Logs | Logs and error bodies never contain the full number or the message text. |

Other error codes the app explains to staff: `patient_not_found` (404: sync
the patient first), `staff_lookup_failed` and `lookup_failed` (503: try
again shortly).

## Setup steps

### 1. Register your sender ID first (approval takes days)

1. Create an account at [termii.com](https://termii.com) and get your API key
   from the dashboard.
2. Request a **Sender ID** (max 11 characters, e.g. `mBHR` or your org name)
   under *SMS → Sender ID*. You must describe the use case and sample messages
   (e.g. "Medication reminders and clinic follow-up notifications for a free
   medical outreach program").
3. Approval typically takes **2–5 working days**. Start this before the rest
   of the setup. Until it is approved, sends fail with a sender ID error.

### 2. Set the secrets (server only)

```bash
supabase secrets set \
  TERMII_API_KEY="TL...your key..." \
  TERMII_SENDER_ID="mBHR" \
  RATE_LIMIT_KEY_SALT="$(openssl rand -hex 32)" \
  --project-ref <your-project-ref>
```

| Secret | Required | Notes |
| --- | --- | --- |
| `TERMII_API_KEY` | Yes | Termii API key. Server secret only. |
| `TERMII_SENDER_ID` | Yes | Approved sender ID. |
| `RATE_LIMIT_KEY_SALT` | Yes | Random secret used to hash phone numbers in the rate-limit table (the number space is small enough to brute-force an unsalted hash). |
| `TERMII_CHANNEL` | No (default `dnd`) | Use `dnd` for transactional health messages; `generic` is cheaper but blocked for DND subscribers. |
| `TERMII_BASE_URL` | No (default `https://api.ng.termii.com`) | Only if Termii assigns you a different API host. |
| `SMS_DEMO_MODE` | No (unset) | `true` = log instead of send. Never set this in production. |

Twilio fallback (used only when the Termii secrets are absent):
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`.

**No SMS variables in the web app.** There must be no `VITE_TERMII_*`,
`VITE_TWILIO_*` or any other `VITE_` SMS variable: every `VITE_` variable is
built into the public JavaScript bundle. The browser never holds provider
keys and never calls Termii directly.

**Rotate any exposed key.** If a Termii (or Twilio) key was ever set as a
`VITE_` variable, in `.env` files committed to git, or in a Vercel/Netlify
build environment, treat it as public: revoke it in the Termii dashboard,
issue a new one, set it with `supabase secrets set`, and remove the old
`VITE_` variable from every environment.

### 3. Deploy the functions with JWT verification on

```bash
supabase functions deploy send-sms-reminder send-otp-sms --project-ref <your-project-ref>
```

Do **not** pass `--no-verify-jwt`, and do not set `verify_jwt = false` for
these functions in `supabase/config.toml`. The platform check rejects
requests without a valid JWT before the function runs; the function then
checks that the token is a real staff user (not the anon key) with an
allowed role.

### 4. Seed the message templates

Localized SMS bodies (en, ha, yo, ig, pcm) live in the `message_templates`
table and are seeded by the live seed script (see `scripts/seed/`). The app
falls back to built-in English bodies if the table is empty, but the local
languages only work once templates are seeded.

### 5. Send one real test SMS end to end

1. Create (or pick) a **test patient** on the server whose phone number is a
   Nigerian mobile handset you can check. Never use a real patient.
2. Run the script as a staff user whose role may send SMS:

```bash
MBHR_STAFF_EMAIL="pharmacist@example.org" \
MBHR_STAFF_PASSWORD="..." \
npm run test:sms -- <test-patient-id>
```

The script signs in, sends `{ patientId, message }` with the user's access
token, and prints the provider and message ID. It exits non-zero if the
function is unconfigured, still in demo mode, or refuses the request (it
prints what the error code means). "Accepted by the provider" is not
delivery: the test only passes when the SMS arrives on the handset.

Also check the refusals: the same call with the anon key as the bearer token
must return 401, and with a `volunteer` account must return 403.

## Phone number format

Store numbers on the patient record in any of these forms: `0803 123 4567`,
`+2348031234567`, `2348031234567` (and `+234 0803...`, a common slip). The
server normalises them to `2348031234567` and refuses anything that is not a
Nigerian mobile number.

## Notes

- `api.ng.termii.com` is in the CSP `connect-src` allow-list (`vercel.json`),
  but that is not load-bearing: all provider calls happen server-side in the
  edge functions, never from the browser.
- OTP messages are localized via the `locale` field in the `send-otp-sms`
  request body (falls back to English).
- When no provider is configured the function returns `success: false`,
  `error: "sms_not_configured"` (HTTP 503) instead of pretending the SMS went
  out. Demo mode (`SMS_DEMO_MODE=true`) is an explicit opt-in for demos and
  local development only; the app shows those messages as not sent.
