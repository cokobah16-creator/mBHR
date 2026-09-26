/**
 * Loading placeholders shaped like each portal page, so the page does not
 * jump when data arrives and a slow phone never shows one spinner for the
 * whole portal. Each has one polite status for screen readers; the shapes
 * themselves are hidden from them.
 */
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { useT } from "@/hooks/useT";

function Status({ labelKey }: { labelKey: string }) {
  const { t } = useT();
  return (
    <span role="status" className="sr-only">
      {t(labelKey)}
    </span>
  );
}

function Frame({ labelKey, children }: { labelKey: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Status labelKey={labelKey} />
      <div className="space-y-5" aria-hidden>
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        {children}
      </div>
    </div>
  );
}

/** Rows of a grouped list: a title line, a detail line, an optional badge. */
function ListRows({ rows, badge = false }: { rows: number; badge?: boolean }) {
  return (
    <div className="panel divide-y divide-line">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-start justify-between gap-4 p-4">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-5 w-48 max-w-full" />
            <Skeleton className="h-4 w-64 max-w-full" />
          </div>
          {badge && <Skeleton className="h-6 w-20 shrink-0" />}
        </div>
      ))}
    </div>
  );
}

export function PortalHomeSkeleton() {
  return (
    <Frame labelKey="portal.state.loading.home">
      <div className="panel space-y-3 p-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-6 w-56 max-w-full" />
        <Skeleton className="h-4 w-44" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[88px]" />
        ))}
      </div>
      <ListRows rows={3} />
    </Frame>
  );
}

export function VisitListSkeleton() {
  return (
    <Frame labelKey="portal.state.loading.visits">
      <ListRows rows={4} badge />
    </Frame>
  );
}

export function VisitDetailSkeleton() {
  return (
    <Frame labelKey="portal.state.loading.visit">
      <div className="panel space-y-3 p-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <ListRows rows={2} />
    </Frame>
  );
}

export function LabResultsSkeleton() {
  return (
    <Frame labelKey="portal.state.loading.labs">
      <ListRows rows={4} badge />
    </Frame>
  );
}

export function MedicinesSkeleton() {
  return (
    <Frame labelKey="portal.state.loading.medicines">
      <ListRows rows={3} />
    </Frame>
  );
}

export function AppointmentsSkeleton() {
  return (
    <Frame labelKey="portal.state.loading.appointments">
      <div className="panel space-y-3 p-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-6 w-52 max-w-full" />
        <Skeleton className="h-4 w-40" />
      </div>
      <ListRows rows={3} badge />
    </Frame>
  );
}

export function MessagesSkeleton() {
  return (
    <Frame labelKey="portal.state.loading.messages">
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`flex ${i % 2 ? "justify-end" : "justify-start"}`}>
            <Skeleton className="h-16 w-3/4 max-w-sm" />
          </div>
        ))}
      </div>
      <Skeleton className="h-12 w-full" />
    </Frame>
  );
}

export function DocumentsSkeleton() {
  return (
    <Frame labelKey="portal.state.loading.documents">
      <Skeleton className="h-24 w-full" />
      <ListRows rows={3} />
    </Frame>
  );
}
