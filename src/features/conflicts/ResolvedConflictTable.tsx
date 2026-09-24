import type { ConflictResolution } from "@/services/conflictQueue";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { decisionWinner, recordedSelections, type Winner } from "./conflictDiff";
import {
  conflictTypeLabel,
  displayStatus,
  formatTimestamp,
  recordTypeLabel,
  sideLabels,
  staffLabel,
  strategyLabel,
} from "./conflictLabels";
import type { LocalConflictContext } from "./localContext";
import { PatientSummary } from "./ConflictListTable";

interface ResolvedConflictTableProps {
  conflicts: ConflictResolution[];
  contexts: Record<string, LocalConflictContext>;
  contextsLoading: boolean;
  staffNames: Record<string, string>;
  currentUserId?: string;
  onOpen: (conflict: ConflictResolution) => void;
}

/** "Server copy kept", "Mixed: 2 device, 1 server", "No change". */
function winnerText(conflict: ConflictResolution): string {
  const labels = sideLabels(conflict.conflictType);
  const winner: Winner = decisionWinner(conflict);
  switch (winner) {
    case "local":
      return `${labels.local} kept`;
    case "remote":
      return `${labels.remote} kept`;
    case "none":
      return "No change";
    case "mixed": {
      const sel = Object.values(recordedSelections(conflict) ?? {});
      const local = sel.filter((s) => s === "local").length;
      const remote = sel.length - local;
      return `Mixed: ${local} from ${labels.local.toLowerCase()}, ${remote} from ${labels.remote.toLowerCase()}`;
    }
    default:
      return "Not recorded";
  }
}

function Approval({
  conflict,
  names,
  currentUserId,
}: {
  conflict: ConflictResolution;
  names: Record<string, string>;
  currentUserId?: string;
}) {
  if (!conflict.approvedBy && !conflict.secondApproverId) {
    return (
      <span className="text-caption text-ink-muted">
        {conflict.requiredApproverRole ? "Not recorded" : "Not needed"}
      </span>
    );
  }
  return (
    <span className="block space-y-0.5">
      {conflict.approvedBy && (
        <span className="block text-ink">
          {staffLabel(conflict.approvedBy, names, currentUserId)}
        </span>
      )}
      {conflict.secondApproverId && (
        <span className="block text-ink">
          and {staffLabel(conflict.secondApproverId, names, currentUserId)}
        </span>
      )}
      {(conflict.secondApprovedAt || conflict.approvedAt) && (
        <span className="block text-caption text-ink-muted">
          {formatTimestamp(conflict.secondApprovedAt || conflict.approvedAt)}
        </span>
      )}
    </span>
  );
}

function decidedBy(
  conflict: ConflictResolution,
  names: Record<string, string>,
  currentUserId?: string,
): string {
  if (conflict.status === "auto_resolved") return "Automatic rule";
  return staffLabel(conflict.resolvedBy, names, currentUserId);
}

export function ResolvedConflictTable({
  conflicts,
  contexts,
  contextsLoading,
  staffNames,
  currentUserId,
  onOpen,
}: ResolvedConflictTableProps) {
  return (
    <>
      <div className="hidden overflow-x-auto lg:block">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Record</th>
              <th scope="col">Patient</th>
              <th scope="col">Decision</th>
              <th scope="col">Decided by</th>
              <th scope="col">Approved by</th>
              <th scope="col">Outcome</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {conflicts.map((c) => {
              const status = displayStatus(c);
              return (
                <tr key={c.id}>
                  <td>
                    <span className="block font-medium text-ink">{recordTypeLabel(c.entityType)}</span>
                    <span className="block text-caption text-ink-muted">
                      {conflictTypeLabel(c.conflictType)}
                    </span>
                  </td>
                  <td>
                    <PatientSummary conflict={c} context={contexts[c.id]} loading={contextsLoading} />
                  </td>
                  <td>
                    <span className="block text-ink">{winnerText(c)}</span>
                    <span className="block text-caption text-ink-muted">
                      {strategyLabel(c.resolutionStrategy, c.conflictType)}
                    </span>
                  </td>
                  <td>
                    <span className="block text-ink">{decidedBy(c, staffNames, currentUserId)}</span>
                    <span className="block text-caption text-ink-muted">
                      {formatTimestamp(c.resolvedAt) || "Time not recorded"}
                    </span>
                  </td>
                  <td>
                    <Approval conflict={c} names={staffNames} currentUserId={currentUserId} />
                  </td>
                  <td>
                    <StatusBadge tone={status.tone} icon>
                      {status.label}
                    </StatusBadge>
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => onOpen(c)}
                      aria-label={`View ${recordTypeLabel(c.entityType)} ${conflictTypeLabel(c.conflictType).toLowerCase()} decision`}
                    >
                      View
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-line lg:hidden">
        {conflicts.map((c) => {
          const status = displayStatus(c);
          return (
            <li key={c.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-body">
                  <span className="font-medium text-ink">{recordTypeLabel(c.entityType)}</span>
                  <span className="text-ink-muted"> · {conflictTypeLabel(c.conflictType)}</span>
                </p>
                <div className="text-body">
                  <PatientSummary conflict={c} context={contexts[c.id]} loading={contextsLoading} />
                </div>
                <p className="text-body text-ink">{winnerText(c)}</p>
                <p className="text-caption text-ink-muted">
                  {decidedBy(c, staffNames, currentUserId)}
                  {c.resolvedAt ? ` · ${formatTimestamp(c.resolvedAt)}` : ""}
                </p>
                <StatusBadge tone={status.tone} icon>
                  {status.label}
                </StatusBadge>
              </div>
              <button
                type="button"
                className="btn-secondary shrink-0 px-3"
                onClick={() => onOpen(c)}
                aria-label={`View ${recordTypeLabel(c.entityType)} ${conflictTypeLabel(c.conflictType).toLowerCase()} decision`}
              >
                View
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
