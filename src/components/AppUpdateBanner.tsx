import {
  ArrowPathIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { useAppUpdateStore } from "@/stores/appUpdate";

/**
 * Says when this window should be reloaded, and never reloads it by itself,
 * so nobody loses a record they are in the middle of entering.
 *
 * - A new version is ready (src/lib/serviceWorker.ts): nothing changes until
 *   the person chooses to reload. "Later" hides the notice until there is
 *   news about the update, or the app is next opened.
 * - Another window upgraded or erased the local database
 *   (src/db/versionChange.ts): this window can no longer save, so the notice
 *   stays until it is reloaded.
 */
export function AppUpdateBanner() {
  const reloadToUpdate = useAppUpdateStore((s) => s.reloadToUpdate);
  const updatePutOff = useAppUpdateStore((s) => s.updatePutOff);
  const putOffUpdate = useAppUpdateStore((s) => s.putOffUpdate);
  const databaseClosed = useAppUpdateStore((s) => s.databaseClosed);

  if (databaseClosed) {
    return (
      <section
        role="alert"
        aria-labelledby="app-reload-title"
        className="fixed bottom-4 left-4 right-4 z-50 rounded-lg border border-danger-line bg-danger-soft p-4 text-danger-fg shadow-xl md:right-auto md:w-96"
      >
        <div className="flex items-start gap-3">
          <ExclamationTriangleIcon
            className="h-6 w-6 shrink-0 mt-0.5"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <h2 id="app-reload-title" className="text-h3">
              Reload this window to keep working
            </h2>
            <p className="mt-1 text-body">
              {databaseClosed === "erased"
                ? "This device's data was erased in another window, so this window can no longer save."
                : "A newer version of mBHR was opened in another window, so this window can no longer save. Note down anything on this screen that is not saved yet, then reload."}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="btn-primary mt-4 w-full"
        >
          <ArrowPathIcon className="h-5 w-5" aria-hidden />
          Reload
        </button>
      </section>
    );
  }

  if (!reloadToUpdate || updatePutOff) return null;

  return (
    <section
      role="status"
      aria-labelledby="app-update-title"
      className="fixed bottom-4 left-4 right-4 z-50 rounded-lg border border-line bg-surface p-4 shadow-xl md:right-auto md:w-96"
    >
      <div className="flex items-start gap-3">
        <ArrowPathIcon
          className="h-6 w-6 shrink-0 text-primary mt-0.5"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <h2 id="app-update-title" className="text-h3 text-ink">
            A new version of mBHR is ready
          </h2>
          <p className="mt-1 text-body text-ink-secondary">
            Finish and save what you are working on, then reload to start
            using it.
          </p>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={putOffUpdate}
          className="btn-secondary flex-1"
        >
          Later
        </button>
        <button
          type="button"
          onClick={() => reloadToUpdate()}
          className="btn-primary flex-1"
        >
          <ArrowPathIcon className="h-5 w-5" aria-hidden />
          Reload now
        </button>
      </div>
    </section>
  );
}
