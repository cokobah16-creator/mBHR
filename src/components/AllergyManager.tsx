import { useState, useEffect, useCallback, useId } from "react";
import { formatNigerianDate } from "@/utils/dateFormat";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  createAllergy,
  updateAllergy,
  deactivateAllergy,
  reactivateAllergy,
  getPatientAllergies,
  type CreateAllergyInput,
  type UpdateAllergyInput,
} from "../services/allergies";
import { generateId, type PatientAllergy } from "../db";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { can, type Role } from "@/auth/roles";
import { StatusBadge, type Tone } from "@/components/ui/StatusBadge";
import { SkeletonText } from "@/components/ui/Skeleton";
import {
  ExclamationTriangleIcon,
  XMarkIcon,
  PencilIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";

const allergySchema = z.object({
  allergen: z.string().min(1, "Allergen name is required"),
  allergyType: z.enum(["medication", "food", "environmental", "other"]),
  reaction: z.string().optional(),
  severity: z.enum(["mild", "moderate", "severe", "life-threatening"]),
  onsetDate: z.string().optional(),
  notes: z.string().optional(),
});

type AllergyFormData = z.infer<typeof allergySchema>;

interface AllergyManagerProps {
  patientId: string;
  userId: string;
  showInactive?: boolean;
}

// Every recorded allergy is a danger-level fact; life-threatening ones are
// critical. The severity word is always shown next to the colour.
const SEVERITY_TONE: Record<PatientAllergy["severity"], Tone> = {
  "life-threatening": "critical",
  severe: "danger",
  moderate: "danger",
  mild: "danger",
};

const SEVERITY_LABEL: Record<PatientAllergy["severity"], string> = {
  "life-threatening": "Life-threatening",
  severe: "Severe",
  moderate: "Moderate",
  mild: "Mild",
};

/** Staff who see patients at a station can record allergies. */
function canEditAllergies(role: Role | undefined): boolean {
  return (
    !!role &&
    (can(role, "register") ||
      can(role, "vitals") ||
      can(role, "consult") ||
      can(role, "dispense"))
  );
}

export function AllergyManager({
  patientId,
  userId,
  showInactive = false,
}: AllergyManagerProps) {
  const role = useAuthStore((s) => s.currentUser?.role);
  const { push: pushToast } = useToast();
  const idPrefix = useId();
  const [allergies, setAllergies] = useState<PatientAllergy[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);

  const canEdit = canEditAllergies(role);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AllergyFormData>({
    resolver: zodResolver(allergySchema),
  });

  const loadAllergies = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const data = await getPatientAllergies(patientId, !showInactive);
      setAllergies(data);
    } catch (error) {
      console.error(
        "Error loading allergies:",
        error instanceof Error ? error.name : error,
      );
      setLoadError(
        "Allergies could not be read from this device. Reload the page before prescribing or dispensing.",
      );
    } finally {
      setLoading(false);
    }
  }, [patientId, showInactive]);

  useEffect(() => {
    loadAllergies();
  }, [loadAllergies]);

  const denyWrite = () => {
    setActionError("Your role cannot change this patient's allergies.");
  };

  const onSubmit = async (data: AllergyFormData) => {
    setActionError("");
    if (!canEditAllergies(role)) {
      denyWrite();
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        const updates: UpdateAllergyInput = {
          allergen: data.allergen,
          allergyType: data.allergyType,
          reaction: data.reaction,
          severity: data.severity,
          onsetDate: data.onsetDate ? new Date(data.onsetDate) : undefined,
          notes: data.notes,
        };
        await updateAllergy(editingId, updates);
        setEditingId(null);
      } else {
        const input: CreateAllergyInput = {
          patientId,
          allergen: data.allergen,
          allergyType: data.allergyType,
          reaction: data.reaction,
          severity: data.severity,
          onsetDate: data.onsetDate ? new Date(data.onsetDate) : undefined,
          notes: data.notes,
          createdBy: userId,
        };
        await createAllergy(input);
      }
      setIsAdding(false);
      pushToast({
        id: generateId(),
        tone: "success",
        title: editingId ? "Allergy updated" : "Allergy recorded",
        body: `${data.allergen} saved on this device.`,
      });
      reset();
      loadAllergies();
    } catch (error) {
      console.error(
        "Error saving allergy:",
        error instanceof Error ? error.name : error,
      );
      setActionError("The allergy was not saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (allergyId: string) => {
    setActionError("");
    if (!canEditAllergies(role)) {
      denyWrite();
      setConfirmDeactivateId(null);
      return;
    }
    try {
      await deactivateAllergy(allergyId);
      setConfirmDeactivateId(null);
      loadAllergies();
    } catch (error) {
      console.error(
        "Error deactivating allergy:",
        error instanceof Error ? error.name : error,
      );
      setActionError("The allergy is still active — the change was not saved. Try again.");
    }
  };

  const handleReactivate = async (allergyId: string) => {
    setActionError("");
    if (!canEditAllergies(role)) {
      denyWrite();
      return;
    }
    try {
      await reactivateAllergy(allergyId);
      loadAllergies();
    } catch (error) {
      console.error(
        "Error reactivating allergy:",
        error instanceof Error ? error.name : error,
      );
      setActionError("The allergy was not reactivated. Try again.");
    }
  };

  const handleEdit = (allergy: PatientAllergy) => {
    setActionError("");
    setEditingId(allergy.id);
    setIsAdding(true);
    reset({
      allergen: allergy.allergen,
      allergyType: allergy.allergyType,
      reaction: allergy.reaction || undefined,
      severity: allergy.severity,
      onsetDate: allergy.onsetDate
        ? new Date(allergy.onsetDate).toISOString().split("T")[0]
        : undefined,
      notes: allergy.notes || undefined,
    });
  };

  const handleCancel = () => {
    setIsAdding(false);
    setEditingId(null);
    setActionError("");
    reset();
  };

  const fieldId = (name: string) => `${idPrefix}-${name}`;

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <span role="status" className="sr-only">
          Loading allergies
        </span>
        <SkeletonText lines={3} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-h3 text-ink">
          <ExclamationTriangleIcon className="h-5 w-5 text-danger" aria-hidden />
          Allergies
          {allergies.some((a) => a.isActive) && (
            <span className="text-caption font-normal text-ink-muted">
              ({allergies.filter((a) => a.isActive).length} active)
            </span>
          )}
        </h3>
        {!isAdding && canEdit && (
          <button
            type="button"
            onClick={() => {
              setActionError("");
              setIsAdding(true);
            }}
            className="btn-secondary px-3"
          >
            <PlusIcon className="h-4 w-4" aria-hidden />
            Add allergy
          </button>
        )}
      </div>

      {loadError && (
        <div className="banner banner-danger" role="alert">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
          <span>{loadError}</span>
        </div>
      )}

      {actionError && (
        <div className="banner banner-danger" role="alert">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
          <span>{actionError}</span>
        </div>
      )}

      {isAdding && (
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-3 rounded-md border border-line bg-surface-sunken p-4"
          noValidate
          aria-label={editingId ? "Edit allergy" : "Add allergy"}
        >
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label htmlFor={fieldId("allergen")} className="field-label">
                Allergen *
              </label>
              <input
                id={fieldId("allergen")}
                {...register("allergen")}
                className="input-field"
                placeholder="e.g. Penicillin"
                aria-invalid={errors.allergen ? "true" : "false"}
                aria-describedby={
                  errors.allergen ? fieldId("allergen-error") : undefined
                }
              />
              {errors.allergen && (
                <p id={fieldId("allergen-error")} className="field-error" role="alert">
                  {errors.allergen.message}
                </p>
              )}
            </div>

            <div>
              <label htmlFor={fieldId("type")} className="field-label">
                Type *
              </label>
              <select
                id={fieldId("type")}
                {...register("allergyType")}
                className="input-field"
              >
                <option value="medication">Medication</option>
                <option value="food">Food</option>
                <option value="environmental">Environmental</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label htmlFor={fieldId("severity")} className="field-label">
                Severity *
              </label>
              <select
                id={fieldId("severity")}
                {...register("severity")}
                className="input-field"
              >
                <option value="mild">Mild</option>
                <option value="moderate">Moderate</option>
                <option value="severe">Severe</option>
                <option value="life-threatening">Life-threatening</option>
              </select>
            </div>

            <div>
              <label htmlFor={fieldId("onset")} className="field-label">
                Onset date
              </label>
              <input
                id={fieldId("onset")}
                type="date"
                {...register("onsetDate")}
                className="input-field"
              />
            </div>
          </div>

          <div>
            <label htmlFor={fieldId("reaction")} className="field-label">
              Reaction
            </label>
            <input
              id={fieldId("reaction")}
              {...register("reaction")}
              className="input-field"
              placeholder="e.g. Rash, swelling, difficulty breathing"
            />
          </div>

          <div>
            <label htmlFor={fieldId("notes")} className="field-label">
              Notes
            </label>
            <textarea
              id={fieldId("notes")}
              {...register("notes")}
              rows={2}
              className="input-field"
            />
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? "Saving…" : editingId ? "Update allergy" : "Add allergy"}
            </button>
          </div>
        </form>
      )}

      {allergies.length === 0 ? (
        !loadError && (
          <div className="rounded-md border border-dashed border-line-strong px-4 py-6 text-center">
            <p className="text-body font-medium text-ink">
              No allergies recorded
            </p>
            <p className="mt-1 text-caption text-ink-muted">
              This does not mean the patient has none — ask before prescribing
              or dispensing.
            </p>
          </div>
        )
      ) : (
        <ul className="space-y-2">
          {allergies.map((allergy) => {
            const active = Boolean(allergy.isActive);
            return (
              <li
                key={allergy.id}
                className={`rounded-md border p-3 ${
                  active
                    ? "border-danger-line bg-danger-soft"
                    : "border-line bg-surface-sunken text-ink-muted"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4
                        className={`text-h3 ${active ? "text-danger-fg" : "text-ink-muted line-through"}`}
                      >
                        {allergy.allergen}
                      </h4>
                      {active ? (
                        <StatusBadge tone={SEVERITY_TONE[allergy.severity]} icon>
                          {SEVERITY_LABEL[allergy.severity] ?? allergy.severity}
                        </StatusBadge>
                      ) : (
                        <span className="badge badge-neutral">
                          {SEVERITY_LABEL[allergy.severity] ?? allergy.severity}
                        </span>
                      )}
                      <span className="badge badge-neutral capitalize">
                        {allergy.allergyType}
                      </span>
                      {!active && (
                        <StatusBadge tone="neutral" icon>
                          Inactive
                        </StatusBadge>
                      )}
                    </div>
                    {allergy.reaction && (
                      <p className="mt-1 text-body text-ink-secondary">
                        Reaction: {allergy.reaction}
                      </p>
                    )}
                    {allergy.onsetDate && (
                      <p className="mt-1 text-caption text-ink-muted">
                        Onset: {formatNigerianDate(allergy.onsetDate)}
                      </p>
                    )}
                    {allergy.notes && (
                      <p className="mt-1 text-body italic text-ink-secondary">
                        {allergy.notes}
                      </p>
                    )}

                    {confirmDeactivateId === allergy.id && (
                      <div
                        className="mt-3 rounded-md border border-line bg-surface p-3"
                        role="alertdialog"
                        aria-labelledby={fieldId(`deact-${allergy.id}`)}
                      >
                        <p
                          id={fieldId(`deact-${allergy.id}`)}
                          className="text-body text-ink"
                        >
                          Mark the {allergy.allergen} allergy as inactive? It
                          will no longer be shown in allergy warnings.
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            autoFocus
                            onClick={() => setConfirmDeactivateId(null)}
                            className="btn-secondary px-3"
                          >
                            Keep active
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeactivate(allergy.id)}
                            className="btn-danger px-3"
                          >
                            Mark inactive
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 gap-1">
                      {active && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleEdit(allergy)}
                            className="btn-ghost px-2"
                            aria-label={`Edit ${allergy.allergen} allergy`}
                            title="Edit"
                          >
                            <PencilIcon className="h-5 w-5" aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeactivateId(allergy.id)}
                            className="btn-ghost px-2"
                            aria-label={`Mark ${allergy.allergen} allergy inactive`}
                            title="Mark inactive"
                          >
                            <XMarkIcon className="h-5 w-5" aria-hidden />
                          </button>
                        </>
                      )}
                      {!active && (
                        <button
                          type="button"
                          onClick={() => handleReactivate(allergy.id)}
                          className="btn-secondary px-3"
                        >
                          Reactivate
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
