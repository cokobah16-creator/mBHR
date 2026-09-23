import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { db, generateId, createAuditLog, type Patient } from "@/db";
import { useAuthStore } from "@/stores/auth";
import { can } from "@/auth/roles";
import { useToast } from "@/stores/toast";
import { PatientSearch } from "@/components/PatientSearch";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { getSmsTemplateBody, renderTemplate } from "@/services/messageTemplates";
import { queueSMS } from "@/services/notificationWorker";
import { formatNigerianDate } from "@/utils/dateFormat";
import {
  MAX_MESSAGE_LENGTH,
  SMS_LOCALES,
  defaultSendSlot,
  estimateSmsParts,
  formatPhone,
  formatWhen,
  localeFromPreference,
  normalizeReminderPhone,
  parseSendAt,
  todayInputValue,
  validateReminderDraft,
  type ReminderDraft,
  type ReminderDraftErrors,
  type SendingBlocker,
  type SmsLocale,
} from "@/features/notifications/smsOutbox";

interface ScheduleReminderFormProps {
  /** Fix the form to one patient (no patient search). */
  patientId?: string;
  /** Prefill the medicine and dose from this dispense. */
  dispenseId?: string;
  blocker: SendingBlocker | null;
  onClose: () => void;
  onScheduled: (messageId: string) => void;
}

const FIELD_IDS: Record<keyof ReminderDraft, string> = {
  patientId: "schedule-patient-heading",
  phone: "schedule-phone",
  medicationName: "schedule-medicine",
  dosage: "schedule-dose",
  message: "schedule-message",
  sendDate: "schedule-date",
  sendTime: "schedule-time",
};

const FIELD_ORDER: (keyof ReminderDraft)[] = [
  "patientId",
  "phone",
  "medicationName",
  "dosage",
  "sendDate",
  "message",
];

const CHANNEL_NOTE: Record<string, string> = {
  whatsapp: "prefers WhatsApp",
  call: "prefers a phone call",
  "in-person": "prefers to be told in person",
};

