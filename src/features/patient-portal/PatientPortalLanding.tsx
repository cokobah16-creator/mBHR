import type { ComponentType, SVGProps } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDownTrayIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarIcon,
  ChatBubbleLeftRightIcon,
  ChevronDownIcon,
  ClipboardDocumentListIcon,
  DevicePhoneMobileIcon,
  InformationCircleIcon,
  LanguageIcon,
  LockClosedIcon,
} from "@heroicons/react/24/outline";
import { isSupabaseEnabled } from "@/lib/supabaseClient";
import { useT } from "@/hooks/useT";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const FEATURES: {
  icon: Icon;
  /** Key under portal.landing.feature. */
  id: string;
  /** Only works with an online account (Supabase). */
  needsOnline?: boolean;
}[] = [
  {
    icon: ClipboardDocumentListIcon,
    id: "records",
  },
  {
    icon: CalendarIcon,
    id: "appointments",
    needsOnline: true,
  },
  {
    icon: ChatBubbleLeftRightIcon,
    id: "messages",
    needsOnline: true,
  },
  {
    icon: ArrowDownTrayIcon,
    id: "copy",
  },
  {
    icon: LockClosedIcon,
    id: "signin",
  },
  {
    icon: DevicePhoneMobileIcon,
    id: "phone",
  },
];

const STEPS: { id: string; body: string }[] = [
  {
    id: "account",
    body: "portal.landing.step.account.body",
  },
  {
    id: "login",
    body: "portal.landing.step.login.body",
  },
  {
    id: "use",
    body: isSupabaseEnabled
      ? "portal.landing.step.use.bodyOnline"
      : "portal.landing.step.use.bodyOffline",
  },
];

const linkClass =
  "font-medium text-primary-fg underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary";

