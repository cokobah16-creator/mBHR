import type { ReactNode } from "react";
import { Link } from "react-router-dom";

interface LegalPageProps {
  title: string;
  updated: string;
  children: ReactNode;
}

/** Shared frame for the public privacy and terms pages. */
export function LegalPage({ title, updated, children }: LegalPageProps) {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 rounded-md">
            <img src="/brand/mbhr-mark.svg" alt="" aria-hidden className="h-8 w-8 rounded-md" />
            <span className="text-h3 text-ink">Med Bridge Health Reach</span>
          </Link>
          <nav aria-label="Legal" className="flex gap-4 text-label">
            <Link to="/privacy" className="text-ink-secondary hover:text-ink hover:underline">
              Privacy
            </Link>
            <Link to="/terms" className="text-ink-secondary hover:text-ink hover:underline">
              Terms
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-h1 text-ink">{title}</h1>
        <p className="mt-1 text-caption text-ink-muted">Last updated {updated}</p>
        <div className="mt-6 space-y-6 text-body text-ink-secondary">
          {children}
        </div>
      </main>
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-h2 text-ink">{title}</h2>
      {children}
    </section>
  );
}
