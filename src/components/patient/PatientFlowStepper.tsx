import { CheckIcon } from "@heroicons/react/20/solid";
import type { FlowStep, FlowStepState } from "@/services/patientFlow";

const STATE_TEXT: Record<FlowStepState, string> = {
  done: "Completed",
  current: "In progress",
  waiting: "Waiting",
  upcoming: "Not started",
};

function formatClock(d?: Date) {
  if (!d) return undefined;
  return d.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });
}

function Marker({ state }: { state: FlowStepState }) {
  if (state === "done") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-success text-white">
        <CheckIcon className="h-4 w-4" aria-hidden />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-primary bg-surface">
        <span className="h-2.5 w-2.5 rounded-full bg-primary" />
      </span>
    );
  }
  if (state === "waiting") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-warning bg-surface">
        <span className="h-2 w-2 rounded-full bg-warning" />
      </span>
    );
  }
  return (
    <span className="h-6 w-6 rounded-full border-2 border-line-strong bg-surface" />
  );
}

interface PatientFlowStepperProps {
  steps: FlowStep[];
  /** Tighter layout for table rows and side panels. */
  compact?: boolean;
  className?: string;
}

/**
 * Registration → Vitals → Consultation → Pharmacy for one visit.
 * State is conveyed by marker shape and text as well as colour.
 */
export function PatientFlowStepper({
  steps,
  compact = false,
  className = "",
}: PatientFlowStepperProps) {
  if (compact) {
    return (
      <ol
        className={`flex items-center gap-1 ${className}`}
        aria-label="Patient flow"
      >
        {steps.map((s) => (
          <li
            key={s.stage}
            title={`${s.label}: ${STATE_TEXT[s.state]}`}
            aria-current={s.state === "current" ? "step" : undefined}
            className={`h-1.5 w-6 rounded-full ${
              s.state === "done"
                ? "bg-success"
                : s.state === "current"
                  ? "bg-primary"
                  : s.state === "waiting"
                    ? "bg-warning"
                    : "bg-line-strong"
            }`}
          >
            <span className="sr-only">
              {s.label}: {STATE_TEXT[s.state]}
            </span>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <ol
      className={`grid grid-cols-2 gap-y-3 sm:grid-cols-4 ${className}`}
      aria-label="Patient flow"
    >
      {steps.map((s, i) => {
        const time = formatClock(s.at);
        return (
          <li
            key={s.stage}
            className="relative flex items-start gap-2.5 pr-3"
            aria-current={
              s.state === "current" || s.state === "waiting"
                ? "step"
                : undefined
            }
          >
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={`hidden sm:block absolute left-8 right-1 top-3 h-px ${
                  s.state === "done" ? "bg-success" : "bg-line-strong"
                }`}
              />
            )}
            <span className="relative z-10 shrink-0">
              <Marker state={s.state} />
            </span>
            <span className="relative z-10 min-w-0 bg-surface pr-2">
              <span
                className={`block text-caption font-semibold uppercase tracking-wide ${
                  s.state === "upcoming" ? "text-ink-muted" : "text-ink"
                }`}
              >
                {s.label}
              </span>
              <span className="block text-caption text-ink-muted">
                {STATE_TEXT[s.state]}
                {time ? ` · ${time}` : ""}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
