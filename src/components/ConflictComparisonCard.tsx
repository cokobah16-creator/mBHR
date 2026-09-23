import { useState } from "react";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  ShieldExclamationIcon,
  UserIcon,
} from "@heroicons/react/24/outline";
import type {
  ConflictField,
  ConflictPriority,
  ConflictType,
  PHISensitivity,
} from "@/services/conflictQueue";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  differingFields,
  formatConflictValue,
} from "@/features/conflicts/conflictDiff";
import {
  formatTimestamp,
  priorityMeta,
  sensitivityMeta,
  sideLabels,
  strategyActionLabel,
  type SideLabels,
} from "@/features/conflicts/conflictLabels";

type Choice = "local" | "remote";

interface ConflictComparisonCardProps {
  fields: ConflictField[];
  localTimestamp?: string;
  remoteTimestamp?: string;
  matchScore?: number;
  matchReasons?: string[];
  priority: ConflictPriority;
  phiSensitivity: PHISensitivity;
  selectedResolutions: Record<string, Choice>;
  onFieldSelect: (field: string, choice: Choice) => void;
  isReadOnly?: boolean;
  /** Names the two sides ("Device copy" / "Server copy", "Record A" / "Record B"). */
  conflictType?: ConflictType;
  /** Who last changed each side, already resolved to a display name. */
  localChangedBy?: string;
  remoteChangedBy?: string;
  /** Display name of the role that must approve, e.g. "Lead Clinician". */
  requiredApproverLabel?: string;
  /** Prefix for radio group names when several cards are on screen. */
  idPrefix?: string;
}

const COLLAPSED_COUNT = 5;

function matchStrength(score: number): string {
  if (score >= 0.8) return "Strong match";
  if (score >= 0.6) return "Possible match";
  return "Weak match";
}

function FieldSensitivity({ sensitivity }: { sensitivity: PHISensitivity }) {
  if (sensitivity !== "high" && sensitivity !== "medium") return null;
  const meta = sensitivityMeta(sensitivity);
  return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>;
}

function SideSummary({
  title,
  hint,
  timestamp,
  changedBy,
  showProvenance,
}: {
  title: string;
  hint: string;
  timestamp?: string;
  changedBy?: string;
  showProvenance: boolean;
}) {
  const when = formatTimestamp(timestamp);
  return (
    <div className="rounded-md border border-line bg-surface-sunken px-3 py-2">
      <p className="text-label text-ink">{title}</p>
      <p className="text-caption text-ink-muted">{hint}</p>
      {showProvenance && (
        <>
          <p className="mt-1 flex items-center gap-1.5 text-caption text-ink-secondary">
            <ClockIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {when ? `Saved ${when}` : "Time not recorded"}
          </p>
          <p className="flex items-center gap-1.5 text-caption text-ink-secondary">
            <UserIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {changedBy ? `By ${changedBy}` : "Changed by: not recorded"}
          </p>
        </>
      )}
    </div>
  );
}

function ValueOption({
  name,
  value,
  sideLabel,
  formatted,
  selected,
  onSelect,
}: {
  name: string;
  value: Choice;
  sideLabel: string;
  formatted: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={`flex min-h-touch-target cursor-pointer flex-col gap-1.5 p-3 transition-colors ${
        selected ? "bg-primary-soft" : "hover:bg-surface-hover"
      }`}
    >
      <span className="flex items-center gap-2">
        <input
          type="radio"
          name={name}
          value={value}
          checked={selected}
          onChange={onSelect}
          className="h-4 w-4 shrink-0"
        />
        <span className="text-caption font-semibold uppercase tracking-wide text-ink-muted">
          {sideLabel}
        </span>
        {selected && (
          <span className="ml-auto inline-flex items-center gap-1 text-caption font-medium text-primary-fg">
            <CheckCircleIcon className="h-4 w-4" aria-hidden />
            Selected
          </span>
        )}
      </span>
      <pre className="whitespace-pre-wrap break-words font-mono text-body text-ink">
        {formatted}
      </pre>
    </label>
  );
}

function ValueCell({
  sideLabel,
  formatted,
  selected,
}: {
  sideLabel: string;
  formatted: string;
  selected: boolean;
}) {
  return (
    <div className={`flex flex-col gap-1.5 p-3 ${selected ? "bg-primary-soft" : ""}`}>
      <span className="flex items-center gap-2">
        <span className="text-caption font-semibold uppercase tracking-wide text-ink-muted">
          {sideLabel}
        </span>
        {selected && (
          <span className="ml-auto inline-flex items-center gap-1 text-caption font-medium text-primary-fg">
            <CheckCircleIcon className="h-4 w-4" aria-hidden />
            Chosen
          </span>
        )}
      </span>
      <pre className="whitespace-pre-wrap break-words font-mono text-body text-ink">
        {formatted}
      </pre>
    </div>
  );
}

