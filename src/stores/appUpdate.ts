import { create } from "zustand";

/**
 * Why this window's local database was closed under it: another window
 * opened a newer version of the app, which upgrades the database, or erased
 * this device's data (device reset).
 */
export type DatabaseClosedReason = "upgraded" | "erased";

interface AppUpdateState {
  /**
   * Switches to the new version, reloading this window. Set when a new
   * version has been downloaded and waits for the person to choose to
   * reload; null while there is none.
   */
  reloadToUpdate: (() => void) | null;
  /** The person chose "Later"; news about the update shows it again. */
  updatePutOff: boolean;
  /** Set once this window can no longer save (see DatabaseClosedReason). */
  databaseClosed: DatabaseClosedReason | null;
  setUpdateReady: (reload: () => void) => void;
  putOffUpdate: () => void;
  setDatabaseClosed: (reason: DatabaseClosedReason) => void;
}

/** App version and local-database state shown by AppUpdateBanner. */
export const useAppUpdateStore = create<AppUpdateState>()((set) => ({
  reloadToUpdate: null,
  updatePutOff: false,
  databaseClosed: null,
  setUpdateReady: (reload) =>
    set({ reloadToUpdate: reload, updatePutOff: false }),
  putOffUpdate: () => set({ updatePutOff: true }),
  // Keep the first reason: one change in another window closes several
  // databases.
  setDatabaseClosed: (reason) =>
    set((state) => ({ databaseClosed: state.databaseClosed ?? reason })),
}));
