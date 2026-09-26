import type { ReactNode } from "react";
import { PageHeader, type Crumb } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Page frame for patient portal screens: one readable column, a clear title
 * and a line saying what the page shows and where it comes from.
 */
export function PortalPage({
  title,
  description,
  breadcrumbs,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <PageHeader
        title={title}
        description={description}
        breadcrumbs={breadcrumbs}
        actions={actions}
      />
      <div className="space-y-5">{children}</div>
    </div>
  );
}

// Kept here so existing pages keep importing it from PortalPage.
export { PatientFriendlyAlert as PortalNotice } from "./ui/PatientFriendlyAlert";

/** Loading placeholder shaped like a portal list page. */
export function PortalListSkeleton({
  label = "Loading",
  rows = 4,
}: {
  label?: string;
  rows?: number;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <span role="status" className="sr-only">
        {label}
      </span>
      <div className="space-y-4" aria-hidden>
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
        <div className="panel divide-y divide-line">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="space-y-2 p-4">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
