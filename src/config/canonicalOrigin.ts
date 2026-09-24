// The one web address staff should use for mBHR.
//
// Everything the app keeps in the browser (the local database with patients,
// the staff list and device PINs) belongs to one web address. The same laptop
// on https://mbhr.app, https://www.mbhr.app and a Vercel deployment URL is,
// as far as that data goes, three different devices. vercel.json redirects
// the other production hostnames here; this module covers what the app
// itself controls: links it sends out and a warning on other addresses.

/** Overridable for a self-hosted deployment on another domain. */
export const CANONICAL_ORIGIN: string = (() => {
  const configured = (import.meta.env.VITE_CANONICAL_ORIGIN as string | undefined)?.trim();
  return configured ? configured.replace(/\/+$/, "") : "https://mbhr.app";
})();

function currentOrigin(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}

/** True for local development servers, where any address is fine. */
function isLocalhost(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

/**
 * True when a production build is running somewhere other than the canonical
 * address (a Vercel preview or per-deployment URL): PINs and records saved
 * here will not be there on mbhr.app.
 */
export function isOffCanonicalOrigin(origin: string = currentOrigin()): boolean {
  if (!origin || import.meta.env.DEV || isLocalhost(origin)) return false;
  return origin !== CANONICAL_ORIGIN;
}

/**
 * Where links that come back into the app (password reset, account emails)
 * should point. Production builds always send people to the canonical
 * address; development keeps the local server.
 */
export function appLinkOrigin(origin: string = currentOrigin()): string {
  if (import.meta.env.DEV || isLocalhost(origin)) return origin;
  return CANONICAL_ORIGIN;
}
