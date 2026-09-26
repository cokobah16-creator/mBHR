import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeftOnRectangleIcon,
  EllipsisHorizontalIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { LanguageSelector } from "@/components/LanguageSelector";
import { LegalLinks } from "@/pages/legal/LegalLinks";
import { useT } from "@/hooks/useT";
import { NavList, ProfileOptions } from "./PortalNavigation";
import type { PortalProfileProps } from "./PortalHeader";
import {
  BOTTOM_NAV,
  MORE_NAV,
  OTHER_NAV,
  isActivePath,
  isMoreActive,
} from "./portalNav";
import { useFocusTrap } from "./useFocusTrap";

const TAB_CLASS =
  "flex min-h-[56px] w-full flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-caption focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary";

function TabIcon({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <span
      className={`flex h-7 w-12 items-center justify-center rounded-full ${
        active ? "bg-primary-soft" : ""
      }`}
    >
      {children}
    </span>
  );
}

/**
 * Phones: a bottom bar with the four most-used places and "More", which opens
 * a sheet with every other section, language, profile switch and sign out.
 */
export function PortalMobileNavigation({
  pathname,
  profile,
  signingOut,
  onSignOut,
}: {
  pathname: string;
  profile: PortalProfileProps;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  const { t } = useT();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Leaving a page closes the sheet.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  const closeMore = useCallback(() => {
    setMoreOpen(false);
    moreButtonRef.current?.focus();
  }, []);

  useFocusTrap(moreOpen, sheetRef, closeMore, closeRef);

  const moreActive = isMoreActive(pathname);

  return (
    <>
      <nav
        aria-label={t("portal.nav.menuLabel")}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-safe-bottom md:hidden"
      >
        <ul className="flex">
          {BOTTOM_NAV.map((item) => {
            const ItemIcon = item.icon;
            const active = isActivePath(pathname, item);
            return (
              <li key={item.path} className="min-w-0 flex-1">
                <Link
                  to={item.path}
                  aria-current={active ? "page" : undefined}
                  className={`${TAB_CLASS} ${
                    active ? "font-semibold text-primary-fg" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  <TabIcon active={active}>
                    <ItemIcon className="h-6 w-6" aria-hidden />
                  </TabIcon>
                  <span className="max-w-full break-words text-center leading-tight">
                    {t(item.labelKey)}
                  </span>
                </Link>
              </li>
            );
          })}
          <li className="min-w-0 flex-1">
            <button
              ref={moreButtonRef}
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className={`${TAB_CLASS} ${
                moreActive ? "font-semibold text-primary-fg" : "text-ink-muted hover:text-ink"
              }`}
            >
              <TabIcon active={moreActive}>
                <EllipsisHorizontalIcon className="h-6 w-6" aria-hidden />
              </TabIcon>
              <span className="leading-tight">{t("portal.nav.more")}</span>
            </button>
          </li>
        </ul>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={closeMore} aria-hidden />
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="portal-more-title"
            className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface pb-safe-bottom shadow-lg"
          >
            <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface px-4 py-2">
              <h2 id="portal-more-title" className="text-h2 text-ink">
                {t("portal.nav.more")}
              </h2>
              <button
                ref={closeRef}
                type="button"
                onClick={closeMore}
                className="btn-ghost"
                aria-label={t("portal.nav.closeMenu")}
              >
                <XMarkIcon className="h-6 w-6" aria-hidden />
              </button>
            </div>

            <div className="space-y-4 px-2 py-3">
              <nav aria-label={t("portal.nav.more")}>
                <NavList items={MORE_NAV} pathname={pathname} />
                <p className="section-label mb-1 mt-4 px-3">
                  {t("portal.nav.otherServices")}
                </p>
                <NavList items={OTHER_NAV} pathname={pathname} />
              </nav>

              {profile.managedPatients.length > 0 && (
                <section aria-labelledby="portal-more-profiles">
                  <p id="portal-more-profiles" className="section-label mb-1 px-3">
                    {t("portal.profile.switchProfile")}
                  </p>
                  <ProfileOptions
                    name={profile.name}
                    managedPatients={profile.managedPatients}
                    activePatientId={profile.activePatientId}
                    onSelectSelf={profile.onSelectSelf}
                    onSelect={profile.onSelectProfile}
                  />
                </section>
              )}

              <section aria-labelledby="portal-more-language" className="px-3">
                <p id="portal-more-language" className="section-label mb-2">
                  {t("portal.nav.language")}
                </p>
                <LanguageSelector />
              </section>

              <div className="border-t border-line px-1 pt-3">
                <button
                  type="button"
                  onClick={onSignOut}
                  disabled={signingOut}
                  className="btn-secondary w-full"
                >
                  <ArrowLeftOnRectangleIcon className="h-5 w-5" aria-hidden />
                  {signingOut ? t("portal.nav.signingOut") : t("portal.nav.logout")}
                </button>
              </div>

              <LegalLinks />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
