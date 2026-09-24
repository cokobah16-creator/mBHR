import type { ReactNode } from "react";
import { InformationCircleIcon } from "@heroicons/react/20/solid";
import { isSupabaseEnabled } from "@/lib/supabaseClient";

interface DataScopeNoteProps {
  /** The period the figures cover, e.g. "Today" or "01/09/2026 – 23/09/2026". */
  period?: ReactNode;
  /**
   * Replaces the default "where the records come from" sentence. Use it when
   * a page's data source does not match the default claim (for example, one
   * that cannot read records downloaded by sync).
   */
  scope?: ReactNode;
  className?: string;
}

/**
 * States where report figures come from. Reports read the local database, so
 * they only include other devices' records once those have synced here.
 */
export function DataScopeNote({ period, scope, className = "" }: DataScopeNoteProps) {
  const defaultScope = isSupabaseEnabled
    ? "Counts records stored on this device, including records other devices have synced here. Anything not yet synced is not counted."
    : "Counts records on this device only. Sync is not set up, so records from other devices are not included.";
  return (
    <p className={`flex items-start gap-1.5 text-caption text-ink-muted ${className}`}>
      <InformationCircleIcon className="mt-px h-4 w-4 shrink-0 text-ink-disabled" aria-hidden />
      <span>
        {period && <span className="font-medium text-ink-secondary">{period}. </span>}
        {scope ?? defaultScope}
      </span>
    </p>
  );
}
