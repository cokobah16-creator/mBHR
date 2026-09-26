import { Link } from "react-router-dom";
import { CheckIcon, UserCircleIcon, UserGroupIcon } from "@heroicons/react/24/outline";
import { LegalLinks } from "@/pages/legal/LegalLinks";
import { useT } from "@/hooks/useT";
import type { ManagedPatient } from "@/services/patientPortalAuth";
import { OTHER_NAV, PRIMARY_NAV, isActivePath, type NavItem } from "./portalNav";

export function NavRow({
  item,
  label,
  active,
  onNavigate,
}: {
  item: NavItem;
  label: string;
  active: boolean;
  onNavigate?: () => void;
}) {
  const ItemIcon = item.icon;
  return (
    <Link
      to={item.path}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-touch-target items-center gap-3 rounded-md px-3 py-2 text-body transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        active
          ? "bg-primary-soft font-semibold text-primary-fg"
          : "text-ink-secondary hover:bg-surface-hover hover:text-ink"
      }`}
    >
      <ItemIcon className="h-5 w-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{label}</span>
    </Link>
  );
}

/** A labelled list of nav rows. */
export function NavList({
  items,
  pathname,
}: {
  items: NavItem[];
  pathname: string;
}) {
  const { t } = useT();
  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.path}>
          <NavRow
            item={item}
            label={t(item.labelKey)}
            active={isActivePath(pathname, item)}
          />
        </li>
      ))}
    </ul>
  );
}

/** Desktop and tablet-landscape sidebar. Hidden on phones (bottom bar instead). */
export function PortalSideNavigation({ pathname }: { pathname: string }) {
  const { t } = useT();
  return (
    <aside className="hidden w-60 shrink-0 border-r border-line md:block">
      <div className="sticky top-16 max-h-[calc(100vh-4rem)] overflow-y-auto px-3 py-4">
        <nav aria-label={t("portal.nav.menuLabel")}>
          <NavList items={PRIMARY_NAV} pathname={pathname} />
          <p className="section-label mb-1 mt-6 px-3">
            {t("portal.nav.otherServices")}
          </p>
          <NavList items={OTHER_NAV} pathname={pathname} />
        </nav>
        <LegalLinks align="start" className="mt-6 border-t border-line px-1 pt-3" />
      </div>
    </aside>
  );
}

/**
 * Whose records are shown. A caregiver with device-local managed profiles can
 * switch between them; everyone else sees only themself.
 */
export function ProfileOptions({
  name,
  managedPatients,
  activePatientId,
  onSelectSelf,
  onSelect,
}: {
  name: string;
  managedPatients: ManagedPatient[];
  activePatientId: string | null;
  onSelectSelf: () => void;
  onSelect: (patient: ManagedPatient) => void;
}) {
  const { t } = useT();
  const rowClass =
    "flex min-h-touch-target w-full items-center gap-3 rounded-md px-3 py-2 text-left text-body text-ink hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary";
  return (
    <ul className="space-y-0.5">
      <li>
        <button
          type="button"
          onClick={onSelectSelf}
          aria-current={!activePatientId ? "true" : undefined}
          className={rowClass}
        >
          <UserCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            {t("portal.profile.yourself")} – {name}
          </span>
          {!activePatientId && (
            <CheckIcon className="h-5 w-5 shrink-0 text-primary" aria-hidden />
          )}
        </button>
      </li>
      {managedPatients.map((mp) => {
        const selected = activePatientId === mp.patientId;
        return (
          <li key={mp.patientId}>
            <button
              type="button"
              onClick={() => onSelect(mp)}
              aria-current={selected ? "true" : undefined}
              className={rowClass}
            >
              <UserGroupIcon className="h-5 w-5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                {mp.givenName} {mp.familyName}
                {mp.relationship && (
                  <span className="block text-caption text-ink-muted">
                    {mp.relationship}
                  </span>
                )}
              </span>
              {selected && (
                <CheckIcon className="h-5 w-5 shrink-0 text-primary" aria-hidden />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
