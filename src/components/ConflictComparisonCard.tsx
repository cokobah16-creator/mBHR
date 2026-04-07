import { useState } from "react";
import {
  ShieldExclamationIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XMarkIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
} from "@heroicons/react/24/outline";
import type {
  ConflictField,
  PHISensitivity,
  ConflictPriority,
} from "@/services/conflictQueue";

interface ConflictComparisonCardProps {
  fields: ConflictField[];
  localTimestamp?: string;
  remoteTimestamp?: string;
  matchScore?: number;
  matchReasons?: string[];
  priority: ConflictPriority;
  phiSensitivity: PHISensitivity;
  selectedResolutions: Record<string, "local" | "remote">;
  onFieldSelect: (field: string, choice: "local" | "remote") => void;
  isReadOnly?: boolean;
}

const PHI_LABELS: Record<
  PHISensitivity,
  { label: string; color: string; icon: typeof ShieldExclamationIcon }
> = {
  high: {
    label: "High PHI",
    color: "text-red-600 bg-red-50 border-red-200",
    icon: ShieldExclamationIcon,
  },
  medium: {
    label: "Medium PHI",
    color: "text-amber-600 bg-amber-50 border-amber-200",
    icon: ExclamationTriangleIcon,
  },
  low: {
    label: "Low PHI",
    color: "text-blue-600 bg-blue-50 border-blue-200",
    icon: ShieldCheckIcon,
  },
  none: {
    label: "Non-PHI",
    color: "text-gray-600 bg-gray-50 border-gray-200",
    icon: CheckCircleIcon,
  },
};

const PRIORITY_LABELS: Record<
  ConflictPriority,
  { label: string; color: string }
> = {
  critical: {
    label: "Critical",
    color: "bg-red-100 text-red-800 border-red-300",
  },
  high: {
    label: "High",
    color: "bg-orange-100 text-orange-800 border-orange-300",
  },
  medium: {
    label: "Medium",
    color: "bg-yellow-100 text-yellow-800 border-yellow-300",
  },
  low: { label: "Low", color: "bg-gray-100 text-gray-700 border-gray-300" },
};

