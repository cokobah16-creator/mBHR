import type { ConflictResolution } from "@/services/conflictQueue";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SkeletonText } from "@/components/ui/Skeleton";
import { displayStatus, formatTimestamp, staffLabel, strategyLabel } from "./conflictLabels";
import { deviceMatchesDecision, type DevicePlan } from "./devicePlan";

interface RecordedDecisionProps {
  conflict: ConflictResolution;
  names: Record<string, string>;
  currentUserId?: string;
  /** Plan for applying the decision here; null while this device is read. */
  plan: DevicePlan | null;
  /** The current user may apply the decision on this device. */
  canApply: boolean;
  /** Why they can't, when they can't. */
  deniedMessage: string;
  onApply: () => void;
}

function noPlanText(plan: DevicePlan): string {
  if (plan.kind !== "none") return "";
  switch (plan.reason) {
    case "not_on_device":
      return "This record is not stored on this device, so there is nothing to apply here.";
    case "partner_not_on_device":
      return "Record B is not stored on this device, so the records cannot be merged here.";
    case "merged_elsewhere":
      return "One of these records is already merged into another patient on this device, so this decision cannot be applied here.";
    case "unknown_table":
      return "This type of record is not stored on this device.";
    case "no_fields":
      return "The two sides no longer differ.";
    case "unsupported_type":
      return "This decision is recorded only; the record itself is not changed from this screen.";
    default:
      return "Nothing needs to change on this device.";
  }
}

function Who({
  id,
  at,
  names,
  currentUserId,
}: {
  id?: string;
  at?: string;
  names: Record<string, string>;
  currentUserId?: string;
}) {
  return (
    <>
      {staffLabel(id, names, currentUserId)}
      {at && <span className="text-ink-muted"> · {formatTimestamp(at)}</span>}
    </>
  );
}

/** Resolved-history detail: who decided, which side won, and this device. */
export function RecordedDecision({
  conflict,
  names,
  currentUserId,
  plan,
  canApply,
  deniedMessage,
  onApply,
}: RecordedDecisionProps) {
  const status = displayStatus(conflict);
  const strategy = conflict.resolutionStrategy;
  const showDevice = conflict.status === "resolved" && !!strategy && strategy !== "ignore";

  return (
    <>
      <dl className="grid gap-x-6 gap-y-3 text-body sm:grid-cols-2">
        <div>
          <dt className="text-caption text-ink-muted">Outcome</dt>
          <dd className="flex flex-wrap items-center gap-2 text-ink">
            <StatusBadge tone={status.tone} icon>
              {status.label}
            </StatusBadge>
            {strategyLabel(strategy, conflict.conflictType)}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-ink-muted">Decided by</dt>
          <dd className="text-ink">
            {conflict.status === "auto_resolved" ? (
              <>
                Automatic rule
                {conflict.resolvedAt && (
                  <span className="text-ink-muted"> · {formatTimestamp(conflict.resolvedAt)}</span>
                )}
              </>
            ) : (
              <Who id={conflict.resolvedBy} at={conflict.resolvedAt} names={names} currentUserId={currentUserId} />
            )}
          </dd>
        </div>
        {conflict.approvedBy && (
          <div>
            <dt className="text-caption text-ink-muted">Approved by</dt>
            <dd className="text-ink">
              <Who id={conflict.approvedBy} at={conflict.approvedAt} names={names} currentUserId={currentUserId} />
            </dd>
          </div>
        )}
        {conflict.secondApproverId && (
          <div>
            <dt className="text-caption text-ink-muted">Second approval</dt>
            <dd className="text-ink">
              <Who
                id={conflict.secondApproverId}
                at={conflict.secondApprovedAt}
                names={names}
                currentUserId={currentUserId}
              />
            </dd>
          </div>
        )}
      </dl>
      {showDevice && (
        <div className="space-y-2">
          <p className="section-label">On this device</p>
          {!plan ? (
            <SkeletonText lines={1} />
          ) : plan.kind === "none" ? (
            <p className="text-body text-ink-secondary">{noPlanText(plan)}</p>
          ) : deviceMatchesDecision(plan) ? (
            <StatusBadge tone="success" icon>
              This device's copy matches the decision
            </StatusBadge>
          ) : (
            <div className="space-y-2">
              <StatusBadge tone="warning">
                This device's copy does not match the decision
              </StatusBadge>
              <p className="text-body text-ink-secondary">
                The decision may not have reached this device, or the record may
                have been edited since. Applying shows every value that would be
                replaced before anything changes.
              </p>
              {canApply ? (
                <div>
                  <button type="button" className="btn-secondary" onClick={onApply}>
                    Apply on this device
                  </button>
                </div>
              ) : (
                <p className="text-body text-ink-secondary">{deniedMessage}</p>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
