import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  CheckCircleIcon,
  ChevronDownIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  LockClosedIcon,
} from "@heroicons/react/24/outline";
import { formatNigerianDateTime } from "@/utils/dateFormat";
import {
  describeValidation,
  EXPORT_SECTIONS,
  summariseCounts,
  totalCount,
  type ExportOutcome,
  type ExportSectionKey,
} from "./exportSummary";

/** The file holds private health information: say so before it is made. */
export function ExportPrivacyNotice() {
  return (
    <div className="banner banner-warning" role="note">
      <LockClosedIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="space-y-1">
        <p className="font-medium">This file contains your private health information.</p>
        <p>
          Anyone who opens it can read your name, date of birth and the health
          details you choose below. Save it where only you can open it, and
          only send it to people you want to see your records, such as another
          doctor. See our{" "}
          <Link to="/privacy" className="font-medium underline underline-offset-2">
            Privacy notice
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

interface ExportContentOptionsProps {
  values: Partial<Record<ExportSectionKey, boolean>>;
  onToggle: (key: ExportSectionKey, checked: boolean) => void;
  /** Counts saved on this device, by FHIR type, from the export preview. */
  counts?: Record<string, number>;
  disabled?: boolean;
  idPrefix: string;
}

/** "What to include" checkboxes, in plain words, with device counts. */
export function ExportContentOptions({
  values,
  onToggle,
  counts,
  disabled,
  idPrefix,
}: ExportContentOptionsProps) {
  return (
    <fieldset>
      <legend className="field-label">What to include</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {EXPORT_SECTIONS.map((s) => {
          const id = `${idPrefix}-${s.key}`;
          const count = counts?.[s.resourceType];
          return (
            <label
              key={s.key}
              htmlFor={id}
              className="flex min-h-touch-target cursor-pointer items-start gap-3 rounded-md border border-line bg-surface p-3 transition-colors hover:bg-surface-hover"
            >
              <input
                id={id}
                type="checkbox"
                checked={!!values[s.key]}
                onChange={(e) => onToggle(s.key, e.target.checked)}
                disabled={disabled}
                className="mt-0.5 h-5 w-5 shrink-0 rounded border-line-strong text-primary focus:ring-primary"
              />
              <span className="min-w-0">
                <span className="block text-body font-medium text-ink">{s.title}</span>
                <span className="block text-caption text-ink-muted">{s.description}</span>
                {typeof count === "number" && (
                  <span className="mt-0.5 block text-caption text-ink-secondary tabular-nums">
                    {s.estimated ? "About " : ""}
                    {count} saved on this device
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Honest result: which file, where its records came from, and what is in it. */
export function ExportResultPanel({
  outcome,
  usCoreVersion,
}: {
  outcome: ExportOutcome;
  usCoreVersion: string;
}) {
  const rows = summariseCounts(outcome.counts, { dropZero: true });
  const total = totalCount(outcome.counts);
  const validation = outcome.validation
    ? describeValidation(outcome.validation)
    : null;

  return (
    <div className="space-y-3">
      <div className="banner banner-success">
        <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <div className="space-y-1">
          <p className="font-medium">Your file is ready: {outcome.fileName}</p>
          <p>
            Your browser should save it to your Downloads folder. If nothing
            appeared, check your browser&apos;s downloads list.
          </p>
          <p>
            {outcome.source === "online"
              ? "It was made from your online record."
              : "It was made from records saved on this device."}
          </p>
        </div>
      </div>

      {outcome.fellBack && (
        <div className="banner banner-warning">
          <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>
            The online service could not be reached, so this file was made from
            records saved on this device. It may not include your most recent
            visits.
          </p>
        </div>
      )}

      {outcome.since && (
        <div className="banner banner-info">
          <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>
            This file only includes records that changed since your last file
            on {formatNigerianDateTime(outcome.since)}, and it may leave some
            records out. Keep your earlier file as well.
          </p>
        </div>
      )}

      {outcome.counts && total === 0 ? (
        <div className="banner banner-warning">
          <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>The file has no health records in it.</p>
        </div>
      ) : rows.length > 0 ? (
        <div className="rounded-md border border-line p-3">
          <p className="section-label">In this file</p>
          <ul className="mt-2 grid gap-1 text-body text-ink sm:grid-cols-2">
            {rows.map((r) => (
              <li key={r.type} className="flex justify-between gap-3">
                <span>{r.label}</span>
                <span className="tabular-nums text-ink-secondary">{r.count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {validation && (
        <div
          className={`banner ${validation.tone === "success" ? "banner-success" : "banner-warning"}`}
        >
          {validation.tone === "success" ? (
            <CheckCircleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          ) : (
            <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          )}
          <div className="space-y-1">
            <p className="font-medium">
              Format check (US Core {usCoreVersion}): {validation.headline}
            </p>
            {validation.detail && <p>{validation.detail}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Background on the file format, kept out of the way of the main task. */
export function ExportAboutDetails({ children }: { children?: ReactNode }) {
  return (
    <details className="panel group">
      <summary className="flex min-h-touch-target cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-h3 text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
        <span>About this file format</span>
        <ChevronDownIcon
          className="h-5 w-5 shrink-0 text-ink-muted group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="space-y-3 border-t border-line px-4 py-4 text-body text-ink-secondary">
        <p>
          The file uses FHIR, an international standard for health records.
          Hospitals, clinics and health apps that support FHIR can read it. You
          can use it to:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>give your records to another doctor or hospital</li>
          <li>add your records to a health app you trust</li>
          <li>support an insurance or benefits application</li>
          <li>keep your own copy of your records</li>
        </ul>
        <p>
          The file is plain text. It is not locked with a password, so keep it
          somewhere private.
        </p>
        {children}
      </div>
    </details>
  );
}
