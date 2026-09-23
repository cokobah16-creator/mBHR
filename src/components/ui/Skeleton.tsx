/**
 * Loading placeholders shaped like the content they stand in for, so the
 * page does not jump when data arrives and staff can tell the device has
 * not frozen. All are aria-hidden with a single polite status for readers.
 */

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = "" }: SkeletonProps) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

function LoadingStatus({ label }: { label: string }) {
  return (
    <span role="status" className="sr-only">
      {label}
    </span>
  );
}

export function SkeletonText({
  lines = 3,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-3.5 ${i === lines - 1 ? "w-2/3" : "w-full"}`}
        />
      ))}
    </div>
  );
}

function TableRows({ rows, cols }: { rows: number; cols: number }) {
  return (
    <div className="divide-y divide-line" aria-hidden>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3">
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton
              key={c}
              className={`h-4 ${c === 0 ? "w-40" : c === cols - 1 ? "w-16 ml-auto" : "w-24"}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function PageHeaderSkeleton() {
  return (
    <div className="mb-6 space-y-2" aria-hidden>
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-4 w-80 max-w-full" />
    </div>
  );
}

export function PatientListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div>
      <LoadingStatus label="Loading patients" />
      <div className="panel overflow-hidden">
        <div className="px-4 py-3 border-b border-line">
          <Skeleton className="h-10 w-full max-w-md" />
        </div>
        <TableRows rows={rows} cols={4} />
      </div>
    </div>
  );
}

export function QueueSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div>
      <LoadingStatus label="Loading queue" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4" aria-hidden>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="panel p-4 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-10" />
          </div>
        ))}
      </div>
      <div className="panel overflow-hidden">
        <TableRows rows={rows} cols={6} />
      </div>
    </div>
  );
}

export function PatientDetailSkeleton() {
  return (
    <div>
      <LoadingStatus label="Loading patient record" />
      <div className="panel p-5 mb-4 space-y-3" aria-hidden>
        <div className="flex items-center gap-4">
          <Skeleton className="h-14 w-14 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
        </div>
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="grid lg:grid-cols-3 gap-4" aria-hidden>
        <div className="panel p-5 lg:col-span-2">
          <SkeletonText lines={6} />
        </div>
        <div className="panel p-5">
          <SkeletonText lines={4} />
        </div>
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div>
      <LoadingStatus label="Loading dashboard" />
      <PageHeaderSkeleton />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6" aria-hidden>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="panel p-4 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-14" />
          </div>
        ))}
      </div>
      <div className="grid lg:grid-cols-2 gap-4" aria-hidden>
        <div className="panel overflow-hidden">
          <TableRows rows={5} cols={3} />
        </div>
        <div className="panel overflow-hidden">
          <TableRows rows={5} cols={3} />
        </div>
      </div>
    </div>
  );
}

export function ConsultationSkeleton() {
  return (
    <div>
      <LoadingStatus label="Loading consultation" />
      <div className="grid lg:grid-cols-[20rem_1fr] gap-4" aria-hidden>
        <div className="panel p-4 space-y-4">
          <SkeletonText lines={3} />
          <SkeletonText lines={4} />
        </div>
        <div className="panel p-5 space-y-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-20 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PharmacySkeleton() {
  return (
    <div>
      <LoadingStatus label="Loading pharmacy" />
      <div className="panel overflow-hidden" aria-hidden>
        <TableRows rows={6} cols={5} />
      </div>
    </div>
  );
}

export function PortalSkeleton() {
  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6">
      <LoadingStatus label="Loading your health record" />
      <div className="space-y-4" aria-hidden>
        <Skeleton className="h-7 w-64" />
        <div className="panel p-5 space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-6 w-48" />
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="panel p-4">
              <Skeleton className="h-5 w-32" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Generic route-level fallback: header + a content panel. */
export function PageSkeleton() {
  return (
    <div>
      <LoadingStatus label="Loading" />
      <PageHeaderSkeleton />
      <div className="panel p-5" aria-hidden>
        <SkeletonText lines={5} />
      </div>
    </div>
  );
}

/** Full-screen fallback for routes rendered outside the staff shell. */
export function ScreenSkeleton({ label = "Loading" }: { label?: string }) {
  return (
    <div className="min-h-screen bg-canvas p-4 sm:p-8">
      <LoadingStatus label={label} />
      <div className="max-w-3xl mx-auto space-y-4" aria-hidden>
        <Skeleton className="h-7 w-56" />
        <div className="panel p-5">
          <SkeletonText lines={5} />
        </div>
      </div>
    </div>
  );
}
