import type { ConflictStatsSummary } from "@/services/conflictQueue";

interface ConflictCountsProps {
  /** null when counts are not known (loading, failed, hidden by the server). */
  stats: ConflictStatsSummary | null;
  /** Screen-reader text for an unknown count, e.g. "loading". */
  unknownText: string;
  failed: boolean;
}

/** Counts from the server. Unknown counts show a dash, never a zero. */
export function ConflictCounts({ stats, unknownText, failed }: ConflictCountsProps) {
  const items: { label: string; value: number | undefined }[] = [
    { label: "Open", value: stats?.pending },
    { label: "Needs approval", value: stats?.needsApproval },
    { label: "Resolved today", value: stats?.resolvedToday },
    { label: "Auto-resolved today", value: stats?.autoResolvedToday },
  ];
  return (
    <section aria-label="Conflict counts" className="rounded-lg border border-line bg-surface">
      <dl className="grid grid-cols-2 sm:grid-cols-4 sm:divide-x sm:divide-line">
        {items.map((s) => (
          <div key={s.label} className="px-4 py-3">
            <dt className="text-caption text-ink-muted">{s.label}</dt>
            <dd className="mt-1 text-stat tabular-nums text-ink">
              {s.value === undefined ? (
                <>
                  <span aria-hidden>—</span>
                  <span className="sr-only">{unknownText}</span>
                </>
              ) : (
                s.value
              )}
            </dd>
          </div>
        ))}
      </dl>
      {failed && (
        <p className="border-t border-line px-4 py-2 text-caption text-ink-muted">
          Counts could not be loaded from the server.
        </p>
      )}
    </section>
  );
}
