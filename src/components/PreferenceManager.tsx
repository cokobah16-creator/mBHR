import { useState, useEffect, useCallback, useId, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  createOrUpdatePreference,
  getPatientPreference,
  type CreatePreferenceInput,
} from "../services/preferences";
import { createAuditLog, generateId, type PatientPreference } from "../db";
import { isReminderOptedOut } from "../services/reminderEligibility";
import { Cog6ToothIcon, PencilSquareIcon } from "@heroicons/react/24/outline";
import { ExclamationCircleIcon } from "@heroicons/react/20/solid";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { can, type Role } from "@/auth/roles";
import { isOnlineSyncEnabled } from "@/sync/adapter";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";

const preferenceSchema = z.object({
  preferredLanguage: z.string().optional(),
  communicationChannel: z
    .enum(["sms", "whatsapp", "call", "in-person"])
    .optional()
    .or(z.literal("")),
  bestContactTime: z.string().optional(),
  dietaryRestrictions: z.string().optional(),
  religiousCultural: z.string().optional(),
  appointmentReminders: z.boolean(),
  medicationReminders: z.boolean(),
  notes: z.string().optional(),
});

type PreferenceFormData = z.infer<typeof preferenceSchema>;

const CHANNEL_LABEL: Record<string, string> = {
  sms: "SMS",
  whatsapp: "WhatsApp",
  call: "Phone call",
  "in-person": "In person",
};

/** Staff who see patients at a station can record their preferences. */
function canEditPreferences(role: Role | undefined): boolean {
  return (
    !!role &&
    (can(role, "register") ||
      can(role, "vitals") ||
      can(role, "consult") ||
      can(role, "dispense"))
  );
}

// A record pulled from the server can hold true/false instead of 1/0, so
// reminder settings are read with isReminderOptedOut, the rule the reminder
// senders use. They are saved as 1 or 0.
function toFormValues(data: PatientPreference): PreferenceFormData {
  return {
    preferredLanguage: data.preferredLanguage || undefined,
    communicationChannel: data.communicationChannel || undefined,
    bestContactTime: data.bestContactTime || undefined,
    dietaryRestrictions: data.dietaryRestrictions || undefined,
    religiousCultural: data.religiousCultural || undefined,
    appointmentReminders: !isReminderOptedOut("appointment", data),
    medicationReminders: !isReminderOptedOut("medication", data),
    notes: data.notes || undefined,
  };
}

interface PreferenceManagerProps {
  patientId: string;
}

