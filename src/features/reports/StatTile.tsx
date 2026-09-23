import type { ComponentType, ReactNode, SVGProps } from "react";

interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Period or basis of the figure, e.g. "Today" or "All records". */
  hint?: ReactNode;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  /** Extra line under the value, e.g. a comparison with yesterday. */
  footer?: ReactNode;
}

/** A single headline figure on a bordered surface. Colour-neutral by design. */
export function StatTile({ label, value, hint, icon: Icon, footer }: StatTileProps) {
  return (
    <div className="panel p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-label text-ink-secondary">{label}</p>
        {Icon && <Icon className="h-5 w-5 shrink-0 text-ink-disabled" aria-hidden />}
      </div>
      <p className="mt-1 text-stat tabular-nums text-ink">{value}</p>
      {hint && <p className="text-caption text-ink-muted">{hint}</p>}
      {footer && <div className="mt-1 text-caption text-ink-secondary">{footer}</div>}
    </div>
  );
}
