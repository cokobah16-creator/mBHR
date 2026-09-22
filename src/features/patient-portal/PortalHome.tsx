import type { ComponentType, SVGProps } from "react";
import { Link } from "react-router-dom";
import {
  CalendarDaysIcon,
  ClipboardDocumentListIcon,
  BeakerIcon,
  HeartIcon,
  ArrowPathIcon,
  VideoCameraIcon,
  ChatBubbleLeftRightIcon,
  MapPinIcon,
  ArrowDownTrayIcon,
  ShieldCheckIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";
import { useT } from "@/hooks/useT";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

export interface NextAppointment {
  scheduledAt: Date;
  type?: string;
  televisit?: boolean;
  meetingLink?: string;
}

function greetingKey(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return "portal.home.greeting.morning";
  if (h < 17) return "portal.home.greeting.afternoon";
  return "portal.home.greeting.evening";
}

function Tile({ to, icon: I, label }: { to: string; icon: Icon; label: string }) {
  return (
    <Link
      to={to}
      className="flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-lg border border-line bg-surface p-3 text-center text-label text-ink transition-colors hover:border-info-line hover:bg-info-soft"
    >
      <I className="h-6 w-6 text-info" aria-hidden />
      {label}
    </Link>
  );
}

function Row({ to, icon: I, label, hint, badge }: { to: string; icon: Icon; label: string; hint?: string; badge?: string }) {
  return (
    <Link
      to={to}
      className="flex min-h-[64px] items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-sunken"
    >
      <I className="h-6 w-6 shrink-0 text-info" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium text-ink">{label}</span>
        {hint && <span className="block text-caption text-ink-muted">{hint}</span>}
      </span>
      {badge && <span className="badge badge-danger">{badge}</span>}
      <ChevronRightIcon className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
    </Link>
  );
}

/**
 * Patient portal home: calm, large targets, plain language. Shows the next
 * appointment first, then the patient's own records, then requests.
 */
export function PortalHome({
  name,
  nextAppointment,
  unreadMessages,
}: {
  name: string;
  /** undefined while unknown (e.g. offline); null when there is none. */
  nextAppointment?: NextAppointment | null;
  unreadMessages?: number;
}) {
  const { t } = useT();
  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <h1 className="text-h1 text-ink">{t(greetingKey(), { name })}</h1>

      {nextAppointment !== undefined && (
        <section aria-labelledby="next-appt" className="rounded-lg border border-info-line bg-info-soft p-4">
          <h2 id="next-appt" className="flex items-center gap-2 text-label text-info-fg">
            <CalendarDaysIcon className="h-5 w-5" aria-hidden />
            {t("portal.home.nextAppointment")}
          </h2>
          {nextAppointment ? (
            <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
              <p className="text-h2 text-ink tabular-nums">
                {nextAppointment.scheduledAt.toLocaleDateString(undefined, {
                  weekday: "short",
                  day: "numeric",
                  month: "long",
                })}{" "}
                ·{" "}
                {nextAppointment.scheduledAt.toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {nextAppointment.televisit && (
                  <span className="ml-2 text-body font-normal text-ink-secondary">
                    {t("portal.home.videoVisit")}
                  </span>
                )}
              </p>
              {nextAppointment.televisit && nextAppointment.meetingLink && (
                <a
                  href={nextAppointment.meetingLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary"
                >
                  <VideoCameraIcon className="h-5 w-5" aria-hidden />
                  {t("portal.home.joinVideo")}
                </a>
              )}
            </div>
          ) : (
            <p className="mt-1 text-body text-ink-secondary">{t("portal.home.noAppointment")}</p>
          )}
        </section>
      )}

      <section aria-labelledby="your-health">
        <h2 id="your-health" className="mb-2 text-h3 text-ink">
          {t("portal.home.yourHealth")}
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile to="/patient/medical-history" icon={ClipboardDocumentListIcon} label={t("portal.home.visits")} />
          <Tile to="/patient/lab-results" icon={BeakerIcon} label={t("portal.nav.labResults")} />
          <Tile to="/patient/conditions" icon={HeartIcon} label={t("portal.home.conditions")} />
          <Tile to="/patient/prescriptions" icon={ArrowPathIcon} label={t("portal.home.medicines")} />
        </div>
      </section>

      <section aria-labelledby="request">
        <h2 id="request" className="mb-2 text-h3 text-ink">
          {t("portal.home.request")}
        </h2>
        <div className="grid grid-cols-3 gap-2">
          <Tile to="/patient/appointments/request" icon={CalendarDaysIcon} label={t("portal.home.appointment")} />
          <Tile to="/patient/prescriptions" icon={ArrowPathIcon} label={t("portal.home.refill")} />
          <Tile to="/patient/telehealth" icon={VideoCameraIcon} label={t("portal.home.televisit")} />
        </div>
      </section>

      <section className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        <Row
          to="/patient/messages"
          icon={ChatBubbleLeftRightIcon}
          label={t("portal.nav.messages")}
          hint={t("portal.home.messagesHint")}
          badge={unreadMessages ? String(unreadMessages) : undefined}
        />
        <Row to="/patient/outreach" icon={MapPinIcon} label={t("portal.action.findOutreach")} hint={t("portal.home.outreachHint")} />
      </section>

      <section aria-labelledby="your-data">
        <h2 id="your-data" className="mb-2 text-h3 text-ink">
          {t("portal.home.yourData")}
        </h2>
        <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          <Row to="/patient/export" icon={ArrowDownTrayIcon} label={t("portal.action.downloadRecords")} />
          <Row to="/patient/data-sharing" icon={ShieldCheckIcon} label={t("portal.action.dataSharing")} />
        </div>
      </section>

      <p className="text-caption text-ink-muted">{t("portal.home.notEmergency")}</p>
    </div>
  );
}
