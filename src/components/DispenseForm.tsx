import { useState, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLiveQuery } from "dexie-react-hooks";
import { formatNigerianDate } from "@/utils/dateFormat";
import { db, generateId, createAuditLog, InventoryItem } from "@/db";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { recordStageEvent } from "@/services/stageEvents";
import { matchMedicationToAllergen } from "@/utils/allergyMatch";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ExclamationTriangleIcon } from "@heroicons/react/20/solid";

const dispenseSchema = z.object({
  itemName: z.string().min(1, "Choose a medicine from stock"),
  qty: z
    .number({ invalid_type_error: "Enter a quantity" })
    .min(1, "Quantity must be at least 1"),
  dosage: z.string().min(1, "Enter the dose, e.g. 500 mg or 1 tablet"),
  directions: z.string().min(1, "Enter how and when to take it"),
});

type DispenseFormData = z.infer<typeof dispenseSchema>;

interface DispenseFormProps {
  patientId: string;
  visitId: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

class StockError extends Error {}

export function DispenseForm({
  patientId,
  visitId,
  onSuccess,
  onCancel,
}: DispenseFormProps) {
  const { currentUser } = useAuthStore();
  const { push: pushToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [formError, setFormError] = useState("");
  const [allergyAcknowledged, setAllergyAcknowledged] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<DispenseFormData>({
    resolver: zodResolver(dispenseSchema),
  });

  const watchedItemName = watch("itemName");
  const watchedQty = watch("qty");

  const medicationAllergies = useLiveQuery(
    () =>
      db.patientAllergies
        .where("patientId")
        .equals(patientId)
        .filter((a) => a.isActive === 1 && a.allergyType === "medication")
        .toArray(),
    [patientId],
    [],
  );

  useEffect(() => {
    db.inventory
      .orderBy("itemName")
      .toArray()
      .then(setInventory)
      .catch((error) => {
        console.error("Error loading inventory:", error);
        setFormError("Could not load stock on this device. Reload the page and try again.");
      });
  }, []);

  const selectedItem = useMemo(
    () => inventory.find((i) => i.itemName === watchedItemName) ?? null,
    [inventory, watchedItemName],
  );

  const conflicts = useMemo(() => {
    if (!watchedItemName) return [];
    return (medicationAllergies ?? [])
      .map((a) => ({ allergy: a, match: matchMedicationToAllergen(watchedItemName, a.allergen) }))
      .filter((c) => c.match !== null);
  }, [watchedItemName, medicationAllergies]);

  // A new medicine needs a fresh acknowledgement.
  useEffect(() => setAllergyAcknowledged(false), [watchedItemName]);

  const qty = Number.isFinite(watchedQty) ? watchedQty : 0;
  const remaining = selectedItem ? selectedItem.onHandQty - qty : null;
  const insufficient = selectedItem !== null && qty > selectedItem.onHandQty;
  const belowReorder =
    selectedItem !== null && remaining !== null && remaining >= 0 && remaining <= selectedItem.reorderThreshold;
  const blockedByAllergy = conflicts.length > 0 && !allergyAcknowledged;

  const onSubmit = async (data: DispenseFormData) => {
    setFormError("");
    if (!selectedItem) {
      setFormError("Choose a medicine from the stock list.");
      return;
    }
    if (blockedByAllergy) {
      setFormError("Confirm the allergy check before dispensing.");
      return;
    }

    setLoading(true);
    try {
      const dispense = {
        id: generateId(),
        patientId,
        visitId,
        itemName: data.itemName,
        qty: data.qty,
        dosage: data.dosage,
        directions: data.directions,
        dispensedBy: currentUser?.fullName || "Unknown",
        dispensedAt: new Date(),
        _dirty: 1,
      };

      // Record and stock decrement succeed or fail together, and stock is
      // re-read inside the transaction so a stale page cannot overdraw it.
      await db.transaction("rw", db.dispenses, db.inventory, async () => {
        const fresh = await db.inventory.get(selectedItem.id);
        if (!fresh || fresh.onHandQty < data.qty) {
          throw new StockError(
            `Only ${fresh?.onHandQty ?? 0} ${selectedItem.unit} of ${selectedItem.itemName} left in stock.`,
          );
        }
        await db.dispenses.add(dispense);
        await db.inventory.update(selectedItem.id, {
          onHandQty: fresh.onHandQty - data.qty,
          updatedAt: new Date(),
          _dirty: 1,
        });
      });

      await createAuditLog(
        currentUser?.role || "unknown",
        conflicts.length > 0 ? "dispense_allergy_override" : "dispense",
        "medication",
        dispense.id,
      );

      await recordStageEvent({
        stage: "pharmacy",
        kind: "finish",
        visitId,
        patientId,
        actorId: currentUser?.id,
      });

      pushToast({
        id: generateId(),
        title: "Medicine dispensed",
        tone: "success",
        body: `${data.qty} × ${data.itemName} recorded.`,
      });
      onSuccess?.();
    } catch (error) {
      console.error("Error dispensing medication:", error);
      setFormError(
        error instanceof StockError
          ? error.message
          : "Nothing was dispensed — the record could not be saved. Try again.",
      );
      // Refresh stock so the list reflects what is really left.
      db.inventory.orderBy("itemName").toArray().then(setInventory).catch(() => undefined);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h2 className="panel-title">Dispense medicine</h2>
        <span className="text-caption text-ink-muted">
          {currentUser?.fullName || "Unknown"} · {formatNigerianDate(new Date())}
        </span>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="panel-body space-y-5" noValidate>
        {formError && (
          <div className="banner banner-danger" role="alert">
            <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
            <span>{formError}</span>
          </div>
        )}

        <div>
          <label htmlFor="dispense-item" className="field-label">
            Medicine
          </label>
          <select
            id="dispense-item"
            {...register("itemName")}
            className="input-field"
            aria-invalid={errors.itemName ? true : undefined}
            aria-describedby={errors.itemName ? "dispense-item-error" : undefined}
          >
            <option value="">Choose from stock</option>
            {inventory.map((item) => (
              <option key={item.id} value={item.itemName} disabled={item.onHandQty <= 0}>
                {item.itemName} — {item.onHandQty} {item.unit} in stock
              </option>
            ))}
          </select>
          {errors.itemName && (
            <p id="dispense-item-error" className="field-error" role="alert">
              {errors.itemName.message}
            </p>
          )}
        </div>

        {conflicts.length > 0 && (
          <div className="rounded-md border border-danger-line bg-danger-soft p-4" role="alert">
            <p className="flex items-center gap-2 text-h3 text-danger-fg">
              <ExclamationTriangleIcon className="h-5 w-5" aria-hidden />
              Possible allergy
            </p>
            <ul className="mt-2 space-y-1 text-body text-danger-fg">
              {conflicts.map(({ allergy, match }) => (
                <li key={allergy.id}>
                  Recorded allergy: <strong>{allergy.allergen}</strong> ({allergy.severity}
                  {allergy.reaction ? `, ${allergy.reaction}` : ""})
                  {match?.kind === "class" &&
                    ` — ${watchedItemName} is in the same ${match.drugClass} class.`}
                </li>
              ))}
            </ul>
            <label className="mt-3 flex items-start gap-2 text-body text-ink">
              <input
                type="checkbox"
                checked={allergyAcknowledged}
                onChange={(e) => setAllergyAcknowledged(e.target.checked)}
                className="mt-1 h-4 w-4"
              />
              <span>I have checked this with the prescriber and will dispense anyway.</span>
            </label>
          </div>
        )}

        {selectedItem && (
          <dl className="grid grid-cols-2 gap-3 rounded-md border border-line bg-surface-sunken p-3 text-body sm:grid-cols-3">
            <div>
              <dt className="section-label">In stock</dt>
              <dd className="font-medium text-ink">
                {selectedItem.onHandQty} {selectedItem.unit}
              </dd>
            </div>
            <div>
              <dt className="section-label">After dispensing</dt>
              <dd className={`font-medium ${insufficient ? "text-danger-fg" : "text-ink"}`}>
                {remaining !== null && qty > 0 ? `${Math.max(remaining, 0)} ${selectedItem.unit}` : "—"}
              </dd>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <dt className="section-label">Reorder at</dt>
              <dd className="flex items-center gap-2 text-ink">
                {selectedItem.reorderThreshold}
                {belowReorder && <StatusBadge tone="warning">Will be low</StatusBadge>}
              </dd>
            </div>
          </dl>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="dispense-qty" className="field-label">
              Quantity
            </label>
            <input
              id="dispense-qty"
              {...register("qty", { valueAsNumber: true })}
              type="number"
              inputMode="numeric"
              min="1"
              max={selectedItem?.onHandQty || undefined}
              className="input-field"
              aria-invalid={errors.qty || insufficient ? true : undefined}
              aria-describedby="dispense-qty-msg"
            />
            <p id="dispense-qty-msg" className={errors.qty || insufficient ? "field-error" : "field-hint"}>
              {errors.qty?.message ??
                (insufficient
                  ? `Only ${selectedItem?.onHandQty} ${selectedItem?.unit} in stock.`
                  : selectedItem
                    ? `In ${selectedItem.unit}`
                    : "")}
            </p>
          </div>
          <div>
            <label htmlFor="dispense-dosage" className="field-label">
              Dose
            </label>
            <input
              id="dispense-dosage"
              {...register("dosage")}
              className="input-field"
              placeholder="e.g. 500 mg"
              aria-invalid={errors.dosage ? true : undefined}
            />
            {errors.dosage && (
              <p className="field-error" role="alert">
                {errors.dosage.message}
              </p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="dispense-directions" className="field-label">
            Directions for the patient
          </label>
          <textarea
            id="dispense-directions"
            {...register("directions")}
            rows={3}
            className="input-field"
            placeholder="e.g. Take 1 capsule three times a day for 5 days"
            aria-invalid={errors.directions ? true : undefined}
          />
          {errors.directions && (
            <p className="field-error" role="alert">
              {errors.directions.message}
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
          {onCancel && (
            <button type="button" onClick={onCancel} className="btn-secondary">
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={loading || !selectedItem || insufficient || blockedByAllergy}
            className="btn-primary"
          >
            {loading
              ? "Saving…"
              : selectedItem && qty > 0
                ? `Dispense ${qty} × ${selectedItem.itemName}`
                : "Dispense medicine"}
          </button>
        </div>
      </form>
    </div>
  );
}
