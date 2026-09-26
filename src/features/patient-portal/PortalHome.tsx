import type { ComponentType, ReactNode, SVGProps } from "react";
import { Link } from "react-router-dom";
import {
  CalendarDaysIcon,
  ClipboardDocumentListIcon,
  BeakerIcon,
  HeartIcon,
  ArchiveBoxIcon,
  ArrowPathIcon,
  VideoCameraIcon,
  ChatBubbleLeftRightIcon,
  MapPinIcon,
  ArrowDownTrayIcon,
  ShieldCheckIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { useT } from "@/hooks/useT";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatPortalDate } from "./portalStatus";
import { patientRequestStatusInfo } from "./requestStatus";
import type { HomeExtras } from "./home/homeData";

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
      className="flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-lg border border-line bg-surface p-3 text-center text-label text-ink transition-colors hover:border-line-strong hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <I className="h-6 w-6 text-primary" aria-hidden />
      {label}
    </Link>
  );
}

function Row({
  to,
  icon: I,
  label,
  hint,
  badge,
}: {
  to: string;
  icon: Icon;
  label: string;
  hint?: string;
  badge?: ReactNode;
}) {
  return (
    <Link
      to={to}
      className="flex min-h-[64px] items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
    >
      <I className="h-6 w-6 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium text-ink">{label}</span>
        {hint && <span className="block text-caption text-ink-muted">{hint}</span>}
      </span>
      {badge}
      <ChevronRightIcon className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
    </Link>
  );
}

/**
 * "What's new": results made available recently, unread messages and
 * requests still waiting on the care team. A block that did not load is
 * named as such, never shown as "nothing new".
 */