function FieldComparisonRow({
  field,
  labels,
  selectedChoice,
  onSelect,
  isReadOnly,
  radioName,
}: {
  field: ConflictField;
  labels: SideLabels;
  selectedChoice?: Choice;
  onSelect: (choice: Choice) => void;
  isReadOnly?: boolean;
  radioName: string;
}) {
  const localFormatted = formatConflictValue(field.localValue, field.type);
  const remoteFormatted = formatConflictValue(field.remoteValue, field.type);

  if (isReadOnly) {
    return (
      <div className="overflow-hidden rounded-md border border-line">
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-sunken px-3 py-2">
          <span className="text-label text-ink">{field.label}</span>
          <FieldSensitivity sensitivity={field.phiSensitivity} />
        </div>
        <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <ValueCell
            sideLabel={labels.local}
            formatted={localFormatted}
            selected={selectedChoice === "local"}
          />
          <ValueCell
            sideLabel={labels.remote}
            formatted={remoteFormatted}
            selected={selectedChoice === "remote"}
          />
        </div>
      </div>
    );
  }

  return (
    <fieldset className="overflow-hidden rounded-md border border-line">
      <legend className="sr-only">{`${field.label}: choose which value to keep`}</legend>
      <div
        className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-sunken px-3 py-2"
        aria-hidden
      >
        <span className="text-label text-ink">{field.label}</span>
        <FieldSensitivity sensitivity={field.phiSensitivity} />
        {!selectedChoice && (
          <span className="ml-auto text-caption text-ink-muted">Not chosen yet</span>
        )}
      </div>
      <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <ValueOption
          name={radioName}
          value="local"
          sideLabel={labels.local}
          formatted={localFormatted}
          selected={selectedChoice === "local"}
          onSelect={() => onSelect("local")}
        />
        <ValueOption
          name={radioName}
          value="remote"
          sideLabel={labels.remote}
          formatted={remoteFormatted}
          selected={selectedChoice === "remote"}
          onSelect={() => onSelect("remote")}
        />
      </div>
    </fieldset>
  );
}

