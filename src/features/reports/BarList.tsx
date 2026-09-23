import { percentOf } from "./reportUtils";

interface BarListItem {
  key: string;
  label: string;
  value: number;
  /** Optional text after the value, e.g. "units" or "(12 records)". */
  detail?: string;
}

interface BarListProps {
  items: BarListItem[];
  /**
   * What the bar length is relative to. "share" draws each bar as a share of
   * `total` and prints the percentage; "max" scales to the largest value.
   */
  scale: "share" | "max";
  total?: number;
  label: string;
}

/**
 * Horizontal bars with the number always written out, so the bar is a visual
 * aid only and the list reads correctly without it.
 */
export function BarList({ items, scale, total = 0, label }: BarListProps) {
  const max = items.reduce((m, i) => Math.max(m, i.value), 0);
  return (
    <ul className="space-y-2.5" aria-label={label}>
      {items.map((item) => {
        const pct = scale === "share" ? percentOf(item.value, total) : percentOf(item.value, max);
        const width = item.value > 0 ? Math.max(2, Math.min(100, pct)) : 0;
        return (
          <li key={item.key}>
            <div className="flex items-baseline justify-between gap-3 text-body">
              <span className="min-w-0 truncate text-ink">{item.label}</span>
              <span className="shrink-0 tabular-nums text-ink-secondary">
                {item.value.toLocaleString("en-NG")}
                {item.detail ? ` ${item.detail}` : ""}
                {scale === "share" && total > 0 ? ` (${pct}%)` : ""}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
              <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