function longWhen(date: Date): string {
  return date.toLocaleString("en-NG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Schedule an SMS medication reminder. The reminder is saved on this device
 * (never claimed as sent) and shown for review, with the exact text and the
 * send time, before it is saved.
 */
export function ScheduleReminderForm({
  patientId,
  dispenseId,
  blocker,
  onClose,
  onScheduled,
}: ScheduleReminderFormProps) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const { push } = useToast();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const reviewRef = useRef<HTMLHeadingElement>(null);

  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [phone, setPhone] = useState("");
  const [medicationName, setMedicationName] = useState("");
  const [dosage, setDosage] = useState("");
  const [locale, setLocale] = useState<SmsLocale>("en");
  const [initialSlot] = useState(() => defaultSendSlot(new Date()));
  const [sendDate, setSendDate] = useState(initialSlot.date);
  const [sendTime, setSendTime] = useState(initialSlot.time);
  const [message, setMessage] = useState("");
  const [messageEdited, setMessageEdited] = useState(false);
  const [templateBody, setTemplateBody] = useState<string | null>(null);
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [errors, setErrors] = useState<ReminderDraftErrors>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  // null = not found on this device; undefined = still loading.
  const fixedPatient = useLiveQuery(
    () => (patientId ? db.patients.get(patientId).then((p) => p ?? null) : null),
    [patientId],
  );
  const patient: Patient | null = fixedPatient ?? selectedPatient;
  const currentPatientId = patient?.id;

  // null = no preferences recorded; undefined = still loading.
  const preference = useLiveQuery(
    () =>
      currentPatientId
        ? db.patientPreferences
            .where("patientId")
            .equals(currentPatientId)
            .first()
            .then((p) => p ?? null)
        : null,
    [currentPatientId],
  );

  const recentDispenses = useLiveQuery(
    () =>
      currentPatientId
        ? db.dispenses
            .where("patientId")
            .equals(currentPatientId)
            .reverse()
            .sortBy("dispensedAt")
            .then((rows) => rows.slice(0, 10))
        : [],
    [currentPatientId],
  );

  const dispense = useLiveQuery(
    () => (dispenseId ? db.dispenses.get(dispenseId) : undefined),
    [dispenseId],
  );

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (step === "review") reviewRef.current?.focus();
  }, [step]);

  // Phone from the fixed patient's record, once it has loaded.
  useEffect(() => {
    if (fixedPatient) setPhone((current) => current || fixedPatient.phone || "");
  }, [fixedPatient]);

  // Medicine and dose from the dispense this reminder is for.
  useEffect(() => {
    if (!dispense) return;
    setMedicationName((current) => current || dispense.itemName || "");
    setDosage((current) => current || dispense.dosage || "");
  }, [dispense]);

  // Default language from the patient's preferences.
  useEffect(() => {
    if (preference === undefined) return;
    setLocale(localeFromPreference(preference?.preferredLanguage));
  }, [preference]);

  useEffect(() => {
    let cancelled = false;
    getSmsTemplateBody("medication_reminder", locale)
      .then((body) => {
        if (!cancelled) setTemplateBody(body);
      })
      .catch(() => {
        if (!cancelled) setTemplateBody(null);
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const givenName = patient?.givenName?.trim() || "";
  const templateText = useMemo(() => {
    if (!templateBody || !medicationName.trim()) return "";
    return renderTemplate(templateBody, {
      patient_name: givenName || "Patient",
      medication: medicationName.trim(),
      dosage: dosage.trim() || "as prescribed",
    });
  }, [templateBody, givenName, medicationName, dosage]);

  const messageText = messageEdited ? message : templateText;
  const parts = estimateSmsParts(messageText.trim());
  const optedOut = preference?.medicationReminders === 0;
  const channelNote = preference?.communicationChannel
    ? CHANNEL_NOTE[preference.communicationChannel]
    : undefined;
  const patientName = patient ? `${patient.givenName} ${patient.familyName}`.trim() : "";

  const choosePatient = (p: Patient) => {
    setSelectedPatient(p);
    setPhone(p.phone || "");
    setErrors((e) => ({ ...e, patientId: undefined, phone: undefined }));
  };

  const draft: ReminderDraft = {
    patientId: patient?.id ?? "",
    phone,
    medicationName,
    dosage,
    message: messageText,
    sendDate,
    sendTime,
  };

  const clearError = (field: keyof ReminderDraft) => {
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  };

  const handleReview = (e: FormEvent) => {
    e.preventDefault();
    setFormError("");
    const found = validateReminderDraft(draft, new Date());
    setErrors(found);
    const first = FIELD_ORDER.find((f) => found[f]);
    if (first) {
      setFormError("Check the highlighted fields.");
      document.getElementById(FIELD_IDS[first])?.focus();
      return;
    }
    if (optedOut) return;
    setStep("review");
  };

  const handleConfirm = async () => {
    setFormError("");
    if (!currentUser || !can(currentUser.role, "dispense")) {
      setFormError("Only pharmacists and admins can schedule reminders.");
      return;
    }
    if (optedOut) {
      setFormError("This patient has asked not to receive medication reminders.");
      return;
    }
    const found = validateReminderDraft(draft, new Date());
    const sendAt = parseSendAt(sendDate, sendTime);
    const msisdn = normalizeReminderPhone(phone);
    if (Object.values(found).some(Boolean) || !sendAt || !msisdn || !patient) {
      setErrors(found);
      setStep("edit");
      setFormError("Something changed. Check the highlighted fields.");
      return;
    }

    setSaving(true);
    try {
      const details: Record<string, string> = {
        medicationName: medicationName.trim(),
        dosage: dosage.trim(),
      };
      if (dispenseId) details.dispenseId = dispenseId;
      const id = await queueSMS(
        patient.id,
        `+${msisdn}`,
        messageText.trim(),
        sendAt,
        "medication_reminder",
        locale,
        details,
      );
      await createAuditLog(
        currentUser.role,
        "sms_reminder_scheduled",
        "outboundMessages",
        id,
      ).catch((error) =>
        console.warn("Audit log not written:", error instanceof Error ? error.name : error),
      );
      push({
        id: generateId(),
        tone: "success",
        title: "Reminder saved on this device",
        body: `Queued for ${formatWhen(sendAt)}. It has not been sent yet.`,
      });
      onScheduled(id);
    } catch (error) {
      console.error(
        "Could not save reminder:",
        error instanceof Error ? error.name : error,
      );
      setFormError("The reminder was not saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const sendAt = parseSendAt(sendDate, sendTime);

  const fieldProps = (field: keyof ReminderDraft, hintId?: string) => ({
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby": errors[field] ? `${FIELD_IDS[field]}-error` : hintId,
  });

  return (
    <section className="panel" aria-labelledby="schedule-reminder-title">
      <div className="panel-header">
        <h2
          id="schedule-reminder-title"
          ref={headingRef}
          tabIndex={-1}
          className="panel-title focus:outline-none"
        >
          Schedule a reminder
        </h2>
        <StatusBadge tone="neutral" icon>
          Draft, not saved
        </StatusBadge>
      </div>

      <div className="panel-body space-y-4">
        {formError && (
          <div className="banner banner-danger" role="alert">
            <ExclamationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
            <p>{formError}</p>
          </div>
        )}

        {optedOut && (
          <div className="banner banner-danger" role="alert">
            <ExclamationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
            <p>
              {patientName || "This patient"} has asked not to receive medication reminders
              (patient preferences). No reminder can be scheduled. If they have changed their
              mind, update their preferences first.
            </p>
          </div>
        )}

        {step === "edit" ? (
          <>
            <div>
              {patientId ? (
                <>
                  <p id={FIELD_IDS.patientId} tabIndex={-1} className="field-label">
                    Patient
                  </p>
                  <p className="rounded-md border border-line bg-surface-sunken px-3 py-2.5 text-body text-ink">
                    {fixedPatient === undefined
                      ? "Loading patient…"
                      : patientName || "Patient record is not on this device"}
                  </p>
                </>
              ) : patient ? (
                <>
                  <p id={FIELD_IDS.patientId} tabIndex={-1} className="field-label">
                    Patient
                  </p>
                  <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-sunken px-3 py-1.5">
                    <span className="text-body text-ink">{patientName}</span>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => {
                        setSelectedPatient(null);
                        setPhone("");
                      }}
                    >
                      Change
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <label className="block">
                    <span id={FIELD_IDS.patientId} tabIndex={-1} className="field-label">
                      Patient
                    </span>
                    <PatientSearch
                      onPatientSelect={choosePatient}
                      placeholder="Search by name or phone"
                    />
                  </label>
                  {errors.patientId ? (
                    <p id={`${FIELD_IDS.patientId}-error`} className="field-error">
                      {errors.patientId}
                    </p>
                  ) : (
                    <p className="field-hint">Searches patients registered on this device.</p>
                  )}
                </>
              )}
              {(patientId || patient) && errors.patientId && (
                <p id={`${FIELD_IDS.patientId}-error`} className="field-error">
                  {errors.patientId}
                </p>
              )}
              {channelNote && (
                <p className="field-hint">
                  {patient?.givenName || "This patient"} {channelNote}. An SMS may not be the
                  best way to reach them.
                </p>
              )}
            </div>

            <form
              id="schedule-reminder-form"
              onSubmit={handleReview}
              noValidate
              className="space-y-4"
            >
              <div>
                <label htmlFor={FIELD_IDS.phone} className="field-label">
                  Phone number
                </label>
                <input
                  id={FIELD_IDS.phone}
                  type="tel"
                  inputMode="tel"
                  autoComplete="off"
                  className="input-field tabular-nums sm:max-w-xs"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    clearError("phone");
                  }}
                  placeholder="e.g. 0803 123 4567"
                  {...fieldProps("phone", "schedule-phone-hint")}
                />
                {errors.phone ? (
                  <p id={`${FIELD_IDS.phone}-error`} className="field-error">
                    {errors.phone}
                  </p>
                ) : (
                  <p id="schedule-phone-hint" className="field-hint">
                    {patient && !patient.phone
                      ? "No phone number on the patient record. Enter the number the patient gave you."
                      : "Taken from the patient record. Change it here if the patient gave a different number."}
                  </p>
                )}
              </div>

              {recentDispenses && recentDispenses.length > 0 && (
                <div>
                  <label htmlFor="schedule-dispense" className="field-label">
                    Fill from a recent dispense (optional)
                  </label>
                  <select
                    id="schedule-dispense"
                    className="input-field"
                    value=""
                    onChange={(e) => {
                      const d = recentDispenses.find((r) => r.id === e.target.value);
                      if (!d) return;
                      setMedicationName(d.itemName || "");
                      setDosage(d.dosage || "");
                      setErrors((er) => ({ ...er, medicationName: undefined, dosage: undefined }));
                    }}
                  >
                    <option value="">Choose a dispensed medicine</option>
                    {recentDispenses.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.itemName}
                        {d.dosage ? ` · ${d.dosage}` : ""} · {formatNigerianDate(d.dispensedAt)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor={FIELD_IDS.medicationName} className="field-label">
                    Medicine
                  </label>
                  <input
                    id={FIELD_IDS.medicationName}
                    className="input-field"
                    value={medicationName}
                    onChange={(e) => {
                      setMedicationName(e.target.value);
                      clearError("medicationName");
                    }}
                    placeholder="e.g. Amoxicillin"
                    {...fieldProps("medicationName")}
                  />
                  {errors.medicationName && (
                    <p id={`${FIELD_IDS.medicationName}-error`} className="field-error">
                      {errors.medicationName}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor={FIELD_IDS.dosage} className="field-label">
                    Dose
                  </label>
                  <input
                    id={FIELD_IDS.dosage}
                    className="input-field"
                    value={dosage}
                    onChange={(e) => {
                      setDosage(e.target.value);
                      clearError("dosage");
                    }}
                    placeholder="e.g. 500 mg"
                    {...fieldProps("dosage")}
                  />
                  {errors.dosage && (
                    <p id={`${FIELD_IDS.dosage}-error`} className="field-error">
                      {errors.dosage}
                    </p>
                  )}
                </div>
              </div>

              <fieldset>
                <legend className="field-label">Send from</legend>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label htmlFor={FIELD_IDS.sendDate} className="text-caption text-ink-muted">
                      Date
                    </label>
                    <input
                      id={FIELD_IDS.sendDate}
                      type="date"
                      min={todayInputValue(new Date())}
                      className="input-field mt-1"
                      value={sendDate}
                      onChange={(e) => {
                        setSendDate(e.target.value);
                        clearError("sendDate");
                      }}
                      {...fieldProps("sendDate", "schedule-when-hint")}
                    />
                  </div>
                  <div>
                    <label htmlFor={FIELD_IDS.sendTime} className="text-caption text-ink-muted">
                      Time
                    </label>
                    <input
                      id={FIELD_IDS.sendTime}
                      type="time"
                      className="input-field mt-1"
                      value={sendTime}
                      onChange={(e) => {
                        setSendTime(e.target.value);
                        clearError("sendDate");
                      }}
                      aria-invalid={errors.sendDate ? true : undefined}
                      aria-describedby={
                        errors.sendDate ? `${FIELD_IDS.sendDate}-error` : "schedule-when-hint"
                      }
                    />
                  </div>
                  <div>
                    <label htmlFor="schedule-language" className="text-caption text-ink-muted">
                      Language
                    </label>
                    <select
                      id="schedule-language"
                      className="input-field mt-1"
                      value={locale}
                      onChange={(e) => {
                        const next = SMS_LOCALES.find((l) => l.value === e.target.value);
                        if (next) setLocale(next.value);
                      }}
                    >
                      {SMS_LOCALES.map((l) => (
                        <option key={l.value} value={l.value}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {errors.sendDate ? (
                  <p id={`${FIELD_IDS.sendDate}-error`} className="field-error">
                    {errors.sendDate}
                  </p>
                ) : (
                  <p id="schedule-when-hint" className="field-hint">
                    It is sent at or after this time, when this device is online and sending
                    runs.
                  </p>
                )}
              </fieldset>

              <div>
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <label htmlFor={FIELD_IDS.message} className="field-label">
                    Message
                  </label>
                  {messageEdited && (
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => {
                        setMessageEdited(false);
                        clearError("message");
                      }}
                    >
                      Use template text
                    </button>
                  )}
                </div>
                <textarea
                  id={FIELD_IDS.message}
                  rows={4}
                  className="input-field"
                  value={messageText}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    setMessageEdited(true);
                    clearError("message");
                  }}
                  placeholder="Filled in from the template once you enter the medicine"
                  {...fieldProps("message", "schedule-message-hint")}
                />
                {errors.message ? (
                  <p id={`${FIELD_IDS.message}-error`} className="field-error">
                    {errors.message}
                  </p>
                ) : (
                  <p id="schedule-message-hint" className="field-hint">
                    {parts.chars} of {MAX_MESSAGE_LENGTH} characters, about {parts.parts} SMS
                    {parts.unicode ? " (special characters use more SMS)" : ""}. If there is no
                    template in this language, the English text is used; edit it if needed.
                  </p>
                )}
              </div>
            </form>
          </>
        ) : (
          <div className="space-y-4">
            <h3
              ref={reviewRef}
              tabIndex={-1}
              className="text-h3 text-ink focus:outline-none"
            >
              Check before scheduling
            </h3>
            <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-2 text-body">
              <dt className="text-ink-muted">Patient</dt>
              <dd className="text-ink">{patientName}</dd>
              <dt className="text-ink-muted">To</dt>
              <dd className="tabular-nums text-ink">
                {formatPhone(`+${normalizeReminderPhone(phone) ?? ""}`)}
              </dd>
              <dt className="text-ink-muted">Send from</dt>
              <dd className="text-ink">{sendAt ? longWhen(sendAt) : ""}</dd>
              <dt className="text-ink-muted">Language</dt>
              <dd className="text-ink">
                {SMS_LOCALES.find((l) => l.value === locale)?.label}
              </dd>
            </dl>
            <div>
              <p className="section-label">Message that will be sent</p>
              <p className="mt-1 whitespace-pre-wrap break-words rounded-md border border-line bg-surface-sunken px-3 py-2 text-body text-ink">
                {messageText.trim()}
              </p>
              <p className="field-hint">
                {parts.chars} characters, about {parts.parts} SMS
              </p>
            </div>
            <div
              className={`banner ${blocker === "not_configured" ? "banner-warning" : "banner-info"}`}
            >
              {blocker === "not_configured" ? (
                <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
              ) : (
                <InformationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
              )}
              <p>
                {blocker === "not_configured"
                  ? "This device is not connected to the mBHR server. The reminder is saved here but will not be sent until the server connection is set up."
                  : blocker === "offline"
                    ? `This device is offline. The reminder is saved on this device only and can only be sent from it, after ${sendAt ? formatWhen(sendAt) : "that time"}, once it is back online and sending runs.`
                    : `The reminder is saved on this device only. From ${sendAt ? formatWhen(sendAt) : "that time"} this device sends it through the mBHR server when it is online and sending runs: automatic sending on with the app open, or someone pressing Send due messages now.`}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-line px-4 py-3 sm:flex-row sm:justify-end">
        {step === "edit" ? (
          <>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Discard draft
            </button>
            <button
              type="submit"
              form="schedule-reminder-form"
              className="btn-primary"
              disabled={optedOut}
            >
              Review reminder
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setStep("edit")}
              disabled={saving}
            >
              Edit
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleConfirm}
              disabled={saving || optedOut}
            >
              {saving ? "Saving…" : "Schedule reminder"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
