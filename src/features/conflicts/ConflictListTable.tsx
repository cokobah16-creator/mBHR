import type { MouseEvent } from "react";
import type { ConflictResolution } from "@/services/conflictQueue";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { differingFields } from "./conflictDiff";
import {
  conflictTypeLabel,
  displayStatus,
  formatConflictAge,
  formatTimestamp,
  priorityMeta,
  recordTypeLabel,
  sensitivityMeta,
} from "./conflictLabels";
import type { LocalConflictContext } from "./localContext";

interface ConflictListTableProps {
  conflicts: ConflictResolution[];
  contexts: Record<string, LocalConflictContext>;
  /** Contexts are still being read from this device. */
  contextsLoading: boolean;
  now: Date;
  selectable: boolean;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onOpen: (conflict: ConflictResolution) => void;
}

const MAX_FIELDS_SHOWN = 3;

function fieldSummary(conflict: ConflictResolution): string {
  const diff = differingFields(conflict.conflictDetails.fields);
  if (diff.length === 0) return "No differences recorded";
  const names = diff.slice(0, MAX_FIELDS_SHOWN).map((f) => f.label);
  const more = diff.length - names.length;
  return more > 0 ? `${names.join(", ")} +${more} more` : names.join(", ");
}

/** "Ada Obi · MBHR-12AB34", or an honest note when this device can't tell. */
export function PatientSummary({
  conflict,
  context,
  loading,
}: {
  conflict: ConflictResolution;
  context?: LocalConflictContext;
  loading: boolean;
}) {
  if (loading && !context) {
    return <span className="text-caption text-ink-muted">Checking this device…</span>;
  }
  const patient = context?.patient;
  if (conflict.conflictType === "duplicate") {
    const partner = context?.partnerPatient;
    return (
      <span className="block space-y-0.5">
        <span className="block">
          <span className="text-caption text-ink-muted">A: </span>
          {patient ? (
            <>
              <span className="text-ink">{patient.name}</span>{" "}
              <span className="text-caption text-ink-muted">{patient.mbhrId}</span>
            </>
          ) : (
            <span className="text-caption text-ink-muted">Not on this device</span>
          )}
        </span>
        <span className="block">
          <span className="text-caption text-ink-muted">B: </span>
          {partner ? (
            <>
              <span className="text-ink">{partner.name}</span>{" "}
              <span className="text-caption text-ink-muted">{partner.mbhrId}</span>
            </>
          ) : (
            <span className="text-caption text-ink-muted">Not on this device</span>
          )}
        </span>
      </span>
    );
  }
  if (patient) {
    return (
      <span className="block">
        <span className="block text-ink">{patient.name}</span>
        <span className="block text-caption text-ink-muted">{patient.mbhrId}</span>
      </span>
    );
  }
  if (conflict.entityType === "inventory" || conflict.entityType === "app_users") {
    return <span className="text-caption text-ink-muted">Not a patient record</span>;
  }
  return (
    <span className="text-caption text-ink-muted">
      {context?.record ? "Patient not on this device" : "Not on this device"}
    </span>
  );
}

function patientName(context?: LocalConflictContext): string {
  return context?.patient ? `, ${context.patient.name}` : "";
}

