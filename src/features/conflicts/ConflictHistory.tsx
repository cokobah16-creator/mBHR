import { useState } from "react";
import { ClipboardDocumentListIcon } from "@heroicons/react/24/outline";
import type {
  ConflictAuditEntry,
  ConflictType,
  FieldChangeDelta,
} from "@/services/conflictQueue";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonText } from "@/components/ui/Skeleton";
import { formatConflictValue } from "./conflictDiff";
import {
  auditActionMeta,
  conflictTypeLabel,
  formatTimestamp,
  humanise,
  roleLabel,
  staffLabel,
  strategyLabel,
} from "./conflictLabels";

interface ConflictHistoryProps {
  entries: ConflictAuditEntry[] | null;
  deltas: FieldChangeDelta[] | null;
  loading: boolean;
  error: string | null;
  conflictType: ConflictType;
  fieldLabels: Record<string, string>;
  staffNames: Record<string, string>;
  currentUserId?: string;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/** One readable line about what an audit entry recorded. Never raw JSON. */
function entryDetail(entry: ConflictAuditEntry, conflictType: ConflictType): string | null {
  const d = entry.fieldChanges ?? {};
  switch (entry.action) {
    case "created": {
      const type = str(d.conflict_type);
      return type ? `Reported as: ${conflictTypeLabel(type)}` : null;
    }
    case "resolved": {
      const strategy = str(d.strategy);
      const changes = d.field_changes;
      const bulk =
        changes && typeof changes === "object" && (changes as Record<string, unknown>).bulk === true;
      return `Decision: ${strategyLabel(strategy, conflictType)}${bulk ? " (bulk)" : ""}`;
    }
    case "approved": {
      const type = str(d.approval_type);
      if (type === "first_approval") return "First of two approvals";
      if (type === "second_approval") return "Second approval";
      return "Approval";
    }
    case "auto_resolved": {
      const rule = str(d.rule_name);
      return rule ? `Automatic rule: ${rule}` : "Automatic rule";
    }
    default:
      return null;
  }
}

export function ConflictHistory({
  entries,
  deltas,
  loading,
  error,
  conflictType,
  fieldLabels,
  staffNames,
  currentUserId,
}: ConflictHistoryProps) {
  const [showViews, setShowViews] = useState(false);

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <span role="status" className="sr-only">
          Loading history
        </span>
        <SkeletonText lines={4} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="banner banner-danger" role="alert">
        <p>
          The history could not be loaded from the server. {error}
        </p>
      </div>
    );
  }

  const all = entries ?? [];
  const viewCount = all.filter((e) => e.action === "viewed").length;
  const visible = showViews ? all : all.filter((e) => e.action !== "viewed");
  const changes = deltas ?? [];

  return (
    <div className="space-y-5">
      <section aria-labelledby="conflict-audit-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="conflict-audit-title" className="text-h3 text-ink">
            Audit log
          </h3>
          {viewCount > 0 && (
            <label className="inline-flex min-h-touch-target items-center gap-2 text-label text-ink-secondary">
              <input
                type="checkbox"
                checked={showViews}
                onChange={(e) => setShowViews(e.target.checked)}
                className="h-4 w-4"
              />
              Show views ({viewCount})
            </label>
          )}
        </div>
        {visible.length === 0 ? (
          <EmptyState
            icon={ClipboardDocumentListIcon}
            title="No audit entries yet"
            description="Entries appear here when someone reports, decides, approves or rejects this conflict."
            className="py-6"
          />
        ) : (
          <ol className="divide-y divide-line rounded-md border border-line">
            {visible.map((entry) => {
              const meta = auditActionMeta(entry.action);
              const detail = entryDetail(entry, conflictType);
              const who = entry.actorId
                ? staffLabel(entry.actorId, staffNames, currentUserId)
                : null;
              const role = roleLabel(entry.actorRole);
              return (
                <li key={entry.id} className="space-y-1 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                    <span className="text-body text-ink-secondary">
                      {who || role
                        ? `by ${[who, role && `(${role})`].filter(Boolean).join(" ")}`
                        : "by: not recorded"}
                    </span>
                    <span className="ml-auto text-caption text-ink-muted">
                      {formatTimestamp(entry.createdAt)}
                    </span>
                  </div>
                  {detail && <p className="text-body text-ink">{detail}</p>}
                  {entry.justification && (
                    <p className="text-body text-ink-secondary">
                      Reason: “{entry.justification}”
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {changes.length > 0 && (
        <section aria-labelledby="conflict-deltas-title" className="space-y-3">
          <h3 id="conflict-deltas-title" className="text-h3 text-ink">
            Field changes recorded
          </h3>
          <div className="hidden overflow-x-auto rounded-md border border-line md:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Before</th>
                  <th scope="col">After</th>
                  <th scope="col">Change</th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((delta) => (
                  <tr key={delta.id}>
                    <th scope="row" className="border-b border-line px-4 py-3 text-left align-middle font-medium text-ink">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {fieldLabels[delta.fieldName] ?? humanise(delta.fieldName)}
                        {delta.phiField && <StatusBadge tone="warning">PHI</StatusBadge>}
                      </span>
                    </th>
                    <td className="whitespace-pre-wrap break-words">
                      {formatConflictValue(delta.oldValue)}
                    </td>
                    <td className="whitespace-pre-wrap break-words">
                      {formatConflictValue(delta.newValue)}
                    </td>
                    <td>{humanise(delta.changeType)}</td>
                    <td className="text-caption text-ink-muted">
                      {formatTimestamp(delta.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-line rounded-md border border-line md:hidden">
            {changes.map((delta) => (
              <li key={delta.id} className="space-y-1 px-3 py-2.5">
                <p className="flex flex-wrap items-center gap-1.5 text-label text-ink">
                  {fieldLabels[delta.fieldName] ?? humanise(delta.fieldName)}
                  {delta.phiField && <StatusBadge tone="warning">PHI</StatusBadge>}
                  <span className="text-caption text-ink-muted">· {humanise(delta.changeType)}</span>
                </p>
                <p className="whitespace-pre-wrap break-words text-body text-ink-secondary">
                  {formatConflictValue(delta.oldValue)} → {formatConflictValue(delta.newValue)}
                </p>
                <p className="text-caption text-ink-muted">{formatTimestamp(delta.createdAt)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