export function PreferenceManager({ patientId }: PreferenceManagerProps) {
  const [preference, setPreference] = useState<PatientPreference | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const currentUser = useAuthStore((s) => s.currentUser);
  const { push } = useToast();
  const uid = useId();
  const canEdit = canEditPreferences(currentUser?.role);

  const { register, handleSubmit, reset } = useForm<PreferenceFormData>({
    resolver: zodResolver(preferenceSchema),
    defaultValues: {
      appointmentReminders: true,
      medicationReminders: true,
    },
  });

  const loadPreference = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await getPatientPreference(patientId);
      setPreference(data || null);
      if (data) reset(toFormValues(data));
    } catch (error) {
      console.error(
        "[preferences] load failed:",
        error instanceof Error ? error.name : error,
      );
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [patientId, reset]);

  useEffect(() => {
    void loadPreference();
  }, [loadPreference]);

  const startEditing = () => {
    if (!canEditPreferences(useAuthStore.getState().currentUser?.role)) return;
    setFormError("");
    setIsEditing(true);
  };

  const onSubmit = async (data: PreferenceFormData) => {
    setFormError("");
    const actor = useAuthStore.getState().currentUser;
    if (!actor || !canEditPreferences(actor.role)) {
      setFormError("Your role cannot change patient preferences.");
      return;
    }

    const input: CreatePreferenceInput = {
      patientId,
      preferredLanguage: data.preferredLanguage,
      communicationChannel: data.communicationChannel || undefined,
      bestContactTime: data.bestContactTime,
      dietaryRestrictions: data.dietaryRestrictions,
      religiousCultural: data.religiousCultural,
      appointmentReminders: data.appointmentReminders ? 1 : 0,
      medicationReminders: data.medicationReminders ? 1 : 0,
      notes: data.notes,
    };

    setSaving(true);
    try {
      const id = await createOrUpdatePreference(input);
      try {
        await createAuditLog(actor.role, "update", "patientPreferences", id);
      } catch (error) {
        console.error(
          "[preferences] audit log failed:",
          error instanceof Error ? error.name : error,
        );
      }
      push({
        id: generateId(),
        tone: "success",
        title: "Preferences saved",
        body: isOnlineSyncEnabled()
          ? "Saved on this device and waiting to sync."
          : "Saved on this device.",
      });
      setIsEditing(false);
      void loadPreference();
    } catch (error) {
      console.error(
        "[preferences] save failed:",
        error instanceof Error ? error.name : error,
      );
      setFormError(
        "Could not save the preferences on this device. Your changes are still in the form; try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  const header = (action?: ReactNode) => (
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-h3 text-ink flex items-center gap-2">
        <Cog6ToothIcon className="h-5 w-5 text-ink-muted" aria-hidden />
        Patient preferences
      </h3>
      {action}
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {header()}
        <span role="status" className="sr-only">
          Loading preferences
        </span>
        <div className="space-y-2" aria-hidden>
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        {header()}
        <div className="banner banner-danger" role="alert">
          <ExclamationCircleIcon className="h-5 w-5 shrink-0 mt-0.5" aria-hidden />
          <div>
            <p>Could not load this patient's preferences from this device.</p>
            <button
              type="button"
              onClick={() => void loadPreference()}
              className="mt-1 inline-flex min-h-touch-target items-center font-medium underline"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!isEditing && !preference) {
    return (
      <div className="space-y-4">
        {header()}
        <div className="rounded-lg border border-dashed border-line-strong">
          <EmptyState
            title="No preferences recorded"
            description={
              canEdit
                ? "Record the patient's language, how to contact them and any cultural or dietary needs."
                : "Staff at registration, vitals, consultation or pharmacy can record them."
            }
            action={
              canEdit ? (
                <button type="button" onClick={startEditing} className="btn-primary">
                  Set preferences
                </button>
              ) : undefined
            }
          />
        </div>
      </div>
    );
  }

  if (!isEditing && preference) {
    const appointmentRemindersOn = !isReminderOptedOut("appointment", preference);
    const medicationRemindersOn = !isReminderOptedOut("medication", preference);
    const fields: { label: string; value?: string; wide?: boolean }[] = [
      { label: "Language", value: preference.preferredLanguage },
      {
        label: "Communication",
        value: preference.communicationChannel
          ? CHANNEL_LABEL[preference.communicationChannel] ??
            preference.communicationChannel
          : undefined,
      },
      { label: "Best contact time", value: preference.bestContactTime },
      { label: "Dietary restrictions", value: preference.dietaryRestrictions },
      {
        label: "Religious or cultural considerations",
        value: preference.religiousCultural,
        wide: true,
      },
    ].filter((f) => !!f.value);

    return (
      <div className="space-y-4">
        {header(
          canEdit ? (
            <button type="button" onClick={startEditing} className="btn-secondary">
              <PencilSquareIcon className="h-4 w-4" aria-hidden />
              Edit
            </button>
          ) : undefined,
        )}

        <div className="rounded-lg border border-line bg-surface-sunken p-4 space-y-3">
          {fields.length > 0 && (
            <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {fields.map((f) => (
                <div key={f.label} className={f.wide ? "md:col-span-2" : undefined}>
                  <dt className="text-label text-ink-muted">{f.label}</dt>
                  <dd className="mt-0.5 text-body text-ink">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}

          <dl
            className={`grid grid-cols-1 gap-2 sm:grid-cols-2 ${
              fields.length > 0 ? "border-t border-line pt-3" : ""
            }`}
          >
            <div className="flex items-center justify-between gap-2 sm:justify-start">
              <dt className="text-label text-ink-secondary">Appointment reminders</dt>
              <dd>
                <StatusBadge tone={appointmentRemindersOn ? "success" : "neutral"}>
                  {appointmentRemindersOn ? "On" : "Off"}
                </StatusBadge>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2 sm:justify-start">
              <dt className="text-label text-ink-secondary">Medication reminders</dt>
              <dd>
                <StatusBadge tone={medicationRemindersOn ? "success" : "neutral"}>
                  {medicationRemindersOn ? "On" : "Off"}
                </StatusBadge>
              </dd>
            </div>
          </dl>

          {preference.notes && (
            <div className="border-t border-line pt-3">
              <p className="text-label text-ink-muted">Notes</p>
              <p className="mt-0.5 text-body text-ink whitespace-pre-wrap">
                {preference.notes}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {header()}

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="rounded-lg border border-line bg-surface-sunken p-4 space-y-4"
        aria-label="Edit patient preferences"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label htmlFor={`${uid}-language`} className="field-label">
              Preferred language
            </label>
            <input
              id={`${uid}-language`}
              {...register("preferredLanguage")}
              className="input-field"
              placeholder="e.g. English, Hausa, Yoruba"
            />
          </div>

          <div>
            <label htmlFor={`${uid}-channel`} className="field-label">
              Communication channel
            </label>
            <select
              id={`${uid}-channel`}
              {...register("communicationChannel")}
              className="input-field"
            >
              <option value="">Not specified</option>
              <option value="sms">SMS</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="call">Phone Call</option>
              <option value="in-person">In Person</option>
            </select>
          </div>

          <div>
            <label htmlFor={`${uid}-contact-time`} className="field-label">
              Best contact time
            </label>
            <input
              id={`${uid}-contact-time`}
              {...register("bestContactTime")}
              className="input-field"
              placeholder="e.g. Morning, Evening"
            />
          </div>

          <div>
            <label htmlFor={`${uid}-diet`} className="field-label">
              Dietary restrictions
            </label>
            <input
              id={`${uid}-diet`}
              {...register("dietaryRestrictions")}
              className="input-field"
              placeholder="e.g. Vegetarian, halal"
              aria-describedby={`${uid}-diet-hint`}
            />
            <p id={`${uid}-diet-hint`} className="field-hint">
              Record allergies under Allergies so they are checked when
              medicines are dispensed.
            </p>
          </div>
        </div>

        <div>
          <label htmlFor={`${uid}-culture`} className="field-label">
            Religious or cultural considerations
          </label>
          <input
            id={`${uid}-culture`}
            {...register("religiousCultural")}
            className="input-field"
            placeholder="Any special considerations"
          />
        </div>

        <fieldset className="border-t border-line pt-3">
          <legend className="sr-only">Reminders</legend>
          <label className="flex min-h-touch-target items-center gap-3 text-body text-ink">
            <input
              type="checkbox"
              {...register("appointmentReminders")}
              className="h-5 w-5 accent-primary"
            />
            Send appointment reminders
          </label>

          <label className="flex min-h-touch-target items-center gap-3 text-body text-ink">
            <input
              type="checkbox"
              {...register("medicationReminders")}
              className="h-5 w-5 accent-primary"
            />
            Send medication reminders
          </label>
        </fieldset>

        <div>
          <label htmlFor={`${uid}-notes`} className="field-label">
            Additional notes
          </label>
          <textarea
            id={`${uid}-notes`}
            {...register("notes")}
            className="input-field"
            rows={3}
            placeholder="Any other preferences or notes"
          />
        </div>

        {formError && (
          <div className="banner banner-danger" role="alert">
            <ExclamationCircleIcon className="h-5 w-5 shrink-0 mt-0.5" aria-hidden />
            <p>{formError}</p>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => {
              setIsEditing(false);
              setFormError("");
              if (preference) reset(toFormValues(preference));
            }}
            className="btn-secondary"
            disabled={saving}
          >
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save preferences"}
          </button>
        </div>
      </form>
    </div>
  );
}
