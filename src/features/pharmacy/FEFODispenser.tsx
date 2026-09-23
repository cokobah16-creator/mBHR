import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/hooks/useT";
import { db, StockBatch } from "@/db";
import { useAuthStore } from "@/stores/auth";
import { can } from "@/auth/roles";
import { getMessageService } from "@/services/messaging";
import * as logger from "@/lib/logger";
import { formatNigerianDate } from "@/utils/dateFormat";
import { StatusBadge, type Tone } from "@/components/ui/StatusBadge";
import {
  BeakerIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  MinusIcon,
  PlusIcon,
} from "@heroicons/react/24/outline";

interface DispenseAllocation {
  batchId: string;
  lotNumber: string;
  qty: number;
  expiryDate: Date;
}

interface FEFODispenserProps {
  patientId: string;
  visitId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

function getExpiryStatus(expiryDate: Date): { label: string; tone: Tone } {
  const now = new Date();
  const daysUntilExpiry = Math.ceil(
    // new Date() also copes with lots whose expiry was stored as a string.
    (new Date(expiryDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (daysUntilExpiry < 0) return { label: "Expired", tone: "danger" };
  if (daysUntilExpiry <= 30) {
    return { label: "Expires within 30 days", tone: "warning" };
  }
  if (daysUntilExpiry <= 90) {
    return { label: "Expires within 90 days", tone: "warning" };
  }
  return { label: "In date", tone: "success" };
}

export default function FEFODispenser({
  patientId,
  visitId,
  onSuccess,
  onCancel,
}: FEFODispenserProps) {
  const { t } = useT();
  const currentUser = useAuthStore((s) => s.currentUser);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [medications, setMedications] = useState<any[]>([]);
  const [batches, setBatches] = useState<StockBatch[]>([]);
  const [selectedMedication, setSelectedMedication] = useState("");
  const [requestedQty, setRequestedQty] = useState(1);
  const [dosage, setDosage] = useState("");
  const [directions, setDirections] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const loadMedications = useCallback(async () => {
    try {
      const items = await db.inventory.where("onHandQty").above(0).toArray();
      setMedications(items);
    } catch (error) {
      logger.error(
        "Error loading medications:",
        error instanceof Error ? error.name : error,
      );
      setErrorMessage(
        "Stock could not be read from this device. Reload and try again.",
      );
    }
  }, []);

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
    loadMedications();
  }, [loadMedications]);

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
      allocations.push({
        batchId: batch.id,
        lotNumber: batch.lotNumber,
        qty: allocateQty,
        expiryDate: batch.expiryDate,
      });

      remaining -= allocateQty;
    }

    return allocations;
  }, [selectedMedication, batches, requestedQty]);

  const canDispense = (): boolean => {
    return !!(
      selectedMedication &&
      requestedQty > 0 &&
      allocation.length > 0 &&
      allocation.reduce((sum, a) => sum + a.qty, 0) >= requestedQty &&
      dosage.trim() &&
      directions.trim()
    );
  };

  const handleDispense = async () => {
    if (!canDispense()) return;

    if (!currentUser || !can(currentUser.role, "dispense")) {
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
        id: crypto.randomUUID(),
        patientId,
        visitId,
        itemName: medication.itemName,
        qty: requestedQty,
        dosage,
        directions,
        dispensedBy: currentUser.fullName || "Pharmacist",
        dispensedAt: new Date(),
        _dirty: 1,
      };

      await db.dispenses.add(dispense);

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
      } catch (error) {
        logger.warn(
          "Failed to queue reminder:",
          error instanceof Error ? error.name : error,
        );
      }

      onSuccess?.();
    } catch (error) {
      logger.error(
        "Error dispensing medication:",
        error instanceof Error ? error.name : error,
      );
      setErrorMessage(
        t("error.dispenseFailed") || "Failed to dispense medication",
      );
    } finally {
      setLoading(false);
    }
  };

  const totalAvailable = allocation.reduce((sum, a) => sum + a.qty, 0);
  const isShortfall = totalAvailable < requestedQty;
  const selectedMed = medications.find((m) => m.id === selectedMedication);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <BeakerIcon className="h-6 w-6 text-ink-muted" aria-hidden />
        <div>
          <h2 className="text-h2 text-ink">Dispense medicine</h2>
          <p className="text-body text-ink-muted">
            Lots are chosen automatically, earliest expiry first.
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-body space-y-6">
          {/* Medication Selection */}
          <div>
            <label htmlFor="fefo-medication" className="field-label">
              Medication *
            </label>
            <select
              id="fefo-medication"
              value={selectedMedication}
              onChange={(e) => setSelectedMedication(e.target.value)}
              className="input-field"
            >
              <option value="">Select medication</option>
              {medications.map((med) => (
                <option key={med.id} value={med.id}>
                  {med.itemName} ({med.onHandQty} {med.unit} available)
                </option>
              ))}
            </select>
          </div>

          {/* Quantity Selection */}
          <div>
            <label htmlFor="fefo-qty" className="field-label">
              Quantity *
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
                id="fefo-qty"
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

              <ul className="divide-y divide-line rounded-md border border-line">
                {allocation.map((alloc, index) => {
                  const expiryStatus = getExpiryStatus(alloc.expiryDate);
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
                          {formatNigerianDate(alloc.expiryDate)}
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
              <label htmlFor="fefo-dosage" className="field-label">
                Dosage *
              </label>
              <input
                id="fefo-dosage"
                type="text"
                value={dosage}
                onChange={(e) => setDosage(e.target.value)}
                className="input-field"
                placeholder="e.g. 1 tablet, 5 ml"
              />
            </div>

            <div>
              <label htmlFor="fefo-directions" className="field-label">
                Directions *
              </label>
              <textarea
                id="fefo-directions"
                value={directions}
                onChange={(e) => setDirections(e.target.value)}
                className="input-field"
                rows={3}
                placeholder="Take twice daily with food"
              />
            </div>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="banner banner-danger" role="alert">
              <XCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row">
            {onCancel && (
              <button type="button" onClick={onCancel} className="btn-secondary">
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={handleDispense}
              disabled={!canDispense() || loading || isShortfall}
              className="btn-primary flex-1"
            >
              {loading
                ? "Dispensing…"
                : selectedMed
                  ? `Dispense ${requestedQty} × ${selectedMed.itemName}`
                  : "Dispense and queue reminder"}
            </button>
          </div>
          <p className="field-hint">
            An SMS reminder for tomorrow at 9:00 AM is queued on this device if
            the patient has a phone number. It is sent only when the device is
            online and SMS sending is set up.
          </p>
        </div>
      </div>
    </div>
  );
}
