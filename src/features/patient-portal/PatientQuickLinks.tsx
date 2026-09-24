import { Link } from "react-router-dom";
import {
  CalendarDaysIcon,
  CreditCardIcon,
  DocumentCheckIcon,
  ArchiveBoxIcon,
  VideoCameraIcon,
  HomeIcon,
  ClipboardDocumentListIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";

const LINKS = [
  {
    name: "Appointments",
    description: "See your appointments or ask for a new one",
    icon: CalendarDaysIcon,
    href: "/patient/appointments",
  },
  {
    name: "Bills and payments",
    description: "See your bills and payments",
    icon: CreditCardIcon,
    href: "/patient/billing",
  },
  {
    name: "Forms before your visit",
    description: "Fill in forms before you come to the clinic",
    icon: DocumentCheckIcon,
    href: "/patient/forms",
  },
  {
    name: "Medicines",
    description: "Medicines given to you, and how to ask for more",
    icon: ArchiveBoxIcon,
    href: "/patient/prescriptions",
  },
  {
    name: "Home",
    description: "A summary of your health record",
    icon: HomeIcon,
    href: "/patient/dashboard",
  },
  {
    name: "Video visits",
    description: "Talk to a health worker by video",
    icon: VideoCameraIcon,
    href: "/patient/telehealth",
  },
  {
    name: "Your visits",
    description: "Past visits, measurements and notes",
    icon: ClipboardDocumentListIcon,
    href: "/patient/medical-history",
  },
];

export function PatientQuickLinks() {
  return (
    <section className="panel" aria-labelledby="quick-links-title">
      <div className="panel-header">
        <div>
          <h2 id="quick-links-title" className="panel-title">
            Quick links
          </h2>
          <p className="text-caption text-ink-muted">
            Go straight to a part of your portal
          </p>
        </div>
      </div>

      <ul className="grid grid-cols-1 gap-2 p-4 md:grid-cols-2 lg:grid-cols-3">
        {LINKS.map((link) => {
          const Icon = link.icon;
          return (
            <li key={link.href}>
              <Link
                to={link.href}
                className="flex min-h-[64px] items-start gap-3 rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Icon
                  className="mt-0.5 h-5 w-5 shrink-0 text-primary"
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-medium text-ink">
                    {link.name}
                  </span>
                  <span className="block text-caption text-ink-muted">
                    {link.description}
                  </span>
                </span>
                <ChevronRightIcon
                  className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted"
                  aria-hidden
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
