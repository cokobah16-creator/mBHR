import { Link } from "react-router-dom";

/**
 * Full and quick registration solve different problems (complete record vs
 * queue throughput), so they stay separate pages; this switch makes the
 * choice visible on both.
 */
export function RegistrationModeSwitch({ mode }: { mode: "full" | "quick" }) {
  const base =
    "flex-1 rounded px-3 py-2 min-h-touch-target text-center text-label transition-colors";
  return (
    <nav
      aria-label="Registration type"
      className="mb-4 flex max-w-md gap-1 rounded-md border border-line bg-surface p-1"
    >
      <Link
        to="/register"
        aria-current={mode === "full" ? "page" : undefined}
        className={`${base} ${mode === "full" ? "bg-primary-soft font-semibold text-primary-fg" : "text-ink-secondary hover:bg-surface-hover"}`}
      >
        Full registration
      </Link>
      <Link
        to="/simple/register"
        aria-current={mode === "quick" ? "page" : undefined}
        className={`${base} ${mode === "quick" ? "bg-primary-soft font-semibold text-primary-fg" : "text-ink-secondary hover:bg-surface-hover"}`}
      >
        Quick registration
      </Link>
    </nav>
  );
}
