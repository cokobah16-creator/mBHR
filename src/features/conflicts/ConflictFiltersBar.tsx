import {
  EMPTY_FILTERS,
  hasActiveFilters,
  isConflictType,
  isPriority,
  isSensitivity,
  type ConflictFilterState,
} from "./conflictFilters";
import {
  CONFLICT_TYPE_LABEL,
  PRIORITY_META,
  RECORD_TYPES,
  SENSITIVITY_META,
} from "./conflictLabels";

interface ConflictFiltersBarProps {
  filters: ConflictFilterState;
  onChange: (patch: Partial<ConflictFilterState>) => void;
}

/** Record type, conflict type, sensitivity and priority filters. */
export function ConflictFiltersBar({ filters, onChange }: ConflictFiltersBarProps) {
  return (
    <div className="grid gap-3 border-b border-line p-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
      <div>
        <label htmlFor="cf-record" className="field-label">
          Record type
        </label>
        <select
          id="cf-record"
          className="input-field"
          value={filters.entityType}
          onChange={(e) => onChange({ entityType: e.target.value })}
        >
          <option value="">All record types</option>
          {RECORD_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="cf-kind" className="field-label">
          Conflict type
        </label>
        <select
          id="cf-kind"
          className="input-field"
          value={filters.conflictType}
          onChange={(e) => {
            const v = e.target.value;
            onChange({ conflictType: isConflictType(v) ? v : "" });
          }}
        >
          <option value="">All conflict types</option>
          {Object.entries(CONFLICT_TYPE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="cf-sensitivity" className="field-label">
          Sensitivity
        </label>
        <select
          id="cf-sensitivity"
          className="input-field"
          value={filters.phiSensitivity}
          onChange={(e) => {
            const v = e.target.value;
            onChange({ phiSensitivity: isSensitivity(v) ? v : "" });
          }}
        >
          <option value="">Any sensitivity</option>
          {Object.entries(SENSITIVITY_META).map(([value, meta]) => (
            <option key={value} value={value}>
              {meta.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="cf-priority" className="field-label">
          Priority
        </label>
        <select
          id="cf-priority"
          className="input-field"
          value={filters.priority}
          onChange={(e) => {
            const v = e.target.value;
            onChange({ priority: isPriority(v) ? v : "" });
          }}
        >
          <option value="">Any priority</option>
          {Object.entries(PRIORITY_META).map(([value, meta]) => (
            <option key={value} value={value}>
              {meta.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end gap-2">
        {hasActiveFilters(filters) && (
          <button type="button" className="btn-ghost" onClick={() => onChange(EMPTY_FILTERS)}>
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
