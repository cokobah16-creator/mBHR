import { ExclamationTriangleIcon, SignalSlashIcon } from "@heroicons/react/24/outline";
import { SkeletonText } from "@/components/ui/Skeleton";
import { formatConflictValue } from "./conflictDiff";
import type { SideLabels } from "./conflictLabels";
import type { ResolutionSummary } from "./resolutionSummary";

interface ResolutionConfirmationProps {
  /** null while this device's copy is still being read. */
  summary: ResolutionSummary | null;
  labels: SideLabels;
  /** The reason that will be saved with the decision, if any. */
  reason?: string;
  /** The decision needs the server and this device is offline. */
  offline: boolean;
}

/** Exactly what a decision writes on the server and on this device. */
export function ResolutionConfirmation({
  summary,
  labels,
  reason,
  offline,
}: ResolutionConfirmationProps) {
  if (!summary) {
    return (
      <div aria-busy="true">
        <span role="status" className="sr-only">
          Checking this device's copy
        </span>
        <SkeletonText lines={3} />
      </div>
    );
  }

  return (
    <>
      <section aria-labelledby="confirm-server-title" className="space-y-2">
        <h4 id="confirm-server-title" className="section-label">
          On the server
        </h4>
        <ul className="list-disc space-y-1 pl-5 text-body text-ink">
          {summary.server.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="confirm-device-title" className="space-y-2">
        <h4 id="confirm-device-title" className="section-label">
          On this device
        </h4>
        <ul className="list-disc space-y-1 pl-5 text-body text-ink">
          {summary.device.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {summary.changes.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="data-table">
              <caption className="sr-only">Values written on this device</caption>
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">On this device now</th>
                  <th scope="col">Will become</th>
                  <th scope="col">Taken from</th>
                </tr>
              </thead>
              <tbody>
                {summary.changes.map((c) => (
                  <tr key={c.field}>
                    <th scope="row" className="border-b border-line px-4 py-3 text-left align-middle font-medium text-ink">
                      {c.label}
                    </th>
                    <td className="whitespace-pre-wrap break-words">
                      {formatConflictValue(c.current)}
                    </td>
                    <td className="whitespace-pre-wrap break-words">
                      {c.changesValue ? formatConflictValue(c.next) : "No change"}
                    </td>
                    <td>{c.side === "local" ? labels.local : labels.remote}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {reason && <p className="text-body text-ink-secondary">Reason: “{reason}”</p>}
      {summary.warnings.length > 0 && (
        <div className="banner banner-warning">
          <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <ul className="space-y-1">
            {summary.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {offline && (
        <div className="banner banner-warning">
          <SignalSlashIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>You are offline. Reconnect to save this decision on the server.</p>
        </div>
      )}
    </>
  );
}
