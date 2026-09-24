import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Focus handling for a messaging panel shown as an overlay drawer: moves
 * focus into the panel when it opens, keeps Tab inside it, closes it on
 * Escape and returns focus to whatever opened it.
 *
 * Escape pressed inside a <select> or a filled search box is left to that
 * control (closing its list / clearing it) so it does not also close the
 * panel. Escape inside any other text field that has text is ignored too,
 * so a half-written message or announcement is not thrown away by one key.
 */
export function usePanelFocus(
  rootRef: RefObject<HTMLElement>,
  initialFocusRef: RefObject<HTMLElement>,
  enabled: boolean,
  onClose?: () => void,
): void {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!enabled) return;
    const root = rootRef.current;
    if (!root) return;

    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    initialFocusRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const t = e.target;
        if (t instanceof HTMLSelectElement || !closeRef.current) return;
        // Escape in a filled search box clears it (browser default) instead;
        // in any other filled text field it does nothing, so typed text is
        // not lost by closing the panel.
        if (
          (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) &&
          t.value
        ) {
          return;
        }
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = Array.from(
        root.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.getClientRects().length > 0);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      if (!current || !root.contains(current)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      // Focus can sit on an element outside the tab order (the heading gets
      // focus when a view opens), so wrap whenever nothing tabbable lies in
      // the direction of travel, not only on the first/last item.
      const precedes = (a: Node, b: Node) =>
        (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      if (e.shiftKey) {
        if (!items.some((el) => el !== current && precedes(el, current))) {
          e.preventDefault();
          last.focus();
        }
      } else if (!items.some((el) => el !== current && precedes(current, el))) {
        e.preventDefault();
        first.focus();
      }
    };

    root.addEventListener("keydown", onKeyDown);
    return () => {
      root.removeEventListener("keydown", onKeyDown);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [enabled, rootRef, initialFocusRef]);
}