export function ConflictListTable({
  conflicts,
  contexts,
  contextsLoading,
  now,
  selectable,
  selectedIds,
  onToggle,
  onToggleAll,
  onOpen,
}: ConflictListTableProps) {
  const allSelected =
    conflicts.length > 0 && conflicts.every((c) => selectedIds.has(c.id));

  const openFromRow = (e: MouseEvent<HTMLTableRowElement>, conflict: ConflictResolution) => {
    const target = e.target as HTMLElement;
    if (target.closest("button, input, label, a")) return;
    onOpen(conflict);
  };

  return (
    <>
      <div className="hidden overflow-x-auto lg:block">
        <table className="data-table">
          <thead>
            <tr>
              {selectable && (
                <th scope="col" className="w-12">
                  <label className="inline-flex min-h-touch-target min-w-touch-target cursor-pointer items-center justify-center">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={onToggleAll}
                      className="h-4 w-4"
                    />
                    <span className="sr-only">Select all conflicts on this page</span>
                  </label>
                </th>
              )}
              <th scope="col">Record</th>
              <th scope="col">Patient</th>
              <th scope="col">Fields in conflict</th>
              <th scope="col">Sensitivity</th>
              <th scope="col">Priority</th>
              <th scope="col">Open for</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {conflicts.map((c) => {
              const sens = sensitivityMeta(c.phiSensitivity);
              const prio = priorityMeta(c.priority);
              const status = displayStatus(c);
              const ctx = contexts[c.id];
              const label = `${recordTypeLabel(c.entityType)} ${conflictTypeLabel(c.conflictType).toLowerCase()}${patientName(ctx)}`;
              return (
                <tr
                  key={c.id}
                  className="cursor-pointer"
                  onClick={(e) => openFromRow(e, c)}
                >
                  {selectable && (
                    <td className="w-12">
                      <label className="inline-flex min-h-touch-target min-w-touch-target cursor-pointer items-center justify-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(c.id)}
                          onChange={() => onToggle(c.id)}
                          className="h-4 w-4"
                        />
                        <span className="sr-only">Select: {label}</span>
                      </label>
                    </td>
                  )}
                  <td>
                    <span className="block font-medium text-ink">
                      {recordTypeLabel(c.entityType)}
                    </span>
                    <span className="block text-caption text-ink-muted">
                      {conflictTypeLabel(c.conflictType)}
                    </span>
                  </td>
                  <td>
                    <PatientSummary conflict={c} context={ctx} loading={contextsLoading} />
                  </td>
                  <td className="max-w-[16rem] text-ink-secondary">{fieldSummary(c)}</td>
                  <td>
                    <StatusBadge tone={sens.tone} icon>
                      {sens.label}
                    </StatusBadge>
                  </td>
                  <td>
                    <StatusBadge tone={prio.tone}>{prio.label}</StatusBadge>
                  </td>
                  <td className="whitespace-nowrap text-ink-secondary">
                    <span title={formatTimestamp(c.createdAt)}>
                      {formatConflictAge(c.createdAt, now)}
                    </span>
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
                      aria-label={`Review ${label}`}
                    >
                      Review
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-line lg:hidden">
        {selectable && conflicts.length > 0 && (
          <li className="px-2 py-1">
            <label className="inline-flex min-h-touch-target cursor-pointer items-center gap-3 px-2 text-label text-ink-secondary">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAll}
                className="h-4 w-4"
              />
              Select all on this page
            </label>
          </li>
        )}
        {conflicts.map((c) => {
          const sens = sensitivityMeta(c.phiSensitivity);
          const prio = priorityMeta(c.priority);
          const status = displayStatus(c);
          const ctx = contexts[c.id];
          const label = `${recordTypeLabel(c.entityType)} ${conflictTypeLabel(c.conflictType).toLowerCase()}${patientName(ctx)}`;
          return (
            <li key={c.id} className="flex items-start gap-2 px-2 py-3">
              {selectable && (
                <label className="inline-flex min-h-touch-target min-w-touch-target shrink-0 cursor-pointer items-center justify-center">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(c.id)}
                    onChange={() => onToggle(c.id)}
                    className="h-4 w-4"
                  />
                  <span className="sr-only">Select: {label}</span>
                </label>
              )}
              <div className="min-w-0 flex-1 space-y-1.5 px-2">
                <p className="text-body">
                  <span className="font-medium text-ink">{recordTypeLabel(c.entityType)}</span>
                  <span className="text-ink-muted"> · {conflictTypeLabel(c.conflictType)}</span>
                </p>
                <div className="text-body">
                  <PatientSummary conflict={c} context={ctx} loading={contextsLoading} />
                </div>
                <p className="text-caption text-ink-secondary">{fieldSummary(c)}</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge tone={status.tone} icon>
                    {status.label}
                  </StatusBadge>
                  <StatusBadge tone={sens.tone} icon>
                    {sens.label}
                  </StatusBadge>
                  <StatusBadge tone={prio.tone}>{prio.label}</StatusBadge>
                  <span className="text-caption text-ink-muted">
                    Open {formatConflictAge(c.createdAt, now)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="btn-secondary shrink-0 px-3"
                onClick={() => onOpen(c)}
                aria-label={`Review ${label}`}
              >
                Review
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
