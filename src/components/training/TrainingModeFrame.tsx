import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AcademicCapIcon,
  ArrowUturnLeftIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { PageHeader, type Crumb } from "@/components/ui/PageHeader";

interface TrainingModeFrameProps {
  /** Page title (the page's only h1). */
  title: string;
  description?: ReactNode;
  /**
   * Set when this page changes real, non-practice data. Say exactly what
   * changes, e.g. "Recording a restock adds to the real supply counts."
   * The ribbon then switches from "practice only" to a live-data warning.
   */
  liveChanges?: ReactNode;
  /** A short extra line in the ribbon, e.g. "The patients in these cases are made up." */
  note?: ReactNode;
  actions?: ReactNode;
  /**
   * Breadcrumbs above the title. Defaults to Training → this page; pass
   * null to hide them (the training hub itself).
   */
  breadcrumbs?: Crumb[] | null;
  children: ReactNode;
}

/**
 * Wraps every training-mode page (games, quests, prizes, leaderboard) so it
 * can never be mistaken for clinical work: a gold rule and ribbon that say
 * what the page does and does not change, plus a way back to the clinic.
 */
export function TrainingModeFrame({
  title,
  description,
  liveChanges,
  note,
  actions,
  breadcrumbs,
  children,
}: TrainingModeFrameProps) {
  const crumbs =
    breadcrumbs === null
      ? undefined
      : (breadcrumbs ?? [{ label: "Training", to: "/games" }, { label: title }]);
  const live = liveChanges !== undefined && liveChanges !== null && liveChanges !== "";

  return (
    <div data-mode="training" className="border-t-4 border-accent pt-4">
      <section
        aria-label={live ? "Training mode: uses live clinic data" : "Training mode: practice only"}
        className={`mb-5 rounded-lg border-2 px-4 py-3 ${
          live
            ? "border-warning-line border-l-8 border-l-accent bg-warning-soft text-warning-fg"
            : "border-accent bg-accent/15 text-ink"
        }`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-ink"
              aria-hidden
            >
              {live ? (
                <ExclamationTriangleIcon className="h-5 w-5" />
              ) : (
                <AcademicCapIcon className="h-5 w-5" />
              )}
            </span>
            <div className="min-w-0">
              {live ? (
                <>
                  <p className="text-body font-semibold">
                    Training mode: this activity changes real records.
                  </p>
                  <p className="text-body">{liveChanges}</p>
                </>
              ) : (
                <p className="text-body">
                  <span className="font-semibold">Training mode:</span> practice
                  only. Nothing here changes patient records.
                </p>
              )}
              {note && <p className="mt-0.5 text-caption">{note}</p>}
            </div>
          </div>
          <Link to="/dashboard" className="btn-secondary shrink-0 self-start sm:self-center">
            <ArrowUturnLeftIcon className="h-4 w-4" aria-hidden />
            Back to clinic
          </Link>
        </div>
      </section>

      <PageHeader
        title={title}
        description={description}
        actions={actions}
        breadcrumbs={crumbs}
      />

      {children}
    </div>
  );
}
