import { DocumentDuplicateIcon } from "@heroicons/react/24/outline";
import type { ConflictView } from "@/services/conflictQueue";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatTimestamp } from "./conflictLabels";

interface ConflictEmptyStateProps {
  view: ConflictView;
  filtersActive: boolean;
  onClearFilters: () => void;
  /** false when the device has no online sign-in, so rows may be hidden. */
  cloudSession: boolean | null;
  loadedAt: Date | null;
}

/** What an empty list means, stated only as far as we actually know. */
export function ConflictEmptyState({
  view,
  filtersActive,
  onClearFilters,
  cloudSession,
  loadedAt,
}: ConflictEmptyStateProps) {
  if (filtersActive) {
    return (
      <EmptyState
        icon={DocumentDuplicateIcon}
        title="No conflicts match these filters"
        description="Try another record type, sensitivity or priority."
        action={
          <button type="button" className="btn-secondary" onClick={onClearFilters}>
            Clear filters
          </button>
        }
      />
    );
  }
  if (cloudSession === false) {
    return (
      <EmptyState
        icon={DocumentDuplicateIcon}
        title="No conflicts visible to this device"
        description="This device is not signed in online, and the server only shows conflicts to staff signed in with their online account. There may be conflicts you cannot see."
      />
    );
  }
  const checked = loadedAt ? ` (checked ${formatTimestamp(loadedAt)})` : "";
  if (view === "open") {
    return (
      <EmptyState
        icon={DocumentDuplicateIcon}
        title="No open conflicts"
        description={`No conflicts are open on the server${checked}. Conflicts with high-sensitivity patient details are listed under Needs approval. New conflicts are added when a device's Sync now finds a record changed in two places, or when you scan for duplicates.`}
      />
    );
  }
  if (view === "needs_approval") {
    return (
      <EmptyState
        icon={DocumentDuplicateIcon}
        title="Nothing needs approval"
        description={`Conflicts with high-sensitivity patient details, and decisions on them, wait here for an approver${checked}.`}
      />
    );
  }
  return (
    <EmptyState
      icon={DocumentDuplicateIcon}
      title="No resolved conflicts yet"
      description="Decisions appear here with who made them, when, and which side was kept."
    />
  );
}
