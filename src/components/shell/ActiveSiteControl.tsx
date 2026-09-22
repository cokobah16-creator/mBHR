import { useState } from "react";
import { Link } from "react-router-dom";
import { MapPinIcon, ChevronDownIcon } from "@heroicons/react/20/solid";
import { useActiveSite } from "@/hooks/useActiveSite";
import { setActiveSite, DEFAULT_SITE_NAME } from "@/services/activeSite";
import { useAuthStore } from "@/stores/auth";
import { usePopover } from "./usePopover";

function todayLabel() {
  return new Date().toLocaleDateString("en-NG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Always-visible outreach context: which site this device is recording
 * visits for, and today's date. Selecting a site stamps it onto new visits.
 */
export function ActiveSiteControl() {
  const { site, options, loading } = useActiveSite();
  const isAdmin = useAuthStore((s) => s.currentUser?.role === "admin");
  const { open, setOpen, ref } = usePopover();
  const [error, setError] = useState("");
  // Switching away from a site already in use needs a second, explicit
  // step: recording visits under the wrong outreach is hard to undo.
  const [pending, setPending] = useState<{ id: string; name: string } | null>(null);

  const apply = async (id: string) => {
    setError("");
    try {
      await setActiveSite(id);
      setPending(null);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change site.");
    }
  };

  const choose = (id: string, name: string) => {
    if (site?.id === id) {
      setOpen(false);
      return;
    }
    if (site) setPending({ id, name });
    else apply(id);
  };

  const unset = !loading && !site;

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        onClick={() => {
          setPending(null);
          setOpen(!open);
        }}
        aria-haspopup="true"
        aria-expanded={open}
        className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left min-h-touch-target max-w-full transition-colors ${
          unset
            ? "bg-warning-soft text-warning-fg border border-warning-line hover:bg-warning-line/40"
            : "hover:bg-surface-hover text-ink"
        }`}
      >
        <MapPinIcon
          className={`h-4 w-4 shrink-0 ${unset ? "text-warning" : "text-primary"}`}
          aria-hidden
        />
        <span className="min-w-0">
          <span className="block text-caption text-ink-muted leading-none">
            Outreach site
          </span>
          <span className="block truncate text-label font-semibold">
            {loading ? "…" : site ? site.name : "Not set"}
            <span className="hidden sm:inline font-normal text-ink-muted">
              {" "}
              · {todayLabel()}
            </span>
          </span>
        </span>
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose outreach site"
          className="absolute left-0 top-full z-50 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface shadow-xl"
        >
          <div className="px-3 py-2.5 border-b border-line">
            <p className="text-label text-ink">Recording visits for</p>
            <p className="text-caption text-ink-muted">
              New visits on this device are stamped with this site.
              {!site && ` Until one is chosen they are recorded as “${DEFAULT_SITE_NAME}”.`}
            </p>
          </div>
          {pending ? (
            <div className="space-y-3 px-3 py-3" role="alert">
              <p className="text-body text-ink">
                Switch from <strong>{site?.name}</strong> to{" "}
                <strong>{pending.name}</strong>?
              </p>
              <p className="text-caption text-ink-muted">
                Visits already recorded stay with {site?.name}. New visits on
                this device will be recorded at {pending.name}.
              </p>
              <div className="flex gap-2">
                <button type="button" className="btn-secondary flex-1 min-h-10 py-2" onClick={() => setPending(null)}>
                  Keep {site?.name}
                </button>
                <button type="button" className="btn-primary flex-1 min-h-10 py-2" onClick={() => apply(pending.id)}>
                  Switch
                </button>
              </div>
            </div>
          ) : options.length === 0 ? (
            <div className="px-3 py-3 text-body text-ink-secondary">
              No active sites yet.
              {isAdmin ? (
                <>
                  {" "}
                  <Link
                    to="/reports/outreach"
                    onClick={() => setOpen(false)}
                    className="text-primary font-medium hover:underline"
                  >
                    Add a site
                  </Link>{" "}
                  in Outreach Reports.
                </>
              ) : (
                " Ask an administrator to add one."
              )}
            </div>
          ) : (
            <ul className="max-h-72 overflow-y-auto py-1" role="listbox" aria-label="Sites">
              {options.map((o) => (
                <li key={o.id} role="option" aria-selected={site?.id === o.id}>
                  <button
                    type="button"
                    onClick={() => choose(o.id, o.name)}
                    className={`w-full text-left px-3 py-2.5 text-body hover:bg-surface-hover ${
                      site?.id === o.id ? "font-semibold text-primary" : "text-ink"
                    }`}
                  >
                    {o.name}
                    {site?.id === o.id && <span className="sr-only"> (current)</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && <p className="px-3 pb-2 text-caption text-danger-fg">{error}</p>}
        </div>
      )}
    </div>
  );
}
