import { Fragment } from "react";
import { Link } from "react-router-dom";

export interface LegalLinkTarget {
  to: string;
  label: string;
}

// The privacy notice and the terms of use, in the order shown. Not exported:
// react-refresh allows only components and primitive constants here.
const LEGAL_LINK_TARGETS: readonly LegalLinkTarget[] = [
  { to: "/privacy", label: "Privacy notice" },
  { to: "/terms", label: "Terms of use" },
];

const LINK_CLASS =
  "inline-flex min-h-touch-target items-center rounded-md px-2 text-primary-fg underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary";

interface LegalLinksProps {
  /** Name of the link group for screen readers. */
  label?: string;
  /** Links shown before the privacy notice and terms, such as a home link. */
  before?: readonly LegalLinkTarget[];
  /** "center" under a sign-in card, "start" in a side menu. */
  align?: "center" | "start";
  className?: string;
}

/**
 * Links to the privacy notice and the terms of use, separated by dots. Used
 * on every screen where someone signs in, signs up or sets up a device, and
 * in the signed-in portal menus. Both pages are bundled with the app and
 * precached by the service worker, so the links need no network.
 */
export function LegalLinks({
  label = "Legal",
  before = [],
  align = "center",
  className = "",
}: LegalLinksProps) {
  const links = [...before, ...LEGAL_LINK_TARGETS];
  const justify = align === "start" ? "justify-start" : "justify-center";
  return (
    <nav
      aria-label={label}
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-label ${justify} ${className}`.trim()}
    >
      {links.map((link, i) => (
        <Fragment key={link.to}>
          {i > 0 && (
            <span aria-hidden className="text-ink-disabled">
              ·
            </span>
          )}
          <Link to={link.to} className={LINK_CLASS}>
            {link.label}
          </Link>
        </Fragment>
      ))}
    </nav>
  );
}
