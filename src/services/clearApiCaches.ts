/**
 * Removes server answers kept in Cache Storage.
 *
 * Earlier builds of the service worker kept Supabase answers (patient
 * records, photos, the staff directory) in Cache Storage and could serve
 * them to the next person on a shared device, or bring back an old staff
 * list. The current service worker keeps none (vite.config.ts), but those
 * caches stay on devices that ran an earlier build until they are deleted.
 *
 * Only the caches known to hold app files are kept: the service worker's
 * precache of this build, which offline start depends on, and public files
 * from the jsDelivr CDN. Every other cache may hold server answers and is
 * deleted.
 */
import * as logger from "@/lib/logger";

/** Workbox precache ("workbox-precache-v2-<scope>") and the jsDelivr cache. */
const APP_FILE_CACHE = /^(workbox-precache-|jsdelivr$)/;

/** True for a cache that holds only app or public CDN files. */
export function holdsOnlyAppFiles(cacheName: string): boolean {
  return APP_FILE_CACHE.test(cacheName);
}

/**
 * Deletes every cache that could hold a server answer. Best effort: never
 * throws, and does nothing where Cache Storage is unavailable (tests, old
 * browsers, some private windows).
 */
export async function clearApiCaches(): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => !holdsOnlyAppFiles(name))
        .map((name) => caches.delete(name)),
    );
  } catch (error) {
    logger.warn(
      "[caches] Could not clear cached server answers:",
      error instanceof Error ? error.name : typeof error,
    );
  }
}
