import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ExclamationTriangleIcon,
  UserIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { PatientSearch } from "@/components/PatientSearch";
import type { Patient } from "@/db";
import { TELEVISIT_DEFAULT_DURATION_MIN } from "@/services/televisits";
import {
  describeActionError,
  toDateInputValue,
} from "@/features/appointments/appointmentModel";
import { useDialogFocus } from "@/features/appointments/useDialogFocus";

const DURATION_OPTIONS = [15, 20, 30, 45, 60];

export interface ScheduleTarget {
  requestId?: string;
  patientId?: string;
  patientName?: string;
  date: string;
  time: string;
  reason: string;
}

export interface ScheduleFormValues {
  requestId?: string;
  patientId: string;
  patientName: string;
  scheduledAt: Date;
  durationMinutes: number;
  reason: string;
  notes: string;
}

interface ScheduleTelevisitDialogProps {
  initial: ScheduleTarget;
  /** Why booking is not possible right now (offline, role); null when it is. */
  blockedReason: string | null;
  onClose: () => void;
  /** Books the televisit; throws with a readable message on failure. */
  onSubmit: (values: ScheduleFormValues) => Promise<void>;
}

export function ScheduleTelevisitDialog({
  initial,
  blockedReason,
  onClose,
  onSubmit,
}: ScheduleTelevisitDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const fixedPatient = Boolean(initial.requestId && initial.patientId);
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(
    initial.patientId
      ? {
          id: initial.patientId,
          name: initial.patientName ?? initial.patientId,
        }
      : null,
  );
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [duration, setDuration] = useState(TELEVISIT_DEFAULT_DURATION_MIN);
  const [reason, setReason] = useState(initial.reason);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const today = toDateInputValue(new Date());

  useDialogFocus(dialogRef, () => {
    if (!submitting) onClose();
  });

  // The submit button is disabled while saving; keep focus in the dialog so
  // Tab, Escape and the error announcement still work.
  useEffect(() => {
    if (submitting) dialogRef.current?.focus();
  }, [submitting]);

  const handlePatientSelect = (selected: Patient) => {
    setPatient({
      id: selected.id,
      name: `${selected.givenName} ${selected.familyName}`.trim(),
    });
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (blockedReason) {
      setError(blockedReason);
      return;
    }
    if (!patient) {
      setError("Search for the patient and choose them from the list.");
      return;
    }
    if (!date || !time) {
      setError("Choose a date and a time.");
      return;
    }
    const scheduledAt = new Date(`${date}T${time}`);
    if (isNaN(scheduledAt.getTime())) {
      setError("The date or time is not valid.");
      return;
    }
    if (scheduledAt.getTime() <= Date.now()) {
      setError("Choose a time in the future.");
      return;
    }
    if (!reason.trim()) {
      setError("Enter a reason for the visit.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        requestId: initial.requestId,
        patientId: patient.id,
        patientName: patient.name,
        scheduledAt,
        durationMinutes: duration,
        reason: reason.trim(),
        notes: notes.trim(),
      });
    } catch (err) {
      setError(
        describeActionError(
          err,
          "The televisit was not booked. Check the connection, then try again.",
        ),
      );
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby="schedule-televisit-title"
        className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-2xl"
      >
        <div className="panel-header">
          <h2 id="schedule-televisit-title" className="text-h2 text-ink">
            Book a televisit
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="btn-ghost px-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <XMarkIcon className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {/* The patient picker sits outside the <form>: its result buttons and
            Enter key must not submit the booking. */}
        <div
          className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4"
          data-autofocus
        >
          {error && (
            <div className="banner banner-danger" role="alert">
              <ExclamationTriangleIcon
                className="h-5 w-5 shrink-0"
                aria-hidden
              />
              <span>{error}</span>
            </div>
          )}
          {blockedReason && !error && (
            <div className="banner banner-warning" role="status">
              <ExclamationTriangleIcon
                className="h-5 w-5 shrink-0"
                aria-hidden
              />
              <span>{blockedReason}</span>
            </div>
          )}

          <div>
            {fixedPatient && patient ? (
              <>
                <p className="field-label">Patient</p>
                <p className="flex items-center gap-2 rounded-md border border-line bg-surface-sunken px-3 py-2.5 text-body text-ink">
                  <UserIcon className="h-4 w-4 text-ink-muted" aria-hidden />
                  {patient.name}
                </p>
              </>
            ) : (
              <>
                <div>
                  <span id="televisit-patient-label" className="field-label">
                    Patient
                  </span>
                  <PatientSearch
                    onPatientSelect={handlePatientSelect}
                    placeholder="Search by name or phone"
                    labelledBy="televisit-patient-label"
                  />
                </div>
                <p className="field-hint">
                  {patient
                    ? `Selected: ${patient.name}`
                    : "Searches patients registered on this device."}
                </p>
              </>
            )}
          </div>

          <form
            id="schedule-televisit-form"
            onSubmit={handleSubmit}
            className="space-y-4"
            noValidate
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="televisit-date" className="field-label">
                  Date
                </label>
                <input
                  id="televisit-date"
                  type="date"
                  min={today}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="input-field"
                  required
                />
              </div>
              <div>
                <label htmlFor="televisit-time" className="field-label">
                  Time
                </label>
                <input
                  id="televisit-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="input-field"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="televisit-duration" className="field-label">
                Length
              </label>
              <select
                id="televisit-duration"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="input-field"
              >
                {DURATION_OPTIONS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} minutes
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="televisit-reason" className="field-label">
                Reason
              </label>
              <input
                id="televisit-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="input-field"
                placeholder="e.g. Follow-up on blood pressure"
                required
              />
            </div>

            <div>
              <label htmlFor="televisit-notes" className="field-label">
                Notes (optional)
              </label>
              <textarea
                id="televisit-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="input-field"
                rows={3}
              />
            </div>

            <p className="field-hint">
              A video link is created and sent to the patient by SMS. After
              booking you will see whether the SMS went out.
            </p>
          </form>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-line px-4 py-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="schedule-televisit-form"
            disabled={submitting || Boolean(blockedReason)}
            className="btn-primary"
          >
            {submitting ? "Booking…" : "Book and send link"}
          </button>
        </div>
      </div>
    </div>
  );
}
