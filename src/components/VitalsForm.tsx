import React, { useState, useEffect } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import {
  db,
  generateId,
  createAuditLog,
  bumpDailyCount,
  epochDay,
  type Patient,
  type Vital,
} from "@/db";
import { vitalsSchema, type VitalsFormData } from "@/validation/schemas";
import {
  adultVitalRangesApply,
  assessVitals,
  classifyBMI,
  classifyBloodPressure,
  enteredMeasurements,
  getFlagLabel,
  getFlagTone,
  hasVitalsEntries,
} from "@/utils/vitals";
import { patientAge } from "@/utils/patient";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAuthStore } from "@/stores/auth";
import { queueManagement } from "@/services/queueManagement";
import { recordStageEvent } from "@/services/stageEvents";
import { EnhancedVitalsInput } from "@/components/EnhancedVitalsInput";
import { AudioButton } from "@/components/AudioButton";

interface VitalsFormProps {
  patientId: string;
  visitId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function VitalsForm({
  patientId,
  visitId,
  onSuccess,
  onCancel,
}: VitalsFormProps) {
  const { t } = useTranslation();
  const { currentUser } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [patient, setPatient] = useState<Patient | null>(null);
  const [patientMissing, setPatientMissing] = useState(false);

  // The shared schema: every measurement is optional, and systolic must be
  // above diastolic.
  const methods = useForm<VitalsFormData>({
    resolver: zodResolver(vitalsSchema),
  });

  const { handleSubmit, watch, getValues } = methods;

  // BMI and flags are worked out from these on each render, not copied into
  // state (copying them in an effect keyed on watch() re-rendered forever).
  const watchedValues = watch();
  const hasEntries = hasVitalsEntries(watchedValues);

  useEffect(() => {
    // Load patient data for age/sex context. A late answer for a previous
    // patient is ignored.
    let cancelled = false;
    setPatient(null);
    setPatientMissing(false);
    db.patients.get(patientId).then(
      (found) => {
        if (cancelled) return;
        setPatient(found ?? null);
        setPatientMissing(!found);
      },
      () => {
        if (!cancelled) setPatientMissing(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  // Warn before the tab/window closes with entries that were never saved.
  useEffect(() => {
    if (!hasEntries) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasEntries]);

  const onSubmit = async (data: VitalsFormData) => {
    setSaveError("");
    // Empty fields stay out of the record (never NaN or 0).
    const measurements = enteredMeasurements(data);
    if (Object.keys(measurements).length === 0) {
      setSaveError("Enter at least one measurement before saving.");
      return;
    }
    setLoading(true);
    try {
      const takenAt = new Date();
      // Adult thresholds are only applied when the patient is 18 or over
      // at the time of the reading.
      const { bmi, flags } = assessVitals(measurements, {
        adultRanges: adultVitalRangesApply(patient?.dob, takenAt),
      });
      const vital: Vital = {
        id: generateId(),
        patientId,
        visitId,
        ...measurements,
        bmi: bmi || undefined,
        flags,
        takenAt,
        _dirty: 1,
      };

      // The reading and its audit entry are saved together or not at all,
      // so "not saved" is always true and trying again cannot duplicate it.
      try {
        await db.transaction("rw", db.vitals, db.auditLogs, async () => {
          await db.vitals.add(vital);
          await createAuditLog(
            currentUser?.role || "unknown",
            "create",
            "vital",
            vital.id,
          );
        });
      } catch (error) {
        console.error(
          "Error saving vitals:",
          error instanceof Error ? error.name : error,
        );
        setSaveError(
          "The vitals were not saved. Your entries are still here — try again.",
        );
        return;
      }

      // Saved. The steps below log their own failures and never undo it.
      await bumpDailyCount(epochDay(takenAt), "vitals");

      await recordStageEvent({
        stage: "vitals",
        kind: "finish",
        visitId,
        patientId,
        actorId: currentUser?.id,
      });

      // Move patient to next stage in queue (consult)
      try {
        await queueManagement.moveToNextStage(patientId);
      } catch (error) {
        console.warn("Failed to move patient to next queue stage:", error);
      }

      onSuccess?.();
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    if (
      hasVitalsEntries(getValues()) &&
      !window.confirm(
        "Discard the vitals you have entered? They have not been saved.",
      )
    ) {
      return;
    }
    onCancel?.();
  };

  if (patientMissing) {
    return (
      <div className="max-w-2xl mx-auto banner banner-warning" role="alert">
        <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
        <span>
          This patient's record could not be read on this device, so vitals
          cannot be recorded here.
        </span>
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="max-w-2xl mx-auto panel p-5 space-y-4" role="status">
        <span className="sr-only">Loading patient</span>
        <div className="skeleton h-6 w-48" aria-hidden />
        <div className="grid grid-cols-2 gap-4" aria-hidden>
          <div className="skeleton h-16" />
          <div className="skeleton h-16" />
        </div>
      </div>
    );
  }

  const age = patientAge(patient.dob);
  // Adult thresholds do not apply under 18 or when the age is unknown. The
  // form then shows no adult ranges, categories or flags, and asks for a
  // check against a paediatric chart instead.
  const adultRanges = adultVitalRangesApply(patient.dob);
  const entered = enteredMeasurements(watchedValues);
  const { bmi, flags } = assessVitals(entered, { adultRanges });
  const bmiClass = adultRanges ? classifyBMI(bmi) : null;
  const bpClass =
    adultRanges && entered.systolic && entered.diastolic
      ? classifyBloodPressure(entered.systolic, entered.diastolic)
      : null;
  const rangeMetric = (metric: "hr" | "temp" | "sbp" | "dbp" | "spo2") =>
    adultRanges ? metric : undefined;
  const patientSex =
    patient.sex === "male" ? "M" : patient.sex === "female" ? "F" : "U";
  return (
    <div className="max-w-2xl mx-auto">
      <div className="card">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-h2 text-ink">Record Vital Signs</h2>
          <span className="text-caption text-ink-muted">
            {adultRanges
              ? `Ranges adjusted for age ${age}, ${patient.sex}`
              : age === null
                ? "Age not known"
                : `Age ${age}, ${patient.sex}`}
          </span>
        </div>

        {!adultRanges && (
          <div className="banner banner-warning mb-5" role="status">
            <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
            <span>
              {age === null
                ? "This patient's age is not known, so the readings are not flagged here. Check each reading by hand against the chart for their age"
                : "This patient is under 18, so the adult ranges do not apply and the readings are not flagged here. Check each reading against a paediatric chart"}{" "}
              and tell the clinician about any concern before the consultation.
            </span>
          </div>
        )}

        <FormProvider {...methods}>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Height and Weight (no reference range) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <EnhancedVitalsInput
                name="heightCm"
                label={t("vitals.height")}
                unit="cm"
                patientAge={age}
                patientSex={patientSex}
                placeholder="170"
                step={0.1}
              />
              <EnhancedVitalsInput
                name="weightKg"
                label={t("vitals.weight")}
                unit="kg"
                patientAge={age}
                patientSex={patientSex}
                placeholder="70"
                step={0.1}
              />
            </div>

            {/* BMI Display */}
            {bmi && (
              <div
                className="flex items-center gap-3 rounded-md border border-line bg-surface-sunken px-4 py-3"
                role="status"
                aria-live="polite"
              >
                <span className="text-label text-ink-secondary">BMI</span>
                <span className="text-h2 text-ink">{bmi}</span>
                {bmiClass && (
                  <StatusBadge tone={bmiClass.tone} icon={bmiClass.tone !== "success"}>
                    {bmiClass.label}
                  </StatusBadge>
                )}
              </div>
            )}

            {/* Temperature and Pulse */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <EnhancedVitalsInput
                name="tempC"
                label={t("vitals.temperature")}
                unit="°C"
                metric={rangeMetric("temp")}
                patientAge={age}
                patientSex={patientSex}
                placeholder="36.5"
                step={0.1}
              />
              <EnhancedVitalsInput
                name="pulseBpm"
                label={t("vitals.pulse")}
                unit="bpm"
                metric={rangeMetric("hr")}
                patientAge={age}
                patientSex={patientSex}
                placeholder="72"
              />
            </div>

            {/* Blood Pressure */}
            <fieldset>
              <legend className="field-label flex flex-wrap items-center gap-2">
                {t("vitals.bloodPressure")}
                {bpClass && (
                  <StatusBadge tone={bpClass.tone} icon={bpClass.tone !== "success"}>
                    {entered.systolic}/{entered.diastolic} · {bpClass.label}
                  </StatusBadge>
                )}
              </legend>
              <div className="grid grid-cols-2 gap-4">
                <EnhancedVitalsInput
                  name="systolic"
                  label="Systolic"
                  unit="mmHg"
                  metric={rangeMetric("sbp")}
                  patientAge={age}
                  patientSex={patientSex}
                  placeholder="120"
                />
                <EnhancedVitalsInput
                  name="diastolic"
                  label="Diastolic"
                  unit="mmHg"
                  metric={rangeMetric("dbp")}
                  patientAge={age}
                  patientSex={patientSex}
                  placeholder="80"
                />
              </div>
            </fieldset>

            {/* SpO2 */}
            <EnhancedVitalsInput
              name="spo2"
              label="SpO2"
              unit="%"
              metric={rangeMetric("spo2")}
              patientAge={age}
              patientSex={patientSex}
              placeholder="98"
            />

            {/* Flags Display (adult thresholds only) */}
            {adultRanges && flags.length > 0 && (
              <div
                className="rounded-md border border-warning-line bg-warning-soft p-4"
                role="alert"
                aria-live="polite"
              >
                <h3 className="text-label text-warning-fg mb-2">
                  Abnormal values — tell the clinician before the consultation
                </h3>
                <ul
                  className="flex flex-wrap gap-2"
                  aria-label="Abnormal vital signs"
                >
                  {flags.map((flag) => (
                    <li key={flag}>
                      <StatusBadge tone={getFlagTone(flag)}>
                        {getFlagLabel(flag)}
                      </StatusBadge>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {saveError && (
              <div className="banner banner-danger" role="alert">
                <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
                <span>{saveError}</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex space-x-4 pt-6">
              <AudioButton
                audioKey="action.save"
                fallbackText="Save Vitals"
                type="submit"
                disabled={loading}
                className="btn-primary flex-1"
              >
                {loading ? "Saving..." : "Save Vitals"}
              </AudioButton>
              {onCancel && (
                <AudioButton
                  audioKey="action.cancel"
                  fallbackText="Cancel"
                  type="button"
                  onClick={handleCancel}
                  className="btn-secondary flex-1"
                >
                  Cancel
                </AudioButton>
              )}
            </div>
          </form>
        </FormProvider>
      </div>
    </div>
  );
}