function formatValue(value: unknown, type: ConflictField["type"]): string {
  if (value === null || value === undefined || value === "") return "(empty)";

  switch (type) {
    case "date":
      try {
        return new Date(value as string).toLocaleDateString("en-NG", {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
      } catch {
        return String(value);
      }
    case "object":
    case "array":
      return JSON.stringify(value, null, 2);
    case "number":
      return String(value);
    default:
      return String(value);
  }
}

function PHIBadge({ sensitivity }: { sensitivity: PHISensitivity }) {
  const config = PHI_LABELS[sensitivity];
  const Icon = config.icon;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${config.color}`}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}

function FieldComparisonRow({
  field,
  selectedChoice,
  onSelect,
  isReadOnly,
}: {
  field: ConflictField;
  selectedChoice?: "local" | "remote";
  onSelect: (choice: "local" | "remote") => void;
  isReadOnly?: boolean;
}) {
  const localFormatted = formatValue(field.localValue, field.type);
  const remoteFormatted = formatValue(field.remoteValue, field.type);
  const isDifferent = localFormatted !== remoteFormatted;

  if (!isDifferent) return null;

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900">{field.label}</span>
          <PHIBadge sensitivity={field.phiSensitivity} />
        </div>
      </div>

      <div className="grid grid-cols-2 divide-x">
        <button
          type="button"
          onClick={() => !isReadOnly && onSelect("local")}
          disabled={isReadOnly}
          className={`p-4 text-left transition-all ${
            selectedChoice === "local"
              ? "bg-green-50 ring-2 ring-inset ring-green-500"
              : "hover:bg-gray-50"
          } ${isReadOnly ? "cursor-default" : "cursor-pointer"}`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Local Value
            </span>
            {selectedChoice === "local" && (
              <CheckCircleIcon className="h-5 w-5 text-green-600" />
            )}
          </div>
          <pre className="text-sm text-gray-900 whitespace-pre-wrap font-mono bg-white p-2 rounded border">
            {localFormatted}
          </pre>
        </button>

        <button
          type="button"
          onClick={() => !isReadOnly && onSelect("remote")}
          disabled={isReadOnly}
          className={`p-4 text-left transition-all ${
            selectedChoice === "remote"
              ? "bg-green-50 ring-2 ring-inset ring-green-500"
              : "hover:bg-gray-50"
          } ${isReadOnly ? "cursor-default" : "cursor-pointer"}`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Remote Value
            </span>
            {selectedChoice === "remote" && (
              <CheckCircleIcon className="h-5 w-5 text-green-600" />
            )}
          </div>
          <pre className="text-sm text-gray-900 whitespace-pre-wrap font-mono bg-white p-2 rounded border">
            {remoteFormatted}
          </pre>
        </button>
      </div>
    </div>
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
}: ConflictComparisonCardProps) {
  const [showAllFields, setShowAllFields] = useState(false);

  const differentFields = fields.filter((f) => {
    const local = formatValue(f.localValue, f.type);
    const remote = formatValue(f.remoteValue, f.type);
    return local !== remote;
  });

  const displayFields = showAllFields ? fields : differentFields.slice(0, 5);
  const hasMore = differentFields.length > 5;

  return (
    <div className="bg-white rounded-lg border shadow-sm">
      <div className="p-4 border-b bg-gray-50">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${PRIORITY_LABELS[priority].color}`}
            >
              {PRIORITY_LABELS[priority].label} Priority
            </span>
            <PHIBadge sensitivity={phiSensitivity} />
          </div>
          <span className="text-sm text-gray-500">
            {differentFields.length} field
            {differentFields.length !== 1 ? "s" : ""} differ
          </span>
        </div>

        {(localTimestamp || remoteTimestamp) && (
          <div className="flex items-center gap-6 text-sm text-gray-600">
            {localTimestamp && (
              <div className="flex items-center gap-1">
                <ClockIcon className="h-4 w-4" />
                <span>Local: {new Date(localTimestamp).toLocaleString()}</span>
              </div>
            )}
            {remoteTimestamp && (
              <div className="flex items-center gap-1">
                <ClockIcon className="h-4 w-4" />
                <span>
                  Remote: {new Date(remoteTimestamp).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        )}

        {matchScore !== undefined && (
          <div className="mt-3 p-3 bg-white rounded-lg border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">
                Match Confidence
              </span>
              <span
                className={`text-lg font-bold ${
                  matchScore >= 0.8
                    ? "text-red-600"
                    : matchScore >= 0.6
                      ? "text-amber-600"
                      : "text-gray-600"
                }`}
              >
                {(matchScore * 100).toFixed(0)}%
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className={`h-2 rounded-full ${
                  matchScore >= 0.8
                    ? "bg-red-500"
                    : matchScore >= 0.6
                      ? "bg-amber-500"
                      : "bg-gray-400"
                }`}
                style={{ width: `${matchScore * 100}%` }}
              />
            </div>
            {matchReasons && matchReasons.length > 0 && (
              <ul className="mt-2 space-y-1">
                {matchReasons.map((reason, idx) => (
                  <li
                    key={idx}
                    className="text-xs text-gray-600 flex items-start gap-1"
                  >
                    <span className="text-gray-400 mt-0.5">-</span>
                    {reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="p-4 space-y-4">
        {displayFields.map((field) => (
          <FieldComparisonRow
            key={field.field}
            field={field}
            selectedChoice={selectedResolutions[field.field]}
            onSelect={(choice) => onFieldSelect(field.field, choice)}
            isReadOnly={isReadOnly}
          />
        ))}

        {hasMore && (
          <button
            type="button"
            onClick={() => setShowAllFields(!showAllFields)}
            className="w-full py-2 text-sm text-gray-600 hover:text-gray-900 flex items-center justify-center gap-1"
          >
            {showAllFields ? (
              <>
                <ChevronUpIcon className="h-4 w-4" />
                Show fewer fields
              </>
            ) : (
              <>
                <ChevronDownIcon className="h-4 w-4" />
                Show {differentFields.length - 5} more field
                {differentFields.length - 5 !== 1 ? "s" : ""}
              </>
            )}
          </button>
        )}
      </div>

      {phiSensitivity === "high" && (
        <div className="px-4 pb-4">
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-start gap-2">
              <ShieldExclamationIcon className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-red-800">
                  High PHI Sensitivity - Secondary Approval Required
                </p>
                <p className="text-xs text-red-600 mt-1">
                  This conflict involves highly sensitive patient information.
                  Resolution will require approval from an administrator before
                  being finalized.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
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
}: {
  onKeepLocal: () => void;
  onKeepRemote: () => void;
  onManualResolve: () => void;
  onIgnore: () => void;
  isResolving: boolean;
  hasManualSelections: boolean;
  requiresApproval: boolean;
}) {
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <button
        type="button"
        onClick={onKeepLocal}
        disabled={isResolving}
        className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium"
      >
        Keep All Local
      </button>
      <button
        type="button"
        onClick={onKeepRemote}
        disabled={isResolving}
        className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors font-medium"
      >
        Keep All Remote
      </button>
      <button
        type="button"
        onClick={onManualResolve}
        disabled={isResolving || !hasManualSelections}
        className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors font-medium"
      >
        {requiresApproval ? "Submit for Approval" : "Apply Selection"}
      </button>
      <button
        type="button"
        onClick={onIgnore}
        disabled={isResolving}
        className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors font-medium"
      >
        <XMarkIcon className="h-5 w-5" />
      </button>
    </div>
  );
}
