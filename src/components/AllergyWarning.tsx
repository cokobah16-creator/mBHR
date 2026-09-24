import { useCallback, useEffect, useState } from "react";
import {
  getActiveAllergies,
  checkMedicationAllergy,
} from "../services/allergies";
import type { PatientAllergy } from "../db";
import { ExclamationTriangleIcon } from "@heroicons/react/24/solid";

interface AllergyWarningProps {
  patientId: string;
  medicationName?: string;
}

const SEVERITY_LABEL: Record<string, string> = {
  "life-threatening": "Life-threatening",
  severe: "Severe",
  moderate: "Moderate",
  mild: "Mild",
};

/** Life-threatening allergies use the critical tone; every other allergy is danger. */
function conflictClasses(severity: string): string {
  return severity === "life-threatening"
    ? "border-critical bg-critical-soft text-critical"
    : "border-danger bg-danger-soft text-danger-fg";
}

export function AllergyWarning({
  patientId,
  medicationName,
}: AllergyWarningProps) {
  const [allergies, setAllergies] = useState<PatientAllergy[]>([]);
  const [medicationConflict, setMedicationConflict] =
    useState<PatientAllergy | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const loadAllergies = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const activeAllergies = await getActiveAllergies(patientId);
      setAllergies(activeAllergies);

      if (medicationName) {
        const conflict = await checkMedicationAllergy(
          patientId,
          medicationName,
        );
        setMedicationConflict(conflict);
      } else {
        setMedicationConflict(null);
      }
    } catch (error) {
      console.error(
        "Error loading allergies:",
        error instanceof Error ? error.name : error,
      );
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [patientId, medicationName]);

  useEffect(() => {
    loadAllergies();
  }, [loadAllergies]);

  if (loading) return null;

  if (loadFailed) {
    return (
      <div className="banner banner-warning" role="alert">
        <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
        <span>
          Allergies could not be checked on this device. Ask the patient about
          allergies before continuing.
        </span>
      </div>
    );
  }

  const severityLevel =
    medicationConflict?.severity || (allergies.length > 0 ? "mild" : null);

  if (!severityLevel && allergies.length === 0) return null;

  return (
    <div className="space-y-2">
      {medicationConflict && (
        <div
          className={`rounded-md border-l-4 border p-4 ${conflictClasses(medicationConflict.severity)}`}
          role="alert"
        >
          <div className="flex items-start gap-3">
            <ExclamationTriangleIcon
              className="h-6 w-6 shrink-0"
              aria-hidden
            />
            <div className="flex-1">
              <h4 className="text-h3 mb-1">Medication allergy alert</h4>
              <p className="mb-2 font-medium">
                Patient is allergic to:{" "}
                <span className="font-bold">{medicationConflict.allergen}</span>
              </p>
              <p className="text-body">
                Severity:{" "}
                <span className="font-bold">
                  {SEVERITY_LABEL[medicationConflict.severity] ??
                    medicationConflict.severity}
                </span>
              </p>
              {medicationConflict.reaction && (
                <p className="mt-1 text-body">
                  Reaction: {medicationConflict.reaction}
                </p>
              )}
              {medicationConflict.notes && (
                <p className="mt-1 text-body italic">
                  Note: {medicationConflict.notes}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {!medicationConflict && allergies.length > 0 && (
        <div className="banner banner-danger" role="status">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
          <div className="flex-1">
            <h4 className="mb-1 font-semibold">
              Patient has {allergies.length} known allerg
              {allergies.length === 1 ? "y" : "ies"}:
            </h4>
            <ul className="list-disc list-inside space-y-1">
              {allergies.map((allergy) => (
                <li key={allergy.id} className="text-body">
                  <span className="font-medium">{allergy.allergen}</span> (
                  {allergy.allergyType},{" "}
                  {SEVERITY_LABEL[allergy.severity] ?? allergy.severity})
                  {allergy.reaction && ` - ${allergy.reaction}`}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

interface AllergyBadgeProps {
  patientId: string;
  compact?: boolean;
}

export function AllergyBadge({
  patientId,
  compact = false,
}: AllergyBadgeProps) {
  const [count, setCount] = useState(0);
  const [hasSevere, setHasSevere] = useState(false);

  const loadAllergyCount = useCallback(async () => {
    try {
      const allergies = await getActiveAllergies(patientId);
      setCount(allergies.length);

      const severe = allergies.some(
        (a) => a.severity === "severe" || a.severity === "life-threatening",
      );
      setHasSevere(severe);
    } catch (error) {
      console.error(
        "Error loading allergy count:",
        error instanceof Error ? error.name : error,
      );
    }
  }, [patientId]);

  useEffect(() => {
    loadAllergyCount();
  }, [loadAllergyCount]);

  if (count === 0) return null;

  const colorClass = hasSevere ? "badge-critical" : "badge-danger";
  const label = `${count} allerg${count === 1 ? "y" : "ies"}${hasSevere ? ", including severe" : ""}`;

  if (compact) {
    return (
      <span className={`badge ${colorClass}`} title={label}>
        <ExclamationTriangleIcon className="h-3 w-3" aria-hidden />
        <span aria-hidden>{count}</span>
        <span className="sr-only">{label}</span>
      </span>
    );
  }

  return (
    <span className={`badge ${colorClass} px-3 py-1.5 text-label`}>
      <ExclamationTriangleIcon className="h-4 w-4" aria-hidden />
      <span>
        {count} Allerg{count === 1 ? "y" : "ies"}
        {hasSevere && " · severe"}
      </span>
    </span>
  );
}
