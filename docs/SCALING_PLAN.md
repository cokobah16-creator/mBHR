# mBHR Scaling Plan

mBHR's current load profile is small — a few outreach events per week,
hundreds of patients per event, primarily writes from a handful of
tablets per site. Auto-scaling on Vercel (frontend) and Supabase
(Postgres + Storage) covers that today without intervention. This
document records the **trigger metrics** and the **architectural
choices** to make when we cross those triggers, so we don't need to
think under pressure.

## Today's profile

| Signal                    | Approx. value | Source                            |
| ------------------------- | ------------- | --------------------------------- |
| Active devices (peak)     | ~50           | Site planning                     |
| Patient records           | <50k          | `SELECT count(*) FROM patients;`  |
| Daily Supabase RPC calls  | <100k         | Dashboard → Database → Statistics |
| Edge function invocations | <10k/day      | Dashboard → Edge Functions → Logs |
| Sustained Postgres CPU    | <30%          | Dashboard → Database → CPU        |

All comfortably inside Supabase's free / Pro plan. No action needed.

## Trigger metrics — investigate when

| Signal                              | Threshold                  | First action                                                                                           |
| ----------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------ |
| Sustained Postgres CPU              | > 70% for 1 h              | Find the offending query via `pg_stat_statements`; add an index or rewrite                             |
| Connection-pool usage (PgBouncer)   | > 80% of `max_client_conn` | Move browser clients to PostgREST only; keep pooled connections for edge functions and CLI tooling     |
| p95 PostgREST latency               | > 500ms for 15 min         | Check whether RLS policies are re-evaluating per row (`auth_rls_initplan`) — wrap in `(SELECT ...)`    |
| Edge-function cold-start tail (p99) | > 2s                       | Reduce bundle size; pre-warm with cron ping (`GET /` every 60s)                                        |
| Realtime channel count              | > 200 concurrent           | Move to broadcast-only channels; or shard by site                                                      |
| Storage egress                      | > 50 GB/month              | Move large patient-photo serving to a CDN in front of Supabase Storage; lazy-load thumbnails in the UI |

Capture each crossing as an issue with the offending metric in the body
so the response is auditable.

## Architectural choices when we scale

### Read replicas

Supabase exposes read replicas on the Pro plan and above. The mBHR
client already uses two distinct surface areas — `src/services/*` for
mutations, `src/sync/adapter.ts` pull cursors for reads — so routing the
read side at a replica is a relatively small change:

1. Add `VITE_SUPABASE_READ_URL` env var (optional; falls back to primary).
2. In `src/lib/supabaseClient.ts`, build two clients: `supabase` (writes) and `supabaseRead` (reads).
3. Switch the pull cursors in `src/sync/adapter.ts` to use `supabaseRead`. Leave writes on the primary.

Trigger: sustained > 70% read load with the primary CPU > 70% for 1 h.

### Connection pooling

Today the `@supabase/supabase-js` browser client uses PgBouncer
transaction mode via Supabase's hosted pooler. That's fine until
~10k concurrent users. If we hit that:

- Set `db_pool_size = 30, max_client_conn = 1000` in the pooler config.
- Edge functions reuse a single `createClient` instance per cold-start
  (already true in the code we have).
- Avoid `LISTEN/NOTIFY` from edge functions — those keep connections
  pinned outside the pool.

### Edge vs server functions

Supabase Edge Functions run on Deno Deploy globally. For mBHR's mostly
write-heavy + email/SMS workloads, edge is the right default. If we
ever add a CPU-heavy workload (PDF generation, ML inference) it should
move to a queued background job, not become a slow edge function.

### Frontend scaling

Vercel auto-scales the static frontend with no intervention. The PWA
service worker means returning users barely touch the network for static
assets at all. The only frontend scaling concern is bundle size; the
`analyze` npm script (`vite build && stats.html`) is the diagnostic.

## What we are NOT doing (and why)

- **Sharding Postgres**. Premature for a single-org deployment. Revisit
  if we add multi-tenant cross-org reporting at > 1 M rows per table.
- **Custom CDN in front of Supabase**. Vercel + Workbox cover the
  90th-percentile case. Add Cloudflare only if Storage egress is the
  bottleneck.
- **Kubernetes / self-hosting**. Cost > value for this profile.

## Review cadence

Re-read this doc at the start of every quarter against the dashboard
graphs. Move any "trigger metric" we crossed since last quarter into
the "today's profile" table with the action we took.
