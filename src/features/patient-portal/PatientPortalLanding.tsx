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

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const FEATURES: {
  icon: Icon;
  title: string;
  body: string;
  /** Only works with an online account (Supabase). */
  needsOnline?: boolean;
}[] = [
  {
    icon: ClipboardDocumentListIcon,
    title: "Your medical records",
    body: "See your clinic visits, medicines and test results in one place.",
  },
  {
    icon: CalendarIcon,
    title: "Appointments",
    body: "Ask for an appointment on a day that suits you, and see visits you have booked.",
    needsOnline: true,
  },
  {
    icon: ChatBubbleLeftRightIcon,
    title: "Messages",
    body: "Send non-urgent questions to your care team.",
    needsOnline: true,
  },
  {
    icon: ArrowDownTrayIcon,
    title: "A copy of your record",
    body: "Download your health record as a file you can keep or give to another doctor.",
  },
  {
    icon: LockClosedIcon,
    title: "Private sign-in",
    body: "Log in with your email and password, or with a 6-digit PIN on a device set up for offline use.",
  },
  {
    icon: DevicePhoneMobileIcon,
    title: "Works on your phone",
    body: "Use it on a phone, tablet or computer.",
  },
];

const STEPS: { title: string; body: string }[] = [
  {
    title: "Create your account",
    body: "Use the email address the clinic has for you, so your account can be linked to your clinic record.",
  },
  {
    title: "Log in",
    body: "Log in with your email and password (or your 6-digit PIN on a device set up for offline use).",
  },
  {
    title: "Use your record",
    body: isSupabaseEnabled
      ? "See your visits, results and medicines, ask for appointments and message your care team."
      : "See your visits, results and medicines, and download a copy of your record.",
  },
];

const linkClass =
  "font-medium text-primary-fg underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary";

