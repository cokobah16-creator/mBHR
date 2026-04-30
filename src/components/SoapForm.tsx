import React, { useState } from "react";
import { formatNigerianDate } from "@/utils/dateFormat";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { db, generateId, createAuditLog } from "@/db";
import { useAuthStore } from "@/stores/auth";
import { queueManagement } from "@/services/queueManagement";
import { recordStageEvent } from "@/services/stageEvents";
import {
  DocumentTextIcon,
  PlusIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

const soapSchema = z.object({
  soapSubjective: z.string().min(1, "Subjective findings required"),
  soapObjective: z.string().min(1, "Objective findings required"),
  soapAssessment: z.string().min(1, "Assessment required"),
  soapPlan: z.string().min(1, "Plan required"),
});

type SoapFormData = z.infer<typeof soapSchema>;

interface SoapFormProps {
  patientId: string;
  visitId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function SoapForm({
  patientId,
  visitId,
  onSuccess,
  onCancel,
}: SoapFormProps) {
  const { currentUser } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [diagnoses, setDiagnoses] = useState<string[]>([""]);
  const [referred, setReferred] = useState(false);
  const [referralNotes, setReferralNotes] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SoapFormData>({
    resolver: zodResolver(soapSchema),
  });

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

      onSuccess?.();
    } catch (error) {
      console.error("Error saving consultation:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="card">
        <div className="flex items-center space-x-3 mb-6">
          <DocumentTextIcon className="h-8 w-8 text-primary" />
          <h2 className="text-2xl font-bold text-gray-900">
            Consultation Notes
          </h2>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Subjective */}
          <div>
            <label
              htmlFor="soapSubjective"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Subjective (Patient's History) *
            </label>
            <textarea
              {...register("soapSubjective")}
              id="soapSubjective"
              className="input-field"
              rows={4}
              placeholder="Patient reports... Chief complaint, history of present illness, review of systems..."
              aria-required="true"
              aria-invalid={errors.soapSubjective ? "true" : "false"}
              aria-describedby={
                errors.soapSubjective ? "soapSubjective-error" : undefined
              }
            />
            {errors.soapSubjective && (
              <p
                id="soapSubjective-error"
                role="alert"
                className="text-red-600 text-sm mt-1"
              >
                {errors.soapSubjective.message}
              </p>
            )}
          </div>

          {/* Objective */}
          <div>
            <label
              htmlFor="soapObjective"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Objective (Physical Examination) *
            </label>
            <textarea
              {...register("soapObjective")}
              id="soapObjective"
              className="input-field"
              rows={4}
              placeholder="Physical examination findings, vital signs, laboratory results..."
              aria-required="true"
              aria-invalid={errors.soapObjective ? "true" : "false"}
              aria-describedby={
                errors.soapObjective ? "soapObjective-error" : undefined
              }
            />
            {errors.soapObjective && (
              <p
                id="soapObjective-error"
                role="alert"
                className="text-red-600 text-sm mt-1"
              >
                {errors.soapObjective.message}
              </p>
            )}
          </div>

          {/* Assessment */}
          <div>
            <label
              htmlFor="soapAssessment"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Assessment (Clinical Impression) *
            </label>
            <textarea
              {...register("soapAssessment")}
              id="soapAssessment"
              className="input-field"
              rows={3}
              placeholder="Clinical reasoning, differential diagnosis, problem list..."
              aria-required="true"
              aria-invalid={errors.soapAssessment ? "true" : "false"}
              aria-describedby={
                errors.soapAssessment ? "soapAssessment-error" : undefined
              }
            />
            {errors.soapAssessment && (
              <p
                id="soapAssessment-error"
                role="alert"
                className="text-red-600 text-sm mt-1"
              >
                {errors.soapAssessment.message}
              </p>
            )}
          </div>

          {/* Plan */}
          <div>
            <label
              htmlFor="soapPlan"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Plan (Treatment Plan) *
            </label>
            <textarea
              {...register("soapPlan")}
              id="soapPlan"
              className="input-field"
              rows={4}
              placeholder="Treatment plan, medications, follow-up instructions, patient education..."
              aria-required="true"
              aria-invalid={errors.soapPlan ? "true" : "false"}
              aria-describedby={errors.soapPlan ? "soapPlan-error" : undefined}
            />
            {errors.soapPlan && (
              <p
                id="soapPlan-error"
                role="alert"
                className="text-red-600 text-sm mt-1"
              >
                {errors.soapPlan.message}
              </p>
            )}
          </div>

          {/* Referral */}
          <fieldset className="rounded-lg border border-gray-200 p-4 space-y-3">
            <legend className="text-sm font-medium text-gray-700 px-1">
              Referral
            </legend>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={referred}
                onChange={(e) => setReferred(e.target.checked)}
                className="mt-1 h-4 w-4 text-primary border-gray-300 rounded focus:ring-primary"
              />
              <span className="text-sm text-gray-700">
                Patient referred to another facility or specialist
              </span>
            </label>
            {referred && (
              <div>
                <label
                  htmlFor="referralNotes"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Referral notes (optional)
                </label>
                <textarea
                  id="referralNotes"
                  value={referralNotes}
                  onChange={(e) => setReferralNotes(e.target.value)}
                  rows={2}
                  placeholder="Where to, reason, urgency..."
                  className="input-field"
                />
              </div>
            )}
          </fieldset>

          {/* Provisional Diagnoses */}
          <fieldset>
            <div className="flex items-center justify-between mb-3">
              <legend className="block text-sm font-medium text-gray-700">
                Provisional Diagnoses
              </legend>
              <button
                type="button"
                onClick={addDiagnosis}
                className="flex items-center space-x-1 text-primary hover:text-primary/80 text-sm font-medium"
                aria-label="Add another diagnosis"
              >
                <PlusIcon className="h-4 w-4" aria-hidden="true" />
                <span>Add Diagnosis</span>
              </button>
            </div>

            <div
              className="space-y-3"
              role="list"
              aria-label="List of diagnoses"
            >
              {diagnoses.map((diagnosis, index) => (
                <div
                  key={index}
                  className="flex items-center space-x-2"
                  role="listitem"
                >
                  <label
                    htmlFor={`diagnosis-${index}`}
                    className="text-sm font-medium text-gray-500 w-8"
                  >
                    {index + 1}.
                  </label>
                  <input
                    type="text"
                    id={`diagnosis-${index}`}
                    value={diagnosis}
                    onChange={(e) => updateDiagnosis(index, e.target.value)}
                    className="input-field flex-1"
                    placeholder="Enter diagnosis (e.g., Hypertension, Type 2 Diabetes)"
                    aria-label={`Diagnosis ${index + 1}`}
                  />
                  {diagnoses.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeDiagnosis(index)}
                      className="text-red-600 hover:text-red-800 p-1 touch-target"
                      aria-label={`Remove diagnosis ${index + 1}`}
                    >
                      <XMarkIcon className="h-5 w-5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </fieldset>

          {/* Provider Info */}
          <div className="bg-gray-50 p-4 rounded-lg">
            <p className="text-sm text-gray-600">
              <strong>Provider:</strong> {currentUser?.fullName || "Unknown"}
            </p>
            <p className="text-sm text-gray-600">
              <strong>Date:</strong> {formatNigerianDate(new Date())}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex space-x-4 pt-6">
            <button
              type="submit"
              disabled={loading}
              className="btn-primary flex-1"
            >
              {loading ? "Saving..." : "Save Consultation"}
            </button>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
