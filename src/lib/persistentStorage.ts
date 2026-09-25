/**
 * Asks the browser to keep this app's storage.
 *
 * By default site storage is "best effort": when the device runs short of
 * space the browser may delete it without asking, and records that have not
 * synced yet exist only there. A persistent grant stops that. Installed apps
 * usually get it without a prompt; some browsers ask the person once.
 */
type PersistableStorage = Pick<StorageManager, "persist" | "persisted">;

/**
 * Requests persistent storage unless it is already granted. Resolves to
 * whether storage is persistent; never throws.
 */
export async function requestPersistentStorage(
  storage: PersistableStorage | null | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator.storage,
): Promise<boolean> {
  try {
    if (
      typeof storage?.persist !== "function" ||
      typeof storage.persisted !== "function"
    ) {
      return false;
    }
    if (await storage.persisted()) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}