export function ConflictComparisonCard({
  fields,
  localTimestamp,
  remoteTimestamp,
  matchScore,
  matchReasons,
  priority,
  phiSensitivity,
  selectedResolutions,
  onFieldSelect,
  isReadOnly,
  conflictType = "sync_conflict",
  localChangedBy,
  remoteChangedBy,
  requiredApproverLabel,
  idPrefix = "conflict",
}: ConflictComparisonCardProps) {
  const [showAllFields, setShowAllFields] = useState(false);
  const labels = sideLabels(conflictType);
  const differentFields = differingFields(fields);
  // Every field must be visible while choosing field by field.
  const collapsible = isReadOnly && differentFields.length > COLLAPSED_COUNT;
  const displayFields =
    collapsible && !showAllFields
      ? differentFields.slice(0, COLLAPSED_COUNT)
      : differentFields;
  const hiddenCount = differentFields.length - COLLAPSED_COUNT;
  // Fields that read the same on both sides: shown on request, because for
  // possible duplicates they are what makes the records look alike.
  const matchingFields = fields.filter((f) => !differentFields.includes(f));
  const prio = priorityMeta(priority);
  const sens = sensitivityMeta(phiSensitivity);
  const showProvenance = conflictType !== "duplicate";

  return (
    <section className="panel" aria-label="Values in conflict">
      <div className="panel-header flex-wrap">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={prio.tone}>{prio.label} priority</StatusBadge>
          <StatusBadge tone={sens.tone} icon>
            {sens.label}
          </StatusBadge>
        </div>
        <span className="text-caption text-ink-muted">
          {differentFields.length} field
          {differentFields.length !== 1 ? "s" : ""} differ
        </span>
      </div>

      <div className="panel-body space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <SideSummary
            title={labels.local}
            hint={labels.localHint}
            timestamp={localTimestamp}
            changedBy={localChangedBy}
            showProvenance={showProvenance}
          />
          <SideSummary
            title={labels.remote}
            hint={labels.remoteHint}
            timestamp={remoteTimestamp}
            changedBy={remoteChangedBy}
            showProvenance={showProvenance}
          />
        </div>

        {matchScore !== undefined && matchScore !== null && (
          <div className="rounded-md border border-line p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-label text-ink">Match strength</span>
              <span className="text-body text-ink">
                <span className="font-semibold tabular-nums">
                  {(matchScore * 100).toFixed(0)}%
                </span>{" "}
                <span className="text-ink-muted">· {matchStrength(matchScore)}</span>
              </span>
            </div>
            <div
              className="h-2 w-full rounded-full bg-surface-sunken"
              role="img"
              aria-label={`Match strength ${(matchScore * 100).toFixed(0)} percent`}
            >
              <div
                className="h-2 rounded-full bg-ink-muted"
                style={{ width: `${Math.max(0, Math.min(1, matchScore)) * 100}%` }}
              />
            </div>
            {matchReasons && matchReasons.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-caption text-ink-secondary">
                {matchReasons.map((reason, idx) => (
                  <li key={idx}>{reason}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {differentFields.length === 0 ? (
          <p className="text-body text-ink-muted">
            The two sides no longer differ in any recorded field.
          </p>
        ) : (
          <div className="space-y-3">
            {displayFields.map((field) => (
              <FieldComparisonRow
                key={field.field}
                field={field}
                labels={labels}
                selectedChoice={selectedResolutions[field.field]}
                onSelect={(choice) => onFieldSelect(field.field, choice)}
                isReadOnly={isReadOnly}
                radioName={`${idPrefix}-${field.field}`}
              />
            ))}
          </div>
        )}

        {collapsible && (
          <button
            type="button"
            onClick={() => setShowAllFields(!showAllFields)}
            aria-expanded={showAllFields}
            className="btn-ghost w-full"
          >
            {showAllFields ? (
              <>
                <ChevronUpIcon className="h-4 w-4" aria-hidden />
                Show fewer fields
              </>
            ) : (
              <>
                <ChevronDownIcon className="h-4 w-4" aria-hidden />
                Show {hiddenCount} more field{hiddenCount !== 1 ? "s" : ""}
              </>
            )}
          </button>
        )}

        {matchingFields.length > 0 && (
          <details className="rounded-md border border-line">
            <summary className="flex min-h-touch-target cursor-pointer items-center px-3 text-label text-ink">
              {matchingFields.length} field{matchingFields.length !== 1 ? "s" : ""} the same on
              both sides
            </summary>
            <dl className="divide-y divide-line border-t border-line">
              {matchingFields.map((field) => (
                <div
                  key={field.field}
                  className="grid gap-1 px-3 py-2 text-body sm:grid-cols-3 sm:gap-3"
                >
                  <dt className="text-ink-muted">{field.label}</dt>
                  <dd className="whitespace-pre-wrap break-words text-ink sm:col-span-2">
                    {formatConflictValue(field.localValue, field.type)}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        )}

        {phiSensitivity === "high" && (
          <div className="banner banner-warning">
            <ShieldExclamationIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">High-sensitivity patient details</p>
              <p className="text-caption">
                Only roles with PHI approval rights can decide this conflict
                {requiredApproverLabel
                  ? `, and the decision must be approved by ${requiredApproverLabel} before it is applied.`
                  : ", and the decision must be approved before it is applied."}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export function ConflictResolutionActions({
  onKeepLocal,
  onKeepRemote,
  onManualResolve,
  onIgnore,
  isResolving,
  hasManualSelections,
  requiresApproval,
  conflictType = "sync_conflict",
  manualSupported = true,
  manualHint,
  disabled = false,
}: {
  onKeepLocal: () => void;
  onKeepRemote: () => void;
  onManualResolve: () => void;
  onIgnore: () => void;
  isResolving: boolean;
  hasManualSelections: boolean;
  requiresApproval: boolean;
  /** Words the buttons for the conflict type. */
  conflictType?: ConflictType;
  /** Show the field-by-field option. */
  manualSupported?: boolean;
  /** e.g. "2 of 4 fields chosen". */
  manualHint?: string;
  /** Disable every action (e.g. offline). */
  disabled?: boolean;
}) {
  const off = isResolving || disabled;
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <button type="button" onClick={onKeepLocal} disabled={off} className="btn-secondary">
          {strategyActionLabel("keep_local", conflictType)}
        </button>
        <button type="button" onClick={onKeepRemote} disabled={off} className="btn-secondary">
          {strategyActionLabel("keep_remote", conflictType)}
        </button>
        {manualSupported && (
          <button
            type="button"
            onClick={onManualResolve}
            disabled={off || !hasManualSelections}
            className="btn-secondary"
          >
            {strategyActionLabel("manual", conflictType)}
          </button>
        )}
        <button type="button" onClick={onIgnore} disabled={off} className="btn-ghost sm:ml-auto">
          {strategyActionLabel("ignore", conflictType)}
        </button>
      </div>
      {manualSupported && manualHint && <p className="field-hint">{manualHint}</p>}
      <p className="text-caption text-ink-muted">
        {requiresApproval
          ? "Each option shows a summary to confirm first. Decisions on this conflict are sent for approval before anything is applied."
          : "Each option shows a summary of exactly what will change before anything is saved."}
      </p>
    </div>
  );
}
