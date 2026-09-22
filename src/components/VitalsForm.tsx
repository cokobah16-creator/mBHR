import React, { useState, useEffect } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { db, generateId, createAuditLog, bumpDailyCount, epochDay } from "@/db";
import {
  assessVitals,
  classifyBMI,
  classifyBloodPressure,
  getFlagLabel,
  getFlagTone,
} from "@/utils/vitals";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useAuthStore } from "@/stores/auth";
import { queueManagement } from "@/services/queueManagement";
import { recordStageEvent } from "@/services/stageEvents";
import { EnhancedVitalsInput } from "@/components/EnhancedVitalsInput";
import { AudioButton } from "@/components/AudioButton";

const vitalsSchema = z.object({
  heightCm: z.number().min(30).max(250).optional(),
  weightKg: z.number().min(1).max(300).optional(),
  tempC: z.number().min(30).max(45).optional(),
  pulseBpm: z.number().min(30).max(200).optional(),
  systolic: z.number().min(60).max(250).optional(),
  diastolic: z.number().min(30).max(150).optional(),
  spo2: z.number().min(70).max(100).optional(),
});

type VitalsFormData = z.infer<typeof vitalsSchema>;

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
  const [bmi, setBmi] = useState<number | null>(null);
  const [flags, setFlags] = useState<string[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [patient, setPatient] = useState<any>(null);

  const methods = useForm<VitalsFormData>({
    resolver: zodResolver(vitalsSchema),
  });

  const { handleSubmit, watch } = methods;

  const watchedValues = watch();

  useEffect(() => {
    // Load patient data for age/sex context
    db.patients.get(patientId).then(setPatient);
  }, [patientId]);

  // Recalculate BMI and flags as values are entered
  useEffect(() => {
    const assessment = assessVitals(watchedValues);
    setBmi(assessment.bmi);
    setFlags(assessment.flags);
  }, [watchedValues]);

  const onSubmit = async (data: VitalsFormData) => {
    setLoading(true);
    try {
      const vital = {
        id: generateId(),
        patientId,
        visitId,
        ...data,
        bmi: bmi || undefined,
        flags,
        takenAt: new Date(),
        _dirty: 1,
      };

      await db.vitals.add(vital);
      await createAuditLog(
        currentUser?.role || "unknown",
        "create",
        "vital",
        vital.id,
      );

      // Bump daily count
      await bumpDailyCount(epochDay(new Date()), "vitals");

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
    } catch (error) {
      console.error("Error saving vitals:", error);
    } finally {
      setLoading(false);
    }
  };

  const getPatientAge = (dob: string) => {
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birthDate.getDate())
    ) {
      age--;
    }

    return age;
  };

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

  const patientAge = getPatientAge(patient.dob);
  const bmiClass = classifyBMI(bmi);
  const bpClass =
    watchedValues.systolic && watchedValues.diastolic
      ? classifyBloodPressure(watchedValues.systolic, watchedValues.diastolic)
      : null;
  const patientSex =
    patient.sex === "male" ? "M" : patient.sex === "female" ? "F" : "U";
  return (
    <div className="max-w-2xl mx-auto">
      <div className="card">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-h2 text-ink">Record Vital Signs</h2>
          <span className="text-caption text-ink-muted">
            Ranges adjusted for age {patientAge}, {patient.sex}
          </span>
        </div>

        <FormProvider {...methods}>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Height and Weight */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <EnhancedVitalsInput
                name="heightCm"
                label={t("vitals.height")}
                unit="cm"
                metric="hr"
                patientAge={patientAge}
                patientSex={patientSex}
                placeholder="170"
                step={0.1}
              />
              <EnhancedVitalsInput
                name="weightKg"
                label={t("vitals.weight")}
                unit="kg"
                metric="hr"
                patientAge={patientAge}
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
                metric="temp"
                patientAge={patientAge}
                patientSex={patientSex}
                placeholder="36.5"
                step={0.1}
              />
              <EnhancedVitalsInput
                name="pulseBpm"
                label={t("vitals.pulse")}
                unit="bpm"
                metric="hr"
                patientAge={patientAge}
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
                    {watchedValues.systolic}/{watchedValues.diastolic} · {bpClass.label}
                  </StatusBadge>
                )}
              </legend>
              <div className="grid grid-cols-2 gap-4">
                <EnhancedVitalsInput
                  name="systolic"
                  label="Systolic"
                  unit="mmHg"
                  metric="sbp"
                  patientAge={patientAge}
                  patientSex={patientSex}
                  placeholder="120"
                />
                <EnhancedVitalsInput
                  name="diastolic"
                  label="Diastolic"
                  unit="mmHg"
                  metric="dbp"
                  patientAge={patientAge}
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
              metric="spo2"
              patientAge={patientAge}
              patientSex={patientSex}
              placeholder="98"
            />

            {/* Flags Display */}
            {flags.length > 0 && (
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
                  onClick={onCancel}
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
