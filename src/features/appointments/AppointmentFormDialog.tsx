import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ExclamationTriangleIcon,
  UserIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { PatientSearch } from "@/components/PatientSearch";
import type { Patient } from "@/db";
import {
  listAppointmentProviders,
  type Appointment,
  type AppointmentProvider,
} from "@/services/appointments";
import { TELEVISIT_APPOINTMENT_TYPE } from "@/services/televisits";
import {
  APPOINTMENT_DURATIONS,
  describeActionError,
  toDateTimeInputValue,
  type AppointmentFormValues,
} from "./appointmentModel";
import { useDialogFocus } from "./useDialogFocus";

const APPOINTMENT_TYPES = [
  TELEVISIT_APPOINTMENT_TYPE,
  "Initial Consultation",
  "Follow-up",
  "Vaccination",
  "Health Screening",
  "Lab Results Review",
  "Wound Care",
  "Chronic Disease Management",
  "Prenatal Care",
  "Postnatal Care",
  "Child Wellness Visit",
];

const OTHER_PROVIDER = "__other__";

interface AppointmentFormDialogProps {
  mode: "create" | "edit";
  /** The appointment being edited (edit mode). */
  appointment?: Appointment;
  /** Patient fixed by the caller (edit mode, or a patient-scoped calendar). */
  fixedPatient?: { id: string; name: string };
  /** The signed-in staff member's directory id, when known. */
  myProviderId?: string | null;
  myName?: string;
  /** Provider to preselect when booking. */
  defaultProviderId?: string;
  online: boolean;
  onClose: () => void;
  /** Saves the appointment; throws with a readable message on failure. */
  onSubmit: (values: AppointmentFormValues) => Promise<void>;
}

type FieldErrors = Partial<
  Record<"patient" | "provider" | "type" | "when" | "duration", string>
>;

