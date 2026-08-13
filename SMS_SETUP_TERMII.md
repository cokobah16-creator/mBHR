# SMS Setup (Termii)

mBHR sends SMS (medication reminders, follow-up reminders, portal OTPs) through
two edge functions: `send-sms-reminder` and `send-otp-sms`. Both now use a
shared provider module (`supabase/functions/_shared/sms/provider.ts`) that
prefers **Termii** and falls back to **Twilio** if only Twilio secrets are set.

Why Termii: naira billing, Nigerian local routes, and a **DND channel** that
delivers to the large share of Nigerian numbers with Do-Not-Disturb enabled —
messages sent via generic international routes silently disappear for those
subscribers.

## ⚠️ Behavior change: no more silent demo mode

Previously, if no SMS secrets were set, `send-sms-reminder` returned
`success: true, demo: true` — reminders were marked **sent** while nothing was
delivered. Now:

- **No provider configured** → the function returns `success: false` with
  `error: "sms_not_configured"` (HTTP 503 for reminders). Reminder rows are
  marked `failed` with the reason, and the queue UI shows it.
- **Demo mode is explicit opt-in**: set the secret `SMS_DEMO_MODE=true` to get
  the old log-only behavior (for demos and local dev only).

## Setup steps

### 1. Register your sender ID first (approval takes days)

1. Create an account at [termii.com](https://termii.com) and get your API key
   from the dashboard.
2. Request a **Sender ID** (max 11 characters, e.g. `mBHR` or your org name)
   under *SMS → Sender ID*. You must describe the use case and sample messages
   (e.g. "Medication reminders and clinic follow-up notifications for a free
   medical outreach program").
3. Approval typically takes **2–5 working days** — start this before the rest
   of the setup. Until it is approved, sends will fail with a sender ID error.

### 2. Set the secrets

```bash
supabase secrets set \
  TERMII_API_KEY="TL...your key..." \
  TERMII_SENDER_ID="mBHR" \
  --project-ref <your-project-ref>
```

Optional:

| Secret | Default | Notes |
| --- | --- | --- |
| `TERMII_CHANNEL` | `dnd` | Use `dnd` for transactional health messages; `generic` is cheaper but blocked for DND subscribers. |
| `TERMII_BASE_URL` | `https://api.ng.termii.com` | Only if Termii assigns you a different API host. |
| `SMS_DEMO_MODE` | unset | `true` = log instead of send. Never set this in production. |

Twilio fallback (used only when the Termii secrets are absent):
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`.

### 3. Redeploy the functions

```bash
supabase functions deploy send-sms-reminder send-otp-sms --project-ref <your-project-ref>
```

### 4. Seed the message templates

Localized SMS bodies (en, ha, yo, ig, pcm) live in the `message_templates`
table and are seeded by the live seed script (see `scripts/seed/`). The app
falls back to built-in English bodies if the table is empty, but the local
languages only work once templates are seeded.

### 5. Send one real test SMS end-to-end

```bash
npm run test:sms -- "+2348012345678"   # a real handset you can check
```

The script exits non-zero if the function is unconfigured **or** still in demo
mode, and prints the provider + message ID on success. The test is only passed
when the SMS actually arrives on the handset.

## Scheduler: what actually fires the reminders

Scheduled reminders are drained **server-side** every 5 minutes: a pg_cron
job (migration `20260813190000_add_reminder_flush_cron.sql`) POSTs via
pg_net to the `flush-reminders` edge function, which sends due
`medication_reminders` and `outbound_messages` rows through the provider and
marks them sent/failed (up to 3 attempts, growing retry delay). Before this,
reminders only went out while a pharmacist had the SMS screen open in a
browser.

Setup:

```bash
supabase functions deploy flush-reminders --no-verify-jwt --project-ref <ref>
supabase db push   # applies the cron migration
```

Verify it is running:

```sql
select jobname, schedule, active from cron.job;                         -- job exists
select status, created from net._http_response order by id desc limit 5; -- recent calls
select status, count(*) from medication_reminders group by status;       -- rows draining
```

Notes:

- `flush-reminders` is deployed with JWT verification off so the cron call
  needs no stored key. The drain is rate-limited and benign (it only sends
  reminders that are already due); all writes happen with the service role
  inside the function.
- With no provider configured the flusher leaves rows `pending` and reports
  `sms_not_configured` — nothing is falsely marked sent.
- Forks: the function URL inside the migration embeds this project's ref
  (same as `supabase/config.toml`) — update both when forking.

## Phone number format

The provider module normalizes Nigerian numbers automatically:
`0803 123 4567`, `+2348031234567` and `2348031234567` all become
`2348031234567`. Store numbers in any of these forms.

## Notes

- `api.ng.termii.com` is already in the CSP `connect-src` allow-list
  (`vercel.json`), but that is not load-bearing: all provider calls happen
  server-side in the edge functions, never from the browser.
- OTP messages are localized via the `locale` field in the `send-otp-sms`
  request body (falls back to English).
