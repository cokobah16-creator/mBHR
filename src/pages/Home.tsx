import { Link } from "react-router-dom";
import { ArrowRightIcon } from "@heroicons/react/20/solid";

const ENTRY_POINTS = [
  {
    to: "/login",
    title: "Staff",
    description:
      "Registration, patient queue, vitals, consultation and pharmacy. Works without internet.",
    action: "Sign in with your PIN",
  },
  {
    to: "/patient",
    title: "Patient portal",
    description:
      "Your visits, results, appointments, prescriptions and messages to the care team.",
    action: "Open the patient portal",
  },
];

export function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <main className="flex flex-1 items-center">
        <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:py-20">
          <div className="flex items-center gap-3">
            <img
              src="/brand/mbhr-mark.svg"
              alt=""
              aria-hidden
              className="h-12 w-12 rounded-lg"
            />
            <span className="text-label text-ink-muted">
              Dr. Isioma Okobah Foundation
            </span>
          </div>

          <h1 className="mt-6 text-display text-ink">Med Bridge Health Reach</h1>
          <p className="mt-2 max-w-xl text-lg text-ink-secondary">
            Clinical records and patient flow for medical outreach clinics in
            Nigeria.
          </p>

          <ul className="mt-10 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {ENTRY_POINTS.map((e) => (
              <li key={e.to}>
                <Link
                  to={e.to}
                  className="group flex items-center gap-4 px-5 py-5 transition-colors hover:bg-surface-sunken focus-visible:bg-surface-sunken"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-h2 text-ink">{e.title}</span>
                    <span className="mt-1 block text-body text-ink-secondary">
                      {e.description}
                    </span>
                    <span className="mt-2 block text-label text-primary">
                      {e.action}
                    </span>
                  </span>
                  <ArrowRightIcon
                    className="h-5 w-5 shrink-0 text-ink-muted group-hover:text-primary"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>

          <p className="mt-6 text-body text-ink-muted">
            Patients can create a portal account from the patient portal. Staff
            accounts are created by the outreach administrator.
          </p>
        </div>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-caption text-ink-muted">
          <span>Med Bridge Health Reach</span>
          <nav aria-label="Legal" className="flex gap-4">
            <Link to="/privacy" className="hover:text-ink hover:underline">
              Privacy notice
            </Link>
            <Link to="/terms" className="hover:text-ink hover:underline">
              Terms of use
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
