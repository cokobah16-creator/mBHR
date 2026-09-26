import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * While `active`, keep Tab and Shift+Tab inside `container`, focus
 * `initialFocus` (or the first control), and call `onEscape` on Escape.
 * Used by portal sheets and dialogs so each does not hand-roll its own trap.
 */
export function useFocusTrap(
  active: boolean,
  container: RefObject<HTMLElement>,
  onEscape: () => void,
  initialFocus?: RefObject<HTMLElement>,
): void {
  useEffect(() => {
    if (!active) return;
    const root = container.current;
    const first = initialFocus?.current ?? root?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onEscape();
        return;
      }
      if (e.key !== "Tab" || !container.current) return;
      const items = Array.from(
        container.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      if (items.length === 0) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, container, onEscape, initialFocus]);
}