function WhatsNew({ updates, onRetry }: { updates: HomeExtras; onRetry?: () => void }) {
  const { t } = useT();
  const labs = updates.labs ?? [];
  const requests = updates.requests ?? [];
  const unread = updates.unreadMessages ?? 0;
  const incomplete =
    updates.labs === undefined ||
    updates.requests === undefined ||
    updates.unreadMessages === undefined;
  const empty = labs.length === 0 && requests.length === 0 && unread === 0;

  return (
    <section aria-labelledby="home-new">
      <h2 id="home-new" className="mb-2 text-h3 text-ink">
        {t("portal.home.new.title", "What's new")}
      </h2>
      {!empty && (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {unread > 0 && (
            <li>
              <Row
                to="/patient/messages"
                icon={ChatBubbleLeftRightIcon}
                label={t("portal.home.new.messages", {
                  defaultValue: "Unread messages: {{count}}",
                  count: unread,
                })}
                hint={t("portal.home.new.messagesHint", "From your care team")}
              />
            </li>
          )}
          {labs.map((lab) => (
            <li key={lab.resultId}>
              <Row
                to="/patient/lab-results"
                icon={BeakerIcon}
                label={t("portal.home.new.labResult", "Lab result available")}
                hint={[lab.testName, formatPortalDate(lab.availableAt)]
                  .filter(Boolean)
                  .join(" · ")}
              />
            </li>
          ))}
          {requests.map((req) => {
            const info = patientRequestStatusInfo(req.storedStatus);
            return (
              <li key={req.id}>
                <Row
                  to="/patient/appointments"
                  icon={req.kind === "televisit" ? VideoCameraIcon : CalendarDaysIcon}
                  label={
                    req.kind === "televisit"
                      ? t("portal.home.new.televisitRequest", "Video visit request")
                      : t("portal.home.new.appointmentRequest", "Appointment request")
                  }
                  hint={t("portal.home.new.sentOn", {
                    defaultValue: "Sent {{date}}",
                    date: formatPortalDate(req.sentAt),
                  })}
                  badge={<StatusBadge tone={info.tone}>{t(info.labelKey)}</StatusBadge>}
                />
              </li>
            );
          })}
        </ul>
      )}
      {empty && !incomplete && (
        <p className="text-body text-ink-secondary">
          {t("portal.home.new.none", "Nothing new right now.")}
        </p>
      )}
      {incomplete && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-caption text-ink-secondary">
          <ExclamationTriangleIcon className="h-4 w-4 shrink-0 text-warning" aria-hidden />
          <span>{t("portal.home.new.incomplete", "Some updates could not load.")}</span>
          {onRetry && (
            <button type="button" onClick={onRetry} className="btn-ghost text-label">
              <ArrowPathIcon className="h-4 w-4" aria-hidden />
              {t("portal.error.retry", "Try again")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Patient portal home: calm, large targets, plain language. The order
 * follows what a patient needs first: the next appointment, what is new,
 * their own records (passed as children), then shortcuts and requests.
 */
export function PortalHome({
  name,
  nextAppointment,
  unreadMessages,
  updates,
  onRetryUpdates,
  children,
}: {
  name: string;
  /** undefined while unknown (e.g. offline); null when there is none. */
  nextAppointment?: NextAppointment | null;
  unreadMessages?: number;
  /** "What's new" and the next outreach. Omitted where they cannot be loaded. */
  updates?: HomeExtras;
  onRetryUpdates?: () => void;
  /** Record summaries (visits, medicines, vitals) shown under "What's new". */
  children?: ReactNode;
}) {
  const { t } = useT();
  const unread = unreadMessages ?? updates?.unreadMessages;
  const outreach = updates?.outreach;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <h1 className="text-h1 text-ink">{t(greetingKey(), { name })}</h1>

      {nextAppointment !== undefined && (
        <section aria-labelledby="next-appt" className="rounded-lg border border-info-line bg-info-soft p-4">
          <h2 id="next-appt" className="flex items-center gap-2 text-label text-info-fg">
            <CalendarDaysIcon className="h-5 w-5" aria-hidden />
            {t("portal.home.nextAppointment")}
          </h2>
          {nextAppointment ? (
            <>
              <p className="mt-1 text-h2 text-ink tabular-nums">
                {nextAppointment.scheduledAt.toLocaleDateString("en-NG", {
                  weekday: "short",
                  day: "numeric",
                  month: "long",
                })}{" "}
                ·{" "}
                {nextAppointment.scheduledAt.toLocaleTimeString("en-NG", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
              <p className="mt-0.5 text-body text-ink-secondary">
                {nextAppointment.televisit
                  ? t("portal.home.videoVisit")
                  : nextAppointment.type || t("portal.home.inPerson", "In-person visit")}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
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
                <Link to="/patient/appointments" className="btn-secondary">
                  {t("portal.home.viewAppointment", "View appointment")}
                </Link>
              </div>
            </>
          ) : (
            <p className="mt-1 text-body text-ink-secondary">{t("portal.home.noAppointment")}</p>
          )}
        </section>
      )}

      {updates && <WhatsNew updates={updates} onRetry={onRetryUpdates} />}

      {children}

      <section aria-labelledby="your-health">
        <h2 id="your-health" className="mb-2 text-h3 text-ink">
          {t("portal.home.yourHealth")}
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile to="/patient/medical-history" icon={ClipboardDocumentListIcon} label={t("portal.home.visits")} />
          <Tile to="/patient/lab-results" icon={BeakerIcon} label={t("portal.nav.labResults")} />
          <Tile to="/patient/conditions" icon={HeartIcon} label={t("portal.home.conditions")} />
          <Tile to="/patient/prescriptions" icon={ArchiveBoxIcon} label={t("portal.home.medicines")} />
        </div>
      </section>

      <section aria-labelledby="request">
        <h2 id="request" className="mb-2 text-h3 text-ink">
          {t("portal.home.request")}
        </h2>
        <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          <Row
            to="/patient/appointments/request"
            icon={CalendarDaysIcon}
            label={t("portal.home.appointment")}
            hint={t("portal.home.appointmentHint", "Ask the clinic for an appointment")}
          />
          <Row
            to="/patient/prescriptions"
            icon={ArrowPathIcon}
            label={t("portal.home.refill")}
            hint={t("portal.home.refillHint", "How to get more of a medicine")}
          />
          <Row
            to="/patient/telehealth"
            icon={VideoCameraIcon}
            label={t("portal.home.televisit")}
            hint={t("portal.home.televisitHint", "Ask to talk to a health worker by video")}
          />
        </div>
      </section>

      <section className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        <Row
          to="/patient/messages"
          icon={ChatBubbleLeftRightIcon}
          label={t("portal.nav.messages")}
          hint={t("portal.home.messagesHint")}
          badge={
            unread ? (
              <span className="badge badge-info">
                {t("portal.home.unreadCount", { count: unread })}
              </span>
            ) : undefined
          }
        />
        <Row
          to="/patient/outreach"
          icon={MapPinIcon}
          label={t("portal.action.findOutreach")}
          hint={
            outreach
              ? t("portal.home.nextOutreach", {
                  defaultValue: "Next: {{name}}, {{date}}",
                  name: outreach.name || t("portal.home.outreachUnnamed", "Medical outreach"),
                  date: [formatPortalDate(outreach.date), outreach.place]
                    .filter(Boolean)
                    .join(", "),
                })
              : t("portal.home.outreachHint")
          }
        />
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

      <p className="flex items-start gap-2 text-caption text-ink-muted">
        <ExclamationTriangleIcon className="h-4 w-4 shrink-0" aria-hidden />
        {t("portal.home.notEmergency")}
      </p>
    </div>
  );
}