export function PatientPortalLanding() {
  const { t } = useT();
  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-40 border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link
            to="/"
            className="flex items-center gap-2.5 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <img
              src="/brand/mbhr-mark.svg"
              alt=""
              aria-hidden
              className="h-9 w-9 rounded-lg"
            />
            <span className="text-left">
              <span className="block text-label font-semibold text-ink">
                {t("portal.landing.brand")}
              </span>
              <span className="block text-caption text-ink-muted">
                {t("portal.landing.tagline")}
              </span>
            </span>
          </Link>
          <Link to="/" className="btn-ghost">
            <ArrowLeftIcon className="h-5 w-5" aria-hidden />
            <span className="sr-only sm:not-sr-only">{t("portal.landing.back")}</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-10 px-4 py-10 sm:px-6 sm:py-14">
        <section className="mx-auto max-w-2xl text-center" aria-labelledby="portal-hero">
          <p className="mb-4 inline-flex items-center gap-2 text-label text-ink-secondary">
            <LanguageIcon className="h-5 w-5 text-ink-muted" aria-hidden />
            {t("portal.landing.languages")}
          </p>
          <h1 id="portal-hero" className="text-display text-ink">
            {t("portal.landing.hero")}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-body text-ink-secondary">
            {isSupabaseEnabled
              ? t("portal.landing.introOnline")
              : t("portal.landing.introOffline")}
          </p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <Link to="/patient/register" className="btn-primary">
              {t("portal.landing.create")}
              <ArrowRightIcon className="h-5 w-5" aria-hidden />
            </Link>
            <Link to="/patient/login" className="btn-secondary">
              {t("portal.landing.haveAccount")}
            </Link>
          </div>
          <p className="mx-auto mt-5 flex max-w-xl items-start justify-center gap-2 text-left text-caption text-ink-muted">
            <InformationCircleIcon className="h-4 w-4 shrink-0" aria-hidden />
            {isSupabaseEnabled ? (
              <span>{t("portal.landing.needInternet")}</span>
            ) : (
              <span>{t("portal.landing.offlineMode")}</span>
            )}
          </p>
        </section>

        <section aria-labelledby="portal-features" className="panel">
          <div className="panel-header">
            <h2 id="portal-features" className="panel-title">
              {t("portal.landing.featuresTitle")}
            </h2>
          </div>
          <ul className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: I, id, needsOnline }) => (
              <li key={id} className="flex items-start gap-3 bg-surface p-4">
                <I className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden />
                <span>
                  <span className="block text-h3 text-ink">
                    {t(`portal.landing.feature.${id}.title`)}
                  </span>
                  <span className="mt-0.5 block text-body text-ink-secondary">
                    {t(`portal.landing.feature.${id}.body`)}
                  </span>
                  {needsOnline && !isSupabaseEnabled && (
                    <span className="mt-1 block text-caption text-ink-muted">
                      {t("portal.landing.needsOnline")}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="portal-steps" className="panel">
          <div className="panel-header">
            <h2 id="portal-steps" className="panel-title">
              {t("portal.landing.stepsTitle")}
            </h2>
          </div>
          <ol className="panel-body grid gap-5 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.id} className="flex items-start gap-3">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line-strong text-label text-ink"
                  aria-hidden
                >
                  {i + 1}
                </span>
                <span>
                  <span className="block text-h3 text-ink">
                    <span className="sr-only">
                      {t("portal.landing.stepN", { n: String(i + 1) })}{" "}
                    </span>
                    {t(`portal.landing.step.${step.id}.title`)}
                  </span>
                  <span className="mt-0.5 block text-body text-ink-secondary">
                    {t(step.body)}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="portal-faq" className="panel">
          <div className="panel-header">
            <h2 id="portal-faq" className="panel-title">
              {t("portal.landing.faqTitle")}
            </h2>
          </div>
          <div className="divide-y divide-line">
            <details className="group">
              <summary className="flex min-h-touch-target cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-body font-medium text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
                <span>{t("portal.landing.faq.who.q")}</span>
                <ChevronDownIcon
                  className="h-5 w-5 shrink-0 text-ink-muted group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <p className="px-4 pb-4 text-body text-ink-secondary">
                {t("portal.landing.faq.who.a")}
              </p>
            </details>
            <details className="group">
              <summary className="flex min-h-touch-target cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-body font-medium text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
                <span>{t("portal.landing.faq.private.q")}</span>
                <ChevronDownIcon
                  className="h-5 w-5 shrink-0 text-ink-muted group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <p className="px-4 pb-4 text-body text-ink-secondary">
                {t("portal.landing.faq.private.a1")}{" "}
                <Link to="/privacy" className={linkClass}>
                  {t("portal.landing.privacy")}
                </Link>{" "}
                {t("portal.landing.faq.private.a2")}
              </p>
            </details>
            <details className="group">
              <summary className="flex min-h-touch-target cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-body font-medium text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
                <span>{t("portal.landing.faq.forgot.q")}</span>
                <ChevronDownIcon
                  className="h-5 w-5 shrink-0 text-ink-muted group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <p className="px-4 pb-4 text-body text-ink-secondary">
                {t("portal.landing.faq.forgot.a")}
              </p>
            </details>
            <details className="group">
              <summary className="flex min-h-touch-target cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-body font-medium text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
                <span>{t("portal.landing.faq.emergency.q")}</span>
                <ChevronDownIcon
                  className="h-5 w-5 shrink-0 text-ink-muted group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <p className="px-4 pb-4 text-body text-ink-secondary">
                {t("portal.landing.faq.emergency.a")}
              </p>
            </details>
            <details className="group">
              <summary className="flex min-h-touch-target cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-body font-medium text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
                <span>{t("portal.landing.faq.internet.q")}</span>
                <ChevronDownIcon
                  className="h-5 w-5 shrink-0 text-ink-muted group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <p className="px-4 pb-4 text-body text-ink-secondary">
                {t("portal.landing.faq.internet.a")}
              </p>
            </details>
          </div>
        </section>

        <section
          aria-labelledby="portal-start"
          className="rounded-lg border border-line bg-surface px-6 py-8 text-center"
        >
          <h2 id="portal-start" className="text-h2 text-ink">
            {t("portal.landing.readyTitle")}
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-body text-ink-secondary">
            {t("portal.landing.free")}
          </p>
          <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
            <Link to="/patient/register" className="btn-primary">
              {t("portal.landing.create")}
            </Link>
            <Link to="/patient/login" className="btn-secondary">
              {t("portal.landing.login")}
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto max-w-5xl space-y-2 px-4 py-6 text-center text-caption text-ink-muted sm:px-6">
          <p className="text-label text-ink-secondary">
            {t("portal.landing.footerOrg")}
          </p>
          <nav aria-label={t("portal.landing.legal")} className="flex flex-wrap items-center justify-center gap-x-2">
            <Link
              to="/privacy"
              className="inline-flex min-h-touch-target items-center px-2 text-primary-fg underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t("portal.landing.privacy")}
            </Link>
            <span aria-hidden>·</span>
            <Link
              to="/terms"
              className="inline-flex min-h-touch-target items-center px-2 text-primary-fg underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t("portal.landing.terms")}
            </Link>
          </nav>
          <p>
            {t("portal.landing.help")}
          </p>
        </div>
      </footer>
    </div>
  );
}