export function AppointmentFormDialog({
  mode,
  appointment,
  fixedPatient,
  myProviderId,
  myName,
  defaultProviderId,
  online,
  onClose,
  onSubmit,
}: AppointmentFormDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(
    fixedPatient ?? null,
  );
  const [manualPatient, setManualPatient] = useState(false);
  const [manualPatientId, setManualPatientId] = useState("");
  const initialProvider =
    appointment?.providerId || defaultProviderId || myProviderId || "";
  const [providerChoice, setProviderChoice] = useState(initialProvider);
  const [otherProviderId, setOtherProviderId] = useState("");
  const [providers, setProviders] = useState<AppointmentProvider[]>([]);
  const [providersState, setProvidersState] = useState<
    "loading" | "ready" | "failed"
  >(online ? "loading" : "failed");
  const [appointmentType, setAppointmentType] = useState(
    appointment?.appointmentType ?? "",
  );
  const [when, setWhen] = useState(
    appointment ? toDateTimeInputValue(appointment.scheduledAt) : "",
  );
  const [duration, setDuration] = useState(appointment?.durationMinutes ?? 30);
  const [reason, setReason] = useState(appointment?.reason ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useDialogFocus(dialogRef, () => {
    if (!saving) onClose();
  });

  // The submit button is disabled while saving; keep focus in the dialog so
  // Tab, Escape and the error announcement still work.
  useEffect(() => {
    if (saving) dialogRef.current?.focus();
  }, [saving]);

  useEffect(() => {
    if (!online) return;
    let active = true;
    listAppointmentProviders()
      .then((list) => {
        if (!active) return;
        setProviders(list);
        setProvidersState("ready");
      })
      .catch(() => {
        if (active) setProvidersState("failed");
      });
    return () => {
      active = false;
    };
  }, [online]);

  const typeOptions =
    appointmentType && !APPOINTMENT_TYPES.includes(appointmentType)
      ? [appointmentType, ...APPOINTMENT_TYPES]
      : APPOINTMENT_TYPES;
  const durationOptions = APPOINTMENT_DURATIONS.some(
    (d) => d.minutes === duration,
  )
    ? APPOINTMENT_DURATIONS
    : [
        { minutes: duration, label: `${duration} minutes` },
        ...APPOINTMENT_DURATIONS,
      ];

  // Mirrors the calendar's televisit test for an existing appointment.
  const wasTelevisit =
    mode === "edit" &&
    !!appointment &&
    (appointment.appointmentType === TELEVISIT_APPOINTMENT_TYPE ||
      appointment.visitMode === "televisit" ||
      Boolean(appointment.meetingLink));

  const listedIds = new Set(providers.map((p) => p.id));
  const showMe = Boolean(myProviderId) && !listedIds.has(myProviderId ?? "");
  const showCurrent =
    Boolean(initialProvider) &&
    initialProvider !== myProviderId &&
    !listedIds.has(initialProvider);

  const providerNameFor = (id: string): string | undefined => {
    if (id && id === myProviderId) return myName;
    return providers.find((p) => p.id === id)?.fullName;
  };

  const typeHint = (): string => {
    if (appointmentType === TELEVISIT_APPOINTMENT_TYPE) {
      if (mode === "create") {
        return "A video link is created and sent to the patient by SMS. You will see whether the SMS went out.";
      }
      return "Televisits keep their video link.";
    }
    if (
      wasTelevisit &&
      appointmentType &&
      appointmentType !== appointment?.appointmentType
    ) {
      return "Saving removes the video link, so the patient is seen in person. The patient is not told automatically.";
    }
    return "";
  };

  const handlePatientSelect = (selected: Patient) => {
    setPatient({
      id: selected.id,
      name: `${selected.givenName} ${selected.familyName}`.trim(),
    });
    setErrors((e) => ({ ...e, patient: undefined }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const next: FieldErrors = {};

    const patientId = fixedPatient
      ? fixedPatient.id
      : manualPatient
        ? manualPatientId.trim()
        : (patient?.id ?? "");
    if (!patientId) {
      next.patient = manualPatient
        ? "Enter the patient ID."
        : "Search for the patient and choose them from the list.";
    }

    const providerId =
      providerChoice === OTHER_PROVIDER
        ? otherProviderId.trim()
        : providerChoice;
    if (!providerId) {
      next.provider =
        providerChoice === OTHER_PROVIDER
          ? "Enter the provider's staff ID."
          : "Choose who will see the patient.";
    }

    if (!appointmentType) next.type = "Choose the type of appointment.";

    const scheduledAt = when ? new Date(when) : null;
    if (!scheduledAt || isNaN(scheduledAt.getTime())) {
      next.when = "Choose a date and time.";
    }

    if (!(duration >= 15 && duration <= 240)) {
      next.duration = "Choose a length between 15 minutes and 4 hours.";
    }

    setErrors(next);
    if (Object.keys(next).length > 0) {
      setFormError("Check the highlighted fields.");
      return;
    }
    if (!online) {
      setFormError(
        "This device is offline. Appointments are saved online, so connect to the internet and try again.",
      );
      return;
    }

    setFormError(null);
    setSaving(true);
    try {
      await onSubmit({
        patientId,
        patientName:
          fixedPatient?.name ?? (manualPatient ? "" : (patient?.name ?? "")),
        providerId,
        providerName: providerNameFor(providerId),
        appointmentType,
        scheduledAt: scheduledAt as Date,
        durationMinutes: duration,
        reason: reason.trim(),
      });
    } catch (err) {
      setFormError(
        describeActionError(
          err,
          mode === "edit"
            ? "The changes were not saved. Check the details and the connection, then try again."
            : "The appointment was not booked. Check the details and the connection, then try again.",
        ),
      );
      setSaving(false);
    }
  };

  const title =
    mode === "edit"
      ? `Edit appointment${fixedPatient?.name ? ` for ${fixedPatient.name}` : ""}`
      : "Book appointment";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby="appointment-form-title"
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-2xl"
      >
        <div className="panel-header">
          <h2 id="appointment-form-title" className="text-h2 text-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
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
          {formError && (
            <div className="banner banner-danger" role="alert">
              <ExclamationTriangleIcon
                className="h-5 w-5 shrink-0"
                aria-hidden
              />
              <span>{formError}</span>
            </div>
          )}
          {!online && !formError && (
            <div className="banner banner-warning" role="status">
              <ExclamationTriangleIcon
                className="h-5 w-5 shrink-0"
                aria-hidden
              />
              <span>
                This device is offline. You can fill in the form, but it can
                only be saved once the connection returns.
              </span>
            </div>
          )}

          <div>
            {fixedPatient ? (
              <>
                <p className="field-label">Patient</p>
                <p className="flex items-center gap-2 rounded-md border border-line bg-surface-sunken px-3 py-2.5 text-body text-ink">
                  <UserIcon className="h-4 w-4 text-ink-muted" aria-hidden />
                  {fixedPatient.name}
                </p>
              </>
            ) : manualPatient ? (
              <>
                <label htmlFor="appointment-patient-id" className="field-label">
                  Patient ID
                </label>
                <input
                  id="appointment-patient-id"
                  type="text"
                  value={manualPatientId}
                  onChange={(e) => setManualPatientId(e.target.value)}
                  className="input-field"
                  autoComplete="off"
                  aria-invalid={errors.patient ? true : undefined}
                  aria-describedby="appointment-patient-msg"
                />
                <p
                  id="appointment-patient-msg"
                  className={errors.patient ? "field-error" : "field-hint"}
                >
                  {errors.patient ??
                    "The ID from the patient's record. The patient must already be in the online records."}
                </p>
                <button
                  type="button"
                  className="btn-ghost mt-1 px-2 text-label"
                  onClick={() => setManualPatient(false)}
                >
                  Search by name instead
                </button>
              </>
            ) : (
              <>
                <label className="block">
                  <span className="field-label">Patient</span>
                  <PatientSearch
                    onPatientSelect={handlePatientSelect}
                    placeholder="Search by name or phone"
                  />
                </label>
                <p
                  className={errors.patient ? "field-error" : "field-hint"}
                  role={errors.patient ? "alert" : undefined}
                >
                  {errors.patient ??
                    (patient
                      ? `Selected: ${patient.name}`
                      : "Searches patients registered on this device.")}
                </p>
                <button
                  type="button"
                  className="btn-ghost mt-1 px-2 text-label"
                  onClick={() => setManualPatient(true)}
                >
                  Patient not on this device? Enter their ID
                </button>
              </>
            )}
          </div>

          <form
            id="appointment-form"
            onSubmit={handleSubmit}
            className="space-y-4"
            noValidate
          >
            <div>
              <label htmlFor="appointment-provider" className="field-label">
                Provider
              </label>
              <select
                id="appointment-provider"
                value={providerChoice}
                onChange={(e) => setProviderChoice(e.target.value)}
                className="input-field"
                aria-invalid={errors.provider ? true : undefined}
                aria-describedby="appointment-provider-msg"
              >
                <option value="">Choose a provider</option>
                {showMe && myProviderId && (
                  <option value={myProviderId}>
                    Me{myName ? ` (${myName})` : ""}
                  </option>
                )}
                {showCurrent && (
                  <option value={initialProvider}>
                    Selected provider (not in the staff list)
                  </option>
                )}
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                    {p.id === myProviderId ? " (me)" : ""}
                  </option>
                ))}
                <option value={OTHER_PROVIDER}>Another staff ID…</option>
              </select>
              <p
                id="appointment-provider-msg"
                className={errors.provider ? "field-error" : "field-hint"}
              >
                {errors.provider ??
                  (providersState === "loading"
                    ? "Loading the staff list…"
                    : providersState === "failed"
                      ? "The staff list could not be loaded, so only you or a staff ID can be chosen."
                      : "Clinicians in the online staff directory.")}
              </p>
              {providerChoice === OTHER_PROVIDER && (
                <div className="mt-3">
                  <label
                    htmlFor="appointment-provider-other"
                    className="field-label"
                  >
                    Provider staff ID
                  </label>
                  <input
                    id="appointment-provider-other"
                    type="text"
                    value={otherProviderId}
                    onChange={(e) => setOtherProviderId(e.target.value)}
                    className="input-field"
                    autoComplete="off"
                  />
                </div>
              )}
            </div>

            <div>
              <label htmlFor="appointment-type" className="field-label">
                Appointment type
              </label>
              <select
                id="appointment-type"
                value={appointmentType}
                onChange={(e) => setAppointmentType(e.target.value)}
                className="input-field"
                aria-invalid={errors.type ? true : undefined}
                aria-describedby="appointment-type-msg"
              >
                <option value="">Choose a type</option>
                {typeOptions.map((type) => (
                  <option key={type} value={type}>
                    {type === TELEVISIT_APPOINTMENT_TYPE
                      ? "Televisit (video call)"
                      : type}
                  </option>
                ))}
              </select>
              <p
                id="appointment-type-msg"
                className={errors.type ? "field-error" : "field-hint"}
              >
                {errors.type ?? typeHint()}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="appointment-when" className="field-label">
                  Date and time
                </label>
                <input
                  id="appointment-when"
                  type="datetime-local"
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                  className="input-field"
                  aria-invalid={errors.when ? true : undefined}
                  aria-describedby={
                    errors.when ? "appointment-when-msg" : undefined
                  }
                />
                {errors.when && (
                  <p id="appointment-when-msg" className="field-error">
                    {errors.when}
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="appointment-duration" className="field-label">
                  Length
                </label>
                <select
                  id="appointment-duration"
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="input-field"
                  aria-invalid={errors.duration ? true : undefined}
                  aria-describedby={
                    errors.duration ? "appointment-duration-msg" : undefined
                  }
                >
                  {durationOptions.map((d) => (
                    <option key={d.minutes} value={d.minutes}>
                      {d.label}
                    </option>
                  ))}
                </select>
                {errors.duration && (
                  <p id="appointment-duration-msg" className="field-error">
                    {errors.duration}
                  </p>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="appointment-reason" className="field-label">
                Reason for visit (optional)
              </label>
              <textarea
                id="appointment-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="input-field"
                placeholder="e.g. Blood pressure review"
              />
            </div>
          </form>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-line px-4 py-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="appointment-form"
            disabled={saving}
            className="btn-primary"
          >
            {saving
              ? "Saving…"
              : mode === "edit"
                ? "Save changes"
                : appointmentType === TELEVISIT_APPOINTMENT_TYPE
                  ? "Book televisit"
                  : "Book appointment"}
          </button>
        </div>
      </div>
    </div>
  );
}
