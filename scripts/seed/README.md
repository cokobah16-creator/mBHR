# Live database seed

Bootstraps an **empty production Supabase project** with everything a first
outreach day needs. One command, idempotent, safe to re-run.

## What it seeds

| Table | Content | Idempotency key |
| --- | --- | --- |
| `organizations` | your organization | `slug` |
| `sites` | your first outreach site | `(org_id, site_code)` |
| `auth.users` + `staff_roles` + `app_users` + `user_org_sites` | one full identity per staff member — email/password online login, `is_staff()` RLS access, org membership | email / auth uuid |
| `users` | canonical staff PIN roster (PBKDF2 hash + salt, same derivation as the app) | deterministic id from email |
| `pharmacy_items` | 52-item dispensing catalog from the Nigeria EML (on-hand = 0 until restock) | deterministic id |
| `site_formulary` | the same catalog scoped to your site, with typical stock levels and reorder thresholds | `(org, site, name, strength)` |
| `protocol_library` | 3 field protocols: uncomplicated malaria (AL weight bands), hypertension at outreach, childhood diarrhoea (ORS/zinc) | deterministic uuid |
| `prescription_templates` | 8 quick-pick prescriptions aligned with the formulary | `(org_id, name)` |
| `message_templates` | SMS bodies for 6 keys × 5 languages (en, ha, yo, ig, pcm) | `(key, locale, channel)` |
| `outreach_events` + `event_staff_assignments` | your first outreach day with the roster assigned to stations | deterministic uuid |

`vitals_ranges` is already migration-seeded and is left alone.

## How to run

```bash
cp scripts/seed/roster.example.json scripts/seed/roster.json
# edit roster.json: real org name, site, staff names/emails/roles, event date

# .env.local or environment:
#   SUPABASE_URL=https://<project-ref>.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=...   (dashboard → Project Settings → API)

npm run seed:live -- --dry-run   # review the plan
npm run seed:live
```

The script **requires the service role key**: the multi-tenant RLS policies
are self-referential (you must already be an org member to insert org rows),
so only `service_role` can bootstrap the first rows. Never put this key in a
`VITE_*` variable or commit it.

## PINs and passwords

- Staff PINs (6-digit) and passwords are optional in `roster.json`. Anything
  omitted is generated and printed **once** at the end of the run — record
  them immediately.
- Re-runs never rotate an existing PIN or password unless `roster.json`
  specifies one explicitly.
- `roster.json` is gitignored. Never commit real PINs or passwords.

## What it deliberately does NOT do

- **Device PIN provisioning.** Clinic devices verify PINs against their local
  (offline) database; the sync layer does not carry PIN hashes. After seeding,
  log in as admin on each device and create the staff in User Management using
  the printed PINs. The cloud `users` table is the canonical roster.
- **Stock quantities.** `on_hand_qty` starts at 0; enter real counts through
  the restock flow when packing for the outreach day. Reorder thresholds are
  seeded so low-stock alerts work as soon as stock is entered.
