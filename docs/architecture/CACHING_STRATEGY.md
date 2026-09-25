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

| URL pattern                  | Strategy      | Why                                                                                                                                         |
| ---------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `https://*.supabase.co/*`    | `NetworkOnly` | Database, sign-in, storage and functions. Answers carry patient records, photos and the staff directory, so none is kept in Cache Storage. |
| `https://cdn.jsdelivr.net/*` | `CacheFirst`  | Third-party static assets (fonts, libraries). Long-lived. Max 50 entries, 30d TTL. Caches status `0` (opaque/CORS) and `200`.              |

## What we do NOT cache

- **Anything from Supabase.** On a shared tablet a cached answer could be
  served to the next person, or an old staff directory could switch a
  deactivated account back on. Offline work reads and writes the local
  database (IndexedDB) and syncs through the outboxes instead.
- Builds before this change cached Supabase answers in `supabase-rest` and
  `supabase-storage`. `src/services/clearApiCaches.ts` deletes every cache
  except the Workbox precache and `jsdelivr`: at start-up, on staff and
  patient-portal sign-out, and on device reset.

## Updates on deploy

`registerType: "prompt"` with `skipWaiting: false`: a new build's service
worker installs in the background and waits. The app registers it itself
(`src/lib/serviceWorker.ts`, `injectRegister: null`), checks for a new
version hourly while online, and shows "A new version of mBHR is ready"
(`src/components/AppUpdateBanner.tsx`). The new version takes over only
when someone chooses **Reload now**, so a deploy never reloads the app in
the middle of entering a record. Until then the old worker keeps serving
the files of the version that is running.

When a window on the new version upgrades the local databases, windows
still on the old version close their connection and ask to be reloaded
(`src/db/versionChange.ts`), since they can no longer save.

The error screen's "Clear cached data & reload" button unregisters the
service workers and clears Cache Storage; it does not delete IndexedDB.

## Open follow-ups

- [ ] Move the `connect-src` allowlist in `vercel.json` to an env-var
      driven file so staging vs production CSPs can differ without code
      changes. Currently both share one string.
- [ ] Add a cache-busting header to `index.html` so it never sticks in
      an intermediate CDN. Vercel handles this by default but it's worth
      asserting explicitly.
