import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog focus handling: moves focus into the dialog (to the element
 * marked data-autofocus, or the first control inside it, else the first
 * control in the dialog), keeps Tab inside it, calls onEscape for the
 * Escape key, and returns focus to whatever was focused before the dialog
 * opened.
 */
export function useDialogFocus(
  ref: RefObject<HTMLElement>,
  onEscape: () => void,
): void {
  const onEscapeRef = useRef(onEscape);

  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const focusables = () =>
      Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );

    // data-autofocus may sit on a control or on a container of controls.
    const marked = node.querySelector<HTMLElement>("[data-autofocus]");
    const initial = marked
      ? marked.matches(FOCUSABLE)
        ? marked
        : marked.querySelector<HTMLElement>(FOCUSABLE)
      : null;
    (initial ?? focusables()[0] ?? node).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // An open suggestion list (e.g. the patient search) uses Escape to
        // close itself; that must not also discard the whole dialog.
        const target = event.target;
        if (
          target instanceof HTMLElement &&
          (target.getAttribute("aria-expanded") === "true" ||
            target.closest("[data-local-escape]"))
        ) {
          return;
        }
        event.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    node.addEventListener("keydown", onKeyDown);
    return () => {
      node.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [ref]);
}