export function PatientPortalLanding() {
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
                MedBridge Patient Portal
              </span>
              <span className="block text-caption text-ink-muted">
                Bridging Care, Reaching All.
              </span>
            </span>
          </Link>
          <Link to="/" className="btn-ghost">
            <ArrowLeftIcon className="h-5 w-5" aria-hidden />
            <span className="sr-only sm:not-sr-only">Back to Home</span>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-10 px-4 py-10 sm:px-6 sm:py-14">
        <section className="mx-auto max-w-2xl text-center" aria-labelledby="portal-hero">
          <p className="mb-4 inline-flex items-center gap-2 text-label text-ink-secondary">
            <LanguageIcon className="h-5 w-5 text-ink-muted" aria-hidden />
            Available in English, Hausa, Yoruba, Igbo and Pidgin
          </p>
          <h1 id="portal-hero" className="text-display text-ink">
            Your health record, in your hands.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-body text-ink-secondary">
            {isSupabaseEnabled
              ? "See your records from mBHR outreach clinics, ask for appointments and message your care team."
              : "See your records from mBHR outreach clinics and download a copy of them."}
          </p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <Link to="/patient/register" className="btn-primary">
              Create an account
              <ArrowRightIcon className="h-5 w-5" aria-hidden />
            </Link>
            <Link to="/patient/login" className="btn-secondary">
              I already have an account
            </Link>
          </div>
          <p className="mx-auto mt-5 flex max-w-xl items-start justify-center gap-2 text-left text-caption text-ink-muted">
            <InformationCircleIcon className="h-4 w-4 shrink-0" aria-hidden />
            {isSupabaseEnabled ? (
              <span>
                You need an internet connection to log in and see your latest
                records.
              </span>
            ) : (
              <span>
                This device is in offline mode. Portal accounts and records are
                kept on this device only.
              </span>
            )}
          </p>
        </section>

        <section aria-labelledby="portal-features" className="panel">
          <div className="panel-header">
            <h2 id="portal-features" className="panel-title">
              What you can do
            </h2>
          </div>
          <ul className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: I, title, body, needsOnline }) => (
              <li key={title} className="flex items-start gap-3 bg-surface p-4">
                <I className="mt-0.5 h-6 w-6 shrink-0 text-primary" aria-hidden />
                <span>
                  <span className="block text-h3 text-ink">{title}</span>
                  <span className="mt-0.5 block text-body text-ink-secondary">
                    {body}
                  </span>
                  {needsOnline && !isSupabaseEnabled && (
                    <span className="mt-1 block text-caption text-ink-muted">
                      Needs an online account, so it is not available on this
                      device.
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
              How it works
            </h2>
          </div>
          <ol className="panel-body grid gap-5 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex items-start gap-3">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line-strong text-label text-ink"
                  aria-hidden
                >
                  {i + 1}
                </span>
                <span>
                  <span className="block text-h3 text-ink">
                    <span className="sr-only">Step {i + 1}: </span>
                    {step.title}
                  </span>
                  <span className="mt-0.5 block text-body text-ink-secondary">
                    {step.body}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="portal-faq" className="panel">
          <div className="panel-header">
            <h2 id="portal-faq" className="panel-title">
              Common questions
            </h2>
          </div>
          <div className="divide-y divide-line">
            <details className="group">
              <summary className="flex min-h-touch-target cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-body font-medium text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
                <span>Who can register?</span>
                <ChevronDownIcon
                  className="h-5 w-5 shrink-0 text-ink-muted group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <p className="px-4 pb-4 text-body text-ink-secondary">
                Anyone who has been seen at an mBHR outreach clinic. Use the
                same email address (or phone number) the clinic has for you so
                your account can be linked to your record. If you cannot see
                your visits after logging in, ask clinic staff to link your
                record.
              </p>
            </details>
            <details className="group">
              <summary className="flex min-h-touch-target cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-body font-medium text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
                <span>Is my health information private?</span>
                <ChevronDownIcon
                  className="h-5 w-5 shrink-0 text-ink-muted group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <p className="px-4 pb-4 text-body text-ink-secondary">
                Only people who log in to your account can see your records in
                the portal. Keep your password or PIN to yourself, and log out
                when you use a shared phone or computer. Our{" "}
                <Link to="/privacy" className={linkClass}>
                  Privacy notice
                </Link>{" "}
                explains how your information is used.
              </p>
            </details>
            <details className="group">
              <summary className="flex min-h-touch-target cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-body font-medium text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
                <span>What if I forget my password or PIN?</span>
                <ChevronDownIcon
                  className="h-5 w-5 shrink-0 text-ink-muted group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <p className="px-4 pb-4 text-body text-ink-secondary">
                For an online account, choose “Forgot password?” on the login
                page and we will email you a reset link. If you log in with a
                PIN on this device, ask clinic staff to help you reset it.
              </p>
            </details>
            <details className="group">
              <summary className="flex min-h-touch-target cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-body font-medium text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
                <span>Can I use the portal in an emergency?</span>
                <ChevronDownIcon
                  className="h-5 w-5 shrink-0 text-ink-muted group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <p className="px-4 pb-4 text-body text-ink-secondary">
                No. The portal is for non-urgent matters only. In a medical
                emergency, call emergency services or go to the nearest
                hospital straight away.
              </p>
            </details>
            <details className="group">
              <summary className="flex min-h-touch-target cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-body font-medium text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
                <span>Do I need internet access?</span>
                <ChevronDownIcon
                  className="h-5 w-5 shrink-0 text-ink-muted group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <p className="px-4 pb-4 text-body text-ink-secondary">
                For an online account, yes: you need an internet connection
                (Wi-Fi or mobile data) to log in and see your latest records. On
                a device the clinic has set up for offline use, your account and
                records are kept on that device only.
              </p>
            </details>
          </div>
        </section>

        <section
          aria-labelledby="portal-start"
          className="rounded-lg border border-line bg-surface px-6 py-8 text-center"
        >
          <h2 id="portal-start" className="text-h2 text-ink">
            Ready to start?
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-body text-ink-secondary">
            Creating an account is free.
          </p>
          <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
            <Link to="/patient/register" className="btn-primary">
              Create an account
            </Link>
            <Link to="/patient/login" className="btn-secondary">
              Log in
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto max-w-5xl space-y-2 px-4 py-6 text-center text-caption text-ink-muted sm:px-6">
          <p className="text-label text-ink-secondary">
            Med Bridge Health Reach · Dr. Isioma Okobah Foundation
          </p>
          <nav aria-label="Legal" className="flex flex-wrap items-center justify-center gap-x-2">
            <Link
              to="/privacy"
              className="inline-flex min-h-touch-target items-center px-2 text-primary-fg underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Privacy notice
            </Link>
            <span aria-hidden>·</span>
            <Link
              to="/terms"
              className="inline-flex min-h-touch-target items-center px-2 text-primary-fg underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Terms of use
            </Link>
          </nav>
          <p>
            Need help with the portal? Speak to the outreach team at your next
            visit, or contact the Dr. Isioma Okobah Foundation.
          </p>
        </div>
      </footer>
    </div>
  );
}
