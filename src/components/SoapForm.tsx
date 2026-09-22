import { useEffect, useState } from "react";
import { formatNigerianDate } from "@/utils/dateFormat";
import { useForm, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { db, generateId, createAuditLog } from "@/db";
import { useAuthStore } from "@/stores/auth";
import { queueManagement } from "@/services/queueManagement";
import { recordStageEvent } from "@/services/stageEvents";
import { PlusIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { ExclamationTriangleIcon } from "@heroicons/react/20/solid";

const soapSchema = z.object({
  soapSubjective: z.string().min(1, "Subjective findings required"),
  soapObjective: z.string().min(1, "Objective findings required"),
  soapAssessment: z.string().min(1, "Assessment required"),
  soapPlan: z.string().min(1, "Plan required"),
});

type SoapFormData = z.infer<typeof soapSchema>;

export type SoapSection = "soap" | "diagnoses" | "referral";

interface SoapFormProps {
  patientId: string;
  visitId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
  /** Which part to show; "all" shows every section stacked. */
  section?: SoapSection | "all";
  /** Called when validation needs the user to see another section. */
  onShowSection?: (section: SoapSection) => void;
  /** Keep the form mounted (and its state) while another tab is showing. */
  hidden?: boolean;
  onCountsChange?: (counts: { diagnoses: number; referred: boolean }) => void;
}

type SoapField = "soapSubjective" | "soapObjective" | "soapAssessment" | "soapPlan";

const FIELDS: {
  name: SoapField;
  label: string;
  hint: string;
  rows: number;
}[] = [
  {
    name: "soapSubjective",
    label: "Subjective",
    hint: "What the patient reports: complaint, history, symptoms.",
    rows: 4,
  },
  {
    name: "soapObjective",
    label: "Objective",
    hint: "Examination findings, vitals, test results.",
    rows: 4,
  },
  {
    name: "soapAssessment",
    label: "Assessment",
    hint: "Clinical impression, differential diagnosis.",
    rows: 3,
  },
  {
    name: "soapPlan",
    label: "Plan",
    hint: "Treatment, medicines, advice, follow-up.",
    rows: 4,
  },
];

export function SoapForm({
  patientId,
  visitId,
  onSuccess,
  onCancel,
  section = "all",
  onShowSection,
  hidden = false,
  onCountsChange,
}: SoapFormProps) {
  const { currentUser } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const [diagnoses, setDiagnoses] = useState<string[]>([""]);
  const [referred, setReferred] = useState(false);
  const [referralNotes, setReferralNotes] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<SoapFormData>({
    resolver: zodResolver(soapSchema),
  });

  const hasUnsaved =
    !saved &&
    (isDirty || referred || diagnoses.some((d) => d.trim() !== ""));

  // Warn before the tab/window closes with notes that were never saved.
  useEffect(() => {
    if (!hasUnsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsaved]);

  const diagnosisCount = diagnoses.filter((d) => d.trim()).length;
  useEffect(() => {
    onCountsChange?.({ diagnoses: diagnosisCount, referred });
  }, [diagnosisCount, referred, onCountsChange]);

  const addDiagnosis = () => {
    setDiagnoses([...diagnoses, ""]);
  };

  const removeDiagnosis = (index: number) => {
    if (diagnoses.length > 1) {
      setDiagnoses(diagnoses.filter((_, i) => i !== index));
    }
  };

  const updateDiagnosis = (index: number, value: string) => {
    const updated = [...diagnoses];
    updated[index] = value;
    setDiagnoses(updated);
  };

  const onSubmit = async (data: SoapFormData) => {
    setSaveError("");
    setLoading(true);
    try {
      const consultation = {
        id: generateId(),
        patientId,
        visitId,
        providerName: currentUser?.fullName || "Unknown Provider",
        soapSubjective: data.soapSubjective || "",
        soapObjective: data.soapObjective || "",
        soapAssessment: data.soapAssessment || "",
        soapPlan: data.soapPlan || "",
        provisionalDx: diagnoses.filter((dx) => dx.trim()),
        referred,
        referralNotes: referred ? referralNotes.trim() || undefined : undefined,
        createdAt: new Date(),
        _dirty: 1,
      };

      await db.consultations.add(consultation);

      await createAuditLog(
        currentUser?.role || "unknown",
        "create",
        "consultation",
        consultation.id,
      );

      await recordStageEvent({
        stage: "consult",
        kind: "finish",
        visitId,
        patientId,
        actorId: currentUser?.id,
      });

      // Move patient to next stage in queue (pharmacy)
      try {
        await queueManagement.moveToNextStage(patientId);
      } catch (error) {
        console.warn("Failed to move patient to next queue stage:", error);
      }

      setSaved(true);
      onSuccess?.();
    } catch (error) {
      console.error("Error saving consultation:", error instanceof Error ? error.name : error);
      setSaveError(
        "The consultation was not saved. Your notes are still here — try again. If it keeps failing, copy the notes before leaving this page.",
      );
    } finally {
      setLoading(false);
    }
  };

  const show = (s: SoapSection) => section === "all" || section === s;

  const onInvalid = (errs: FieldErrors<SoapFormData>) => {
    if (Object.keys(errs).length > 0) onShowSection?.("soap");
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit, onInvalid)}
      className={`panel ${hidden ? "hidden" : ""}`}
      noValidate
      aria-label="Consultation notes"
    >
      <div className="panel-body space-y-5">
        {saveError && (
          <div className="banner banner-danger" role="alert">
            <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
            <span>{saveError}</span>
          </div>
        )}

        <div className={show("soap") ? "space-y-5" : "hidden"}>
          {FIELDS.map((f) => (
            <div key={f.name}>
              <label htmlFor={f.name} className="field-label">
                {f.label} <span className="text-danger-fg" aria-hidden>*</span>
              </label>
              <p id={`${f.name}-hint`} className="-mt-1 mb-1.5 text-caption text-ink-muted">
                {f.hint}
              </p>
              <textarea
                {...register(f.name)}
                id={f.name}
                className="input-field"
                rows={f.rows}
                aria-required="true"
                aria-invalid={errors[f.name] ? "true" : "false"}
                aria-describedby={
                  errors[f.name] ? `${f.name}-hint ${f.name}-error` : `${f.name}-hint`
                }
              />
              {errors[f.name] && (
                <p id={`${f.name}-error`} role="alert" className="field-error">
                  {errors[f.name]?.message}
                </p>
              )}
            </div>
          ))}
        </div>

        <fieldset className={show("diagnoses") ? "" : "hidden"}>
          <div className="mb-3 flex items-center justify-between">
            <legend className="text-h3 text-ink">Provisional diagnoses</legend>
            <button type="button" onClick={addDiagnosis} className="btn-ghost text-primary">
              <PlusIcon className="h-4 w-4" aria-hidden="true" />
              Add diagnosis
            </button>
          </div>
          <ol className="space-y-2" aria-label="Diagnoses">
            {diagnoses.map((diagnosis, index) => (
              <li key={index} className="flex items-center gap-2">
                <label
                  htmlFor={`diagnosis-${index}`}
                  className="w-6 shrink-0 text-label text-ink-muted tabular-nums"
                >
                  {index + 1}.
                </label>
                <input
                  type="text"
                  id={`diagnosis-${index}`}
                  value={diagnosis}
                  onChange={(e) => updateDiagnosis(index, e.target.value)}
                  className="input-field flex-1"
                  placeholder="e.g. Hypertension"
                  aria-label={`Diagnosis ${index + 1}`}
                />
                {diagnoses.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeDiagnosis(index)}
                    className="btn-ghost px-2 text-danger-fg"
                    aria-label={`Remove diagnosis ${index + 1}`}
                  >
                    <XMarkIcon className="h-5 w-5" aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ol>
        </fieldset>

        <fieldset className={show("referral") ? "space-y-3" : "hidden"}>
          <legend className="text-h3 text-ink">Referral</legend>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={referred}
              onChange={(e) => setReferred(e.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <span className="text-body text-ink">
              Refer this patient to another facility or specialist
            </span>
          </label>
          {referred && (
            <div>
              <label htmlFor="referralNotes" className="field-label">
                Referral details
              </label>
              <textarea
                id="referralNotes"
                value={referralNotes}
                onChange={(e) => setReferralNotes(e.target.value)}
                rows={3}
                placeholder="Where to, reason, urgency"
                className="input-field"
              />
            </div>
          )}
        </fieldset>
      </div>

      <div className="flex flex-col gap-3 border-t border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-caption text-ink-muted" aria-live="polite">
          {hasUnsaved ? (
            <span className="font-medium text-warning-fg">Unsaved changes</span>
          ) : (
            "No unsaved changes"
          )}
          {" · "}
          {currentUser?.fullName || "Unknown"} · {formatNigerianDate(new Date())}
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {onCancel && (
            <button type="button" onClick={onCancel} className="btn-secondary">
              Cancel
            </button>
          )}
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? "Saving…" : "Complete consultation"}
          </button>
        </div>
      </div>
    </form>
  );
}
