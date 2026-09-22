# mBHR Caching & CDN Strategy

This is the durable record of how mBHR caches static assets and runtime
network responses. Update it whenever you change `vite.config.ts` PWA
config or `vercel.json` headers, so the next person who reads it knows
why each cache is shaped the way it is.

## Edge / CDN (Vercel)

`vercel.json` sets these response headers:

| Path            | `Cache-Control`                       | Why                                                                                                                         |
| --------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `/assets/*`     | `public, max-age=31536000, immutable` | Vite emits content-hashed filenames (`index.abc123.js`), so any change yields a new file. One-year immutable cache is safe. |
| `/sw.js`        | `public, max-age=0, must-revalidate`  | The service worker is the kill-switch — if it goes stale, clients can be stuck on old code. Always revalidate.              |
| everything else | (default — Vercel CDN choice)         | HTML responses are short-cached and revalidated; we don't override.                                                         |

`vercel.json` also sets a strict CSP that limits `connect-src` to
`*.supabase.co` plus a couple of CDN hosts. New external API endpoints
must be added there or the browser will block them.

## Service worker (Workbox via `vite-plugin-pwa`)

Precaching is configured in `vite.config.ts`:

```
globPatterns: ["**/*.{js,css,html,ico,png,svg,mp3}"]
maximumFileSizeToCacheInBytes: 3000000
```

That captures the app shell. Runtime caching is then tuned per host:

| URL pattern                       | Strategy               | Why                                                                                                                                   |
| --------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `https://*.supabase.co/rest/*`    | `NetworkFirst` (5s)    | PostgREST queries. Try network for 5s for fresh data; fall back to cache if offline or slow. Max 100 entries, 24h TTL.                |
| `https://*.supabase.co/storage/*` | `StaleWhileRevalidate` | Patient photos & exports — rarely change once uploaded. Serve cached immediately, refresh in the background. Max 200 entries, 7d TTL. |
| `https://cdn.jsdelivr.net/*`      | `CacheFirst`           | Third-party static assets (fonts, libraries). Long-lived. Max 50 entries, 30d TTL.                                                    |

All entries cache responses with status `0` (opaque/CORS) and `200`.

## What we do NOT cache

- **Supabase Auth endpoints** (`/auth/v1/*`). Token refresh and sign-in
  must always hit the live server.
- **Edge functions** (`/functions/v1/*`). They have their own
  rate-limiting and side-effects; caching POSTs is a foot-gun.
- **PostgREST writes**. Workbox `NetworkFirst` is the SELECT path; PUT /
  POST / DELETE go through the offline outbox (`src/db/outbox.ts`) when
  there's no network, not Workbox.

## Cache-busting on deploy

Service-worker `registerType: "autoUpdate"` means a new build's SW
takes over within a few seconds of a page reload. The
`GlobalErrorBoundary` already includes a "Clear cached data & reload"
button that unregisters all service workers + clears caches +
deletes IndexedDB — use it during an incident if a deploy goes bad.

## Open follow-ups

- [ ] Move the `connect-src` allowlist in `vercel.json` to an env-var
      driven file so staging vs production CSPs can differ without code
      changes. Currently both share one string.
- [ ] Add a cache-busting header to `index.html` so it never sticks in
      an intermediate CDN. Vercel handles this by default but it's worth
      asserting explicitly.
