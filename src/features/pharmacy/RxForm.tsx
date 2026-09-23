import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db as mbhrDb, ulid, type PharmacyItem } from "@/db/mbhr";
import { db, type Patient } from "@/db";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { PatientSearch } from "@/components/PatientSearch";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { matchMedicationToAllergen } from "@/utils/allergyMatch";
import { ExclamationTriangleIcon } from "@heroicons/react/20/solid";

interface RxFormProps {
  /** When given, the prescription is written for this patient and visit. */
  patientId?: string;
  visitId?: string;
  /** Render without the page header, e.g. inside the consultation. */
  embedded?: boolean;
}

const EMPTY = {
  itemId: "",
  dosage: "",
  frequency: "",
  durationDays: 7,
  qty: 10,
  notes: "",
};

/**
 * Structured prescription for the pharmacy's FEFO dispensing queue
 * (/rx/dispense). Always tied to a real patient, the signed-in prescriber,
 * and the patient's visit where one exists.
 */
export default function RxForm({ patientId, visitId, embedded = false }: RxFormProps) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const { push: pushToast } = useToast();
  const [items, setItems] = useState<PharmacyItem[]>([]);
  const [chosenPatient, setChosenPatient] = useState<Patient | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const effectivePatientId = patientId ?? chosenPatient?.id;

  useEffect(() => {
    mbhrDb.pharmacy_items
      .orderBy("medName")
      .toArray()
      .then(setItems)
      .catch(() => setError("Could not load the medicine list on this device."));
  }, []);

  const allergens =
    useLiveQuery(
      async () =>
        effectivePatientId
          ? (
              await db.patientAllergies
                .where("patientId")
                .equals(effectivePatientId)
                .filter((a) => a.isActive === 1 && a.allergyType === "medication")
                .toArray()
            ).map((a) => a.allergen)
          : [],
      [effectivePatientId],
    ) ?? [];

  const existing = useLiveQuery(
    async () =>
      effectivePatientId
        ? (await mbhrDb.prescriptions.where("patientId").equals(effectivePatientId).toArray())
            .filter((r) => (visitId ? r.visitId === visitId : true))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 10)
        : [],
    [effectivePatientId, visitId],
  );

  const selectedItem = items.find((item) => item.id === form.itemId);
  const allergyHits = selectedItem
    ? allergens.filter((a) => matchMedicationToAllergen(selectedItem.medName, a))
    : [];

  async function save() {
    setError("");
    if (!effectivePatientId) {
      setError("Choose the patient first.");
      return;
    }
    if (!form.itemId || !form.dosage.trim() || !form.frequency.trim()) {
      setError("Medicine, dose and frequency are required.");
      return;
    }
    if (form.qty < 1 || form.durationDays < 1) {
      setError("Quantity and duration must be at least 1.");
      return;
    }

    setLoading(true);
    try {
      // Link to the visit in progress when the caller did not pass one.
      let linkedVisit = visitId ?? "";
      if (!linkedVisit) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const open = (await db.visits.where("patientId").equals(effectivePatientId).toArray())
          .filter((v) => v.status === "open" && new Date(v.startedAt) >= today)
          .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
        linkedVisit = open?.id ?? "";
      }

      await mbhrDb.prescriptions.add({
        id: ulid(),
        visitId: linkedVisit,
        patientId: effectivePatientId,
        prescriberId: currentUser?.id ?? "unknown",
        createdAt: new Date().toISOString(),
        status: "open",
        lines: [
          {
            itemId: form.itemId,
            dosage: form.dosage.trim(),
            frequency: form.frequency.trim(),
            durationDays: form.durationDays,
            qty: form.qty,
            notes: form.notes.trim() || undefined,
          },
        ],
      });

      pushToast({
        id: ulid(),
        tone: "success",
        title: "Prescription sent to pharmacy",
        body: `${selectedItem?.medName ?? "Medicine"} ${selectedItem?.strength ?? ""} × ${form.qty}`,
      });
      setForm(EMPTY);
    } catch (err) {
      console.error("Error saving prescription:", err instanceof Error ? err.name : err);
      setError("The prescription was not saved. Try again.");
    } finally {
      setLoading(false);
    }
  }

  const body = (
    <div className="space-y-4">
      {!patientId && (
        <div>
          <span className="field-label">Patient</span>
          {chosenPatient ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface-sunken px-3 py-2">
              <span className="font-medium text-ink">
                {chosenPatient.givenName} {chosenPatient.familyName}
              </span>
              <button type="button" className="btn-ghost text-caption" onClick={() => setChosenPatient(null)}>
                Change
              </button>
            </div>
          ) : (
            <PatientSearch
              onPatientSelect={setChosenPatient}
              placeholder="Search by name or phone number"
              className="w-full"
            />
          )}
        </div>
      )}

      {error && (
        <div className="banner banner-danger" role="alert">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
          {error}
        </div>
      )}

      <div>
        <label htmlFor="rx-item" className="field-label">
          Medicine
        </label>
        <select
          id="rx-item"
          className="input-field"
          value={form.itemId}
          onChange={(e) => setForm({ ...form, itemId: e.target.value })}
        >
          <option value="">Choose a medicine</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.medName} {item.strength} ({item.form}) — {item.onHandQty} {item.unit} in stock
            </option>
          ))}
        </select>
        {selectedItem && selectedItem.onHandQty <= selectedItem.reorderThreshold && (
          <p className="mt-1.5">
            <StatusBadge tone={selectedItem.onHandQty === 0 ? "danger" : "warning"}>
              {selectedItem.onHandQty === 0
                ? "Out of stock"
                : `Low stock: ${selectedItem.onHandQty} ${selectedItem.unit} left`}
            </StatusBadge>
          </p>
        )}
      </div>

      {allergyHits.length > 0 && (
        <div className="banner banner-danger" role="alert">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
          <span>
            Possible allergy: recorded allergy to <strong>{allergyHits.join(", ")}</strong>. Check before
            prescribing {selectedItem?.medName}.
          </span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="rx-dose" className="field-label">
            Dose
          </label>
          <input
            id="rx-dose"
            className="input-field"
            placeholder="e.g. 1 tablet, 5 ml"
            value={form.dosage}
            onChange={(e) => setForm({ ...form, dosage: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="rx-frequency" className="field-label">
            Frequency
          </label>
          <input
            id="rx-frequency"
            className="input-field"
            placeholder="e.g. three times daily"
            value={form.frequency}
            onChange={(e) => setForm({ ...form, frequency: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="rx-duration" className="field-label">
            Duration (days)
          </label>
          <input
            id="rx-duration"
            className="input-field tabular-nums"
            type="number"
            inputMode="numeric"
            min="1"
            max="90"
            value={form.durationDays}
            onChange={(e) => setForm({ ...form, durationDays: Number(e.target.value) })}
          />
        </div>
        <div>
          <label htmlFor="rx-qty" className="field-label">
            Total quantity{selectedItem ? ` (${selectedItem.unit})` : ""}
          </label>
          <input
            id="rx-qty"
            className="input-field tabular-nums"
            type="number"
            inputMode="numeric"
            min="1"
            value={form.qty}
            onChange={(e) => setForm({ ...form, qty: Number(e.target.value) })}
          />
        </div>
      </div>

      <div>
        <label htmlFor="rx-notes" className="field-label">
          Instructions for the patient
        </label>
        <textarea
          id="rx-notes"
          className="input-field"
          rows={2}
          placeholder="e.g. Take with food"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn-secondary" onClick={() => setForm(EMPTY)} disabled={loading}>
          Clear
        </button>
        <button type="button" className="btn-primary" disabled={loading} onClick={save}>
          {loading ? "Saving…" : "Send prescription to pharmacy"}
        </button>
      </div>

      {existing && existing.length > 0 && (
        <div className="border-t border-line pt-4">
          <h3 className="section-label mb-2">{visitId ? "Prescribed this visit" : "Recent prescriptions"}</h3>
          <ul className="divide-y divide-line rounded-md border border-line">
            {existing.map((r) => {
              const line = r.lines[0];
              const item = items.find((i) => i.id === line?.itemId);
              return (
                <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 text-body">
                  <span className="min-w-0">
                    <span className="block text-ink">
                      {item ? `${item.medName} ${item.strength}` : "Unknown medicine"}
                      {r.lines.length > 1 ? ` + ${r.lines.length - 1} more` : ""}
                    </span>
                    <span className="block text-caption text-ink-muted">
                      {line?.dosage} · {line?.frequency} · {line?.durationDays} days · qty {line?.qty}
                    </span>
                  </span>
                  <StatusBadge tone={r.status === "dispensed" ? "success" : "info"}>
                    {r.status === "dispensed" ? "Dispensed" : "Waiting at pharmacy"}
                  </StatusBadge>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );

  if (embedded) return body;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Pharmacy", to: "/pharmacy/menu" }, { label: "New prescription" }]}
        title="New prescription"
        description="Prescriptions appear in the pharmacy's dispensing list, where stock is taken from the lot that expires first."
      />
      <div className="panel max-w-2xl p-5">{body}</div>
    </div>
  );
}
