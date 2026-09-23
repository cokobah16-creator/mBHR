import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/hooks/useT";
import { useAuthStore } from "@/stores/auth";
import { db, generateId, type StockBatch } from "@/db";
import { recordStageEvent } from "@/services/stageEvents";
import { getMessageService } from "@/services/messaging";
import { can } from "@/auth/roles";
import * as logger from "@/lib/logger";
import { getPatientAllergies } from "@/services/allergies";
import { formatNigerianDate } from "@/utils/dateFormat";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge, type Tone } from "@/components/ui/StatusBadge";
import {
  BeakerIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  XCircleIcon,
  ShieldExclamationIcon,
  InformationCircleIcon,
  LockClosedIcon,
  MinusIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";

interface DrugInteraction {
  drug1: string;
  drug2: string;
  severity: "minor" | "moderate" | "major";
  description: string;
  action: string;
}

interface DispenseAllocation {
  batchId: string;
  lotNumber: string;
  qty: number;
  expiryDate: string;
  daysUntilExpiry: number;
}

interface EnhancedPharmacyProps {
  patientId: string;
  visitId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

// Drug interaction database (simplified). Only these pairs are checked.
const INTERACTION_DATABASE: DrugInteraction[] = [
  {
    drug1: "Warfarin",
    drug2: "Aspirin",
    severity: "major",
    description: "Increased bleeding risk",
    action: "Monitor INR closely, consider alternative",
  },
  {
    drug1: "ACE Inhibitor",
    drug2: "Potassium",
    severity: "moderate",
    description: "Risk of hyperkalemia",
    action: "Monitor potassium levels",
  },
  {
    drug1: "NSAID",
    drug2: "ACE Inhibitor",
    severity: "moderate",
    description: "Reduced antihypertensive effect",
    action: "Monitor blood pressure",
  },
];

const INTERACTION_TONE: Record<DrugInteraction["severity"], Tone> = {
  major: "danger",
  moderate: "warning",
  minor: "info",
};

function getExpiryStatus(daysUntilExpiry: number): { label: string; tone: Tone } {
  if (daysUntilExpiry < 0) return { label: "Expired", tone: "danger" };
  if (daysUntilExpiry <= 30) {
    return { label: "Expires within 30 days", tone: "warning" };
  }
  if (daysUntilExpiry <= 90) {
    return { label: "Expires within 90 days", tone: "warning" };
  }
  return { label: "In date", tone: "success" };
}

type ReminderState = "queued" | "failed" | null;

export default function EnhancedPharmacy({
  patientId,
  visitId,
  onSuccess,
  onCancel,
}: EnhancedPharmacyProps) {
  const { t } = useT();
  const { currentUser } = useAuthStore();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [medications, setMedications] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [batches, setBatches] = useState<any[]>([]);
  const [selectedMedication, setSelectedMedication] = useState("");
  const [requestedQty, setRequestedQty] = useState(1);
  const [dosage, setDosage] = useState("");
  const [directions, setDirections] = useState("");
  const [patientAllergies, setPatientAllergies] = useState<string[]>([]);
  const [currentMedications, setCurrentMedications] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCounseling, setShowCounseling] = useState(false);
  const [reminderState, setReminderState] = useState<ReminderState>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const loadData = useCallback(async () => {
    try {
      const [medicationsData, , recentDispenses] = await Promise.all([
        db.inventory.where("onHandQty").above(0).toArray(),
        db.patients.get(patientId),
        db.dispenses
          .where("patientId")
          .equals(patientId)
          .reverse()
          .limit(10)
          .toArray(),
      ]);

      setMedications(medicationsData);

      // Extract current medications from recent dispenses (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const recentMeds = recentDispenses
        .filter((d) => d.dispensedAt > thirtyDaysAgo)
        .map((d) => d.itemName);

      setCurrentMedications([...new Set(recentMeds)]);

      // Load patient allergies
      const allergies = await getPatientAllergies(patientId);
      const allergyNames = allergies
        .filter((a) => a.isActive)
        .map((a) => a.allergen);
      setPatientAllergies(allergyNames);
    } catch (error) {
      logger.error(
        "Error loading pharmacy data:",
        error instanceof Error ? error.name : error,
      );
      setErrorMessage(
        "Stock or patient details could not be read from this device. Reload and try again.",
      );
    }
  }, [patientId]);

  const loadBatchesForMedication = useCallback(
    async (medicationId: string): Promise<StockBatch[]> => {
      try {
        return await db.stockBatches
          .where("drugId")
          .equals(medicationId)
          .and((batch) => batch.qtyOnHand > 0)
          .toArray();
      } catch (error) {
        logger.error(
          "Error loading batches:",
          error instanceof Error ? error.name : error,
        );
        return [];
      }
    },
    [],
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    // Never allocate against the previous medicine's lots while the new
    // medicine's lots are loading, and ignore a slower load for a medicine
    // that is no longer selected.
    let cancelled = false;
    setBatches([]);
    if (selectedMedication) {
      loadBatchesForMedication(selectedMedication).then((loaded) => {
        if (!cancelled) setBatches(loaded);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [selectedMedication, loadBatchesForMedication]);

  const interactions = useMemo<DrugInteraction[]>(() => {
    if (!selectedMedication) return [];
    const selectedMed = medications.find((m) => m.id === selectedMedication);
    if (!selectedMed) return [];

    return INTERACTION_DATABASE.filter((interaction) => {
      const medName = selectedMed.itemName.toLowerCase();
      return currentMedications.some((currentMed) => {
        const currentName = currentMed.toLowerCase();
        return (
          (interaction.drug1.toLowerCase().includes(medName.split(" ")[0]) &&
            interaction.drug2
              .toLowerCase()
              .includes(currentName.split(" ")[0])) ||
          (interaction.drug2.toLowerCase().includes(medName.split(" ")[0]) &&
            interaction.drug1.toLowerCase().includes(currentName.split(" ")[0]))
        );
      });
    });
  }, [selectedMedication, medications, currentMedications]);

  const allocation = useMemo<DispenseAllocation[]>(() => {
    if (!selectedMedication || !batches.length || requestedQty <= 0) {
      return [];
    }

    // Sort by expiry date (First Expired, First Out)
    const sortedBatches = [...batches].sort(
      (a, b) =>
        new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime(),
    );

    const allocations: DispenseAllocation[] = [];
    let remaining = requestedQty;

    for (const batch of sortedBatches) {
      if (remaining <= 0) break;

      const allocateQty = Math.min(batch.qtyOnHand, remaining);
      const daysUntilExpiry = Math.ceil(
        (new Date(batch.expiryDate).getTime() - new Date().getTime()) /
          (1000 * 60 * 60 * 24),
      );

      allocations.push({
        batchId: batch.id,
        lotNumber: batch.lotNumber,
        qty: allocateQty,
        expiryDate: batch.expiryDate,
        daysUntilExpiry,
      });

      remaining -= allocateQty;
    }

    return allocations;
  }, [selectedMedication, batches, requestedQty]);

  // Only pharmacists and admins can access
  if (!currentUser || !can(currentUser.role, "dispense")) {
    return (
      <div className="panel">
        <EmptyState
          icon={LockClosedIcon}
          title="Dispensing is restricted"
          description="Only pharmacists and administrators can dispense medicines."
        />
      </div>
    );
  }

  const selectedMed = medications.find((m) => m.id === selectedMedication);
  const totalAvailable = allocation.reduce((sum, a) => sum + a.qty, 0);
  const isShortfall = totalAvailable < requestedQty;
  const hasExpiredBatches = allocation.some((a) => a.daysUntilExpiry < 0);
  const hasMajorInteractions = interactions.some((i) => i.severity === "major");

  const canDispense = () => {
    return (
      selectedMedication &&
      requestedQty > 0 &&
      allocation.length > 0 &&
      allocation.reduce((sum, a) => sum + a.qty, 0) >= requestedQty &&
      dosage.trim() &&
      directions.trim() &&
      !hasExpiredBatches &&
      !hasMajorInteractions
    );
  };

  const blockers: string[] = [];
  if (!selectedMedication) blockers.push("choose a medicine");
  else if (allocation.length === 0) blockers.push("no in-stock lots found");
  else if (isShortfall) blockers.push("not enough stock");
  if (hasExpiredBatches) blockers.push("an expired lot would be used");
  if (hasMajorInteractions) blockers.push("a major interaction is flagged");
  if (!dosage.trim()) blockers.push("enter the dose");
  if (!directions.trim()) blockers.push("enter directions");

  const handleDispense = async () => {
    if (!canDispense()) return;

    // Permission is re-checked at the point of writing, not only on render.
    if (!can(currentUser.role, "dispense")) {
      setErrorMessage("Only pharmacists and administrators can dispense.");
      return;
    }

    setLoading(true);
    setErrorMessage("");
    try {
      const medication = medications.find((m) => m.id === selectedMedication);
      if (!medication) throw new Error("Medication not found");

      // Create dispense record
      const dispense = {
        id: generateId(),
        patientId,
        visitId,
        itemName: medication.itemName,
        qty: requestedQty,
        dosage,
        directions,
        dispensedBy: currentUser?.fullName || "Unknown",
        dispensedAt: new Date(),
        _dirty: 1,
      };

      await db.dispenses.add(dispense);

      await recordStageEvent({
        stage: "pharmacy",
        kind: "finish",
        visitId,
        patientId,
        actorId: currentUser?.id,
      });

      // Update batch quantities
      for (const alloc of allocation) {
        const batch = batches.find((b) => b.id === alloc.batchId);
        if (batch) {
          await db.stockBatches.update(alloc.batchId, {
            qtyOnHand: batch.qtyOnHand - alloc.qty,
          });
        }
      }

      // Update total inventory
      await db.inventory.update(selectedMedication, {
        onHandQty: medication.onHandQty - requestedQty,
        updatedAt: new Date(),
      });

      // Queue medication reminder for tomorrow
      try {
        const messageService = getMessageService();
        const reminderDate = new Date();
        reminderDate.setDate(reminderDate.getDate() + 1);
        reminderDate.setHours(9, 0, 0, 0); // 9 AM tomorrow

        await messageService.queueMedicationReminder(
          patientId,
          medication.itemName,
          dosage,
          directions,
          reminderDate,
        );
        setReminderState("queued");
      } catch (error) {
        logger.warn(
          "Failed to queue reminder:",
          error instanceof Error ? error.name : error,
        );
        setReminderState("failed");
      }

      setShowCounseling(true);
    } catch (error) {
      logger.error(
        "Error dispensing medication:",
        error instanceof Error ? error.name : error,
      );
      setErrorMessage(t("error.dispenseFailed"));
    } finally {
      setLoading(false);
    }
  };

  const completeCounseling = () => {
    setShowCounseling(false);
    onSuccess?.();
  };

  if (showCounseling) {
    return (
      <section className="panel mx-auto max-w-2xl" aria-labelledby="counsel-title">
        <div className="panel-header">
          <div>
            <h2 id="counsel-title" className="panel-title">
              Patient counselling
            </h2>
            <p className="text-caption text-ink-muted">
              Go through the instructions with the patient before they leave.
            </p>
          </div>
        </div>

        <div className="panel-body space-y-5">
          <div className="banner banner-success" role="status">
            <CheckCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">Dispensed and saved on this device</p>
              <p>
                <strong>{selectedMed?.itemName}</strong> × {requestedQty}
              </p>
              <p>
                <strong>Dose:</strong> {dosage}
              </p>
              <p>
                <strong>Directions:</strong> {directions}
              </p>
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="section-label mb-2">Counselling checklist</legend>
            {[
              "Explained how to take the medication",
              "Reviewed dosage and timing",
              "Discussed potential side effects",
              "Confirmed patient understanding",
              "Provided written instructions",
              "Scheduled follow-up reminder",
            ].map((item, index) => (
              <label
                key={index}
                className="flex min-h-touch-target items-center gap-3 text-body text-ink"
              >
                <input
                  type="checkbox"
                  className="h-5 w-5 rounded border-line-strong text-primary focus:ring-primary"
                />
                <span>{item}</span>
              </label>
            ))}
          </fieldset>

          {reminderState === "queued" && (
            <div className="banner banner-info" role="status">
              <InformationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
              <span>
                SMS reminder queued on this device for tomorrow at 9:00 AM. It
                is sent only when the device is online and SMS sending is set
                up.
              </span>
            </div>
          )}
          {reminderState === "failed" && (
            <div className="banner banner-warning" role="status">
              <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
              <span>
                No SMS reminder was set up (the patient may have no phone
                number on record). Remind the patient in person.
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={completeCounseling}
            className="btn-primary w-full"
          >
            Finish counselling
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <BeakerIcon className="h-6 w-6 text-ink-muted" aria-hidden />
        <div>
          <h2 className="text-h2 text-ink">Dispense medicine</h2>
          <p className="text-body text-ink-muted">
            Lots are used in order of expiry (first expired, first out).
          </p>
        </div>
      </div>

      {/* Patient Allergies Warning */}
      {patientAllergies.length > 0 && (
        <div className="banner banner-danger" role="alert">
          <ShieldExclamationIcon className="h-5 w-5 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">
              Allergies recorded ({patientAllergies.length})
            </p>
            <ul className="mt-1 flex flex-wrap gap-2">
              {patientAllergies.map((allergy, index) => (
                <li key={index}>
                  <StatusBadge tone="danger">{allergy}</StatusBadge>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-caption">
              Check the medicine against these allergies before dispensing.
            </p>
          </div>
        </div>
      )}

      {/* Current Medications */}
      {currentMedications.length > 0 && (
        <div className="banner banner-info">
          <InformationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">Dispensed in the last 30 days</p>
            <ul className="mt-1 flex flex-wrap gap-2">
              {currentMedications.map((med, index) => (
                <li key={index} className="badge badge-neutral">
                  {med}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Drug Interactions Alert */}
      {interactions.length > 0 && (
        <section
          className="space-y-2"
          aria-labelledby="ep-interactions-title"
          role="alert"
        >
          <h3 id="ep-interactions-title" className="sr-only">
            Interactions to check
          </h3>
          {interactions.map((interaction, index) => (
            <div
              key={index}
              className={`banner ${
                interaction.severity === "major"
                  ? "banner-danger"
                  : interaction.severity === "moderate"
                    ? "banner-warning"
                    : "banner-info"
              }`}
            >
              <ShieldExclamationIcon className="h-5 w-5 shrink-0" aria-hidden />
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">
                    {interaction.drug1} and {interaction.drug2}
                  </span>
                  <StatusBadge tone={INTERACTION_TONE[interaction.severity]} icon>
                    {interaction.severity} interaction
                  </StatusBadge>
                </div>
                <p>{interaction.description}</p>
                <p className="font-medium">Action: {interaction.action}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      <div className="panel">
        <div className="panel-body space-y-6">
          {/* Medication Selection */}
          <div>
            <label htmlFor="ep-medication" className="field-label">
              {t("pharmacy.medication")} *
            </label>
            <select
              id="ep-medication"
              value={selectedMedication}
              onChange={(e) => setSelectedMedication(e.target.value)}
              className="input-field"
            >
              <option value="">{t("simple.selectMedication")}</option>
              {medications.map((med) => (
                <option key={med.id} value={med.id}>
                  {med.itemName} ({med.onHandQty} {med.unit}{" "}
                  {t("common.available")})
                </option>
              ))}
            </select>
            <p className="field-hint">
              Interaction check covers only a few common pairs (warfarin and
              aspirin, ACE inhibitor and potassium, NSAID and ACE inhibitor)
              against medicines dispensed to this patient in the last 30 days.
              It is not a complete interaction check.
            </p>
          </div>

          {/* Quantity Selection */}
          <div>
            <label htmlFor="ep-qty" className="field-label">
              {t("pharmacy.quantity")} *
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setRequestedQty(Math.max(1, requestedQty - 1))}
                disabled={requestedQty <= 1}
                className="btn-secondary px-3"
                aria-label="Decrease quantity"
              >
                <MinusIcon className="h-5 w-5" aria-hidden />
              </button>

              <input
                id="ep-qty"
                type="number"
                inputMode="numeric"
                value={requestedQty}
                onChange={(e) =>
                  setRequestedQty(Math.max(1, parseInt(e.target.value) || 1))
                }
                min="1"
                className="input-field w-24 text-center text-h2 tabular-nums"
              />

              <button
                type="button"
                onClick={() => setRequestedQty(requestedQty + 1)}
                className="btn-secondary px-3"
                aria-label="Increase quantity"
              >
                <PlusIcon className="h-5 w-5" aria-hidden />
              </button>
            </div>
            {requestedQty <= 10 && (
              <div className="mt-2 flex gap-1" aria-hidden>
                {Array.from({ length: requestedQty }, (_, i) => (
                  <div key={i} className="h-3 w-3 rounded-full bg-primary" />
                ))}
              </div>
            )}
          </div>

          {/* FEFO Allocation Display */}
          {allocation.length > 0 && (
            <div className="space-y-3">
              <h3 className="section-label">Lots to use (earliest expiry first)</h3>

              {isShortfall && (
                <div className="banner banner-danger" role="alert">
                  <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
                  <span>
                    Not enough stock: {totalAvailable} available, {requestedQty}{" "}
                    requested.
                  </span>
                </div>
              )}

              {hasExpiredBatches && (
                <div className="banner banner-danger" role="alert">
                  <XCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
                  <span>
                    Cannot dispense: an expired lot would be used. Set expired
                    stock aside and update the lot quantities.
                  </span>
                </div>
              )}

              <ul className="divide-y divide-line rounded-md border border-line">
                {allocation.map((alloc, index) => {
                  const expiryStatus = getExpiryStatus(alloc.daysUntilExpiry);
                  return (
                    <li
                      key={alloc.batchId}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                    >
                      <div>
                        <div className="font-medium text-ink">
                          Lot {index + 1}: {alloc.lotNumber}
                        </div>
                        <div className="text-caption tabular-nums text-ink-muted">
                          Take {alloc.qty} · expires{" "}
                          {formatNigerianDate(alloc.expiryDate)} (
                          {alloc.daysUntilExpiry} days)
                        </div>
                      </div>
                      <StatusBadge tone={expiryStatus.tone} icon>
                        {expiryStatus.label}
                      </StatusBadge>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Dosage and Directions */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="ep-dosage" className="field-label">
                {t("pharmacy.dosage")} *
              </label>
              <input
                id="ep-dosage"
                type="text"
                value={dosage}
                onChange={(e) => setDosage(e.target.value)}
                className="input-field"
                placeholder={t("simple.dosageExample")}
              />
            </div>

            <div>
              <label htmlFor="ep-directions" className="field-label">
                {t("pharmacy.directions")} *
              </label>
              <textarea
                id="ep-directions"
                value={directions}
                onChange={(e) => setDirections(e.target.value)}
                className="input-field"
                rows={3}
                placeholder={t("simple.directionsExample")}
              />
            </div>
          </div>

          {/* Safety Warnings */}
          {(hasExpiredBatches || hasMajorInteractions) && (
            <div className="banner banner-danger">
              <ShieldExclamationIcon className="h-5 w-5 shrink-0" aria-hidden />
              <div>
                <p className="font-semibold">Dispensing is blocked</p>
                <ul className="mt-1 list-disc pl-5">
                  {hasExpiredBatches && <li>Expired medicine cannot be dispensed.</li>}
                  {hasMajorInteractions && (
                    <li>A major drug interaction is flagged. Check with the prescriber.</li>
                  )}
                </ul>
              </div>
            </div>
          )}

          {/* Error Message */}
          {errorMessage && (
            <div className="banner banner-danger" role="alert">
              <XCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-2 border-t border-line pt-4">
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              {onCancel && (
                <button type="button" onClick={onCancel} className="btn-secondary">
                  {t("action.cancel")}
                </button>
              )}
              <button
                type="button"
                onClick={handleDispense}
                disabled={!canDispense() || loading}
                className="btn-primary flex-1"
                aria-describedby={blockers.length > 0 ? "ep-blockers" : undefined}
              >
                {loading
                  ? t("pharmacy.dispensing")
                  : selectedMed
                    ? `Dispense ${requestedQty} × ${selectedMed.itemName}`
                    : "Dispense and counsel"}
              </button>
            </div>
            {blockers.length > 0 && !loading && (
              <p id="ep-blockers" className="field-hint">
                To dispense: {blockers.join(", ")}.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
