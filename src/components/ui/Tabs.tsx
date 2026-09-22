import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { tabId, panelId } from "./tabIds";

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  /** Small count or status shown after the label (e.g. number of items). */
  badge?: ReactNode;
}

interface TabsProps<T extends string> {
  tabs: TabItem<T>[];
  active: T;
  onChange: (id: T) => void;
  /** Prefix for tab/panel ids so panels can reference their tab. */
  idPrefix: string;
  label: string;
  className?: string;
}


/**
 * Accessible tab bar (WAI-ARIA tabs pattern): arrow keys, Home and End move
 * between tabs; only the active tab is in the tab order. Render each panel
 * with role="tabpanel", id={panelId(...)} and aria-labelledby={tabId(...)}.
 */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  idPrefix,
  label,
  className = "",
}: TabsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next === -1) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={`flex gap-1 overflow-x-auto border-b border-line ${className}`}
    >
      {tabs.map((t, i) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, t.id)}
            aria-selected={selected}
            aria-controls={panelId(idPrefix, t.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 min-h-touch-target text-label transition-colors ${
              selected
                ? "border-primary text-primary-fg font-semibold"
                : "border-transparent text-ink-secondary hover:border-line-strong hover:text-ink"
            }`}
          >
            {t.label}
            {t.badge !== undefined && t.badge !== null && t.badge !== "" && (
              <span className="rounded bg-surface-sunken px-1.5 text-caption tabular-nums text-ink-secondary">
                {t.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
