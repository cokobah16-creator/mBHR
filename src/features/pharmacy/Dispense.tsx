import { useEffect, useMemo, useState } from "react";
import {
  db as mbhrDb,
  ulid,
  type PharmacyBatch,
  type PharmacyItem,
  type Prescription,
} from "@/db/mbhr";
import { db } from "@/db";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { allocateFEFO, type FefoResult } from "./fefo";
import { matchMedicationToAllergen } from "@/utils/allergyMatch";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PharmacySkeleton } from "@/components/ui/Skeleton";
import { DocumentTextIcon } from "@heroicons/react/24/outline";
import { ExclamationTriangleIcon } from "@heroicons/react/20/solid";

type Line = Prescription["lines"][number];

interface LinePlan {
  line: Line;
  item?: PharmacyItem;
  fefo: FefoResult;
}

const SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000;

function formatExpiry(iso: string) {
  return new Date(iso).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function Dispense() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const { push: pushToast } = useToast();
  const [rx, setRx] = useState<Prescription[] | null>(null);
  const [batches, setBatches] = useState<PharmacyBatch[]>([]);
  const [items, setItems] = useState<PharmacyItem[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [allergens, setAllergens] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [allergyAck, setAllergyAck] = useState(false);

  const loadData = async () => {
    try {
      const [rxData, batchesData, itemsData] = await Promise.all([
        mbhrDb.prescriptions.where("status").equals("open").toArray(),
        mbhrDb.pharmacy_batches.toArray(),
        mbhrDb.pharmacy_items.toArray(),
      ]);
      // Resolve people so the pharmacist sees names, not record ids.
      const ids = [...new Set(rxData.flatMap((r) => [r.patientId, r.prescriberId]))];
      const [patients, users] = await Promise.all([
        db.patients.bulkGet(ids),
        db.users.bulkGet(ids),
      ]);
      const map: Record<string, string> = {};
      patients.forEach((p) => p && (map[p.id] = `${p.givenName} ${p.familyName}`));
      users.forEach((u) => u && (map[u.id] = u.fullName));
      setNames(map);
      setRx(rxData.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      setBatches(batchesData);
      setItems(itemsData);
    } catch (err) {
      console.error("Error loading dispense data:", err);
      setRx([]);
      setError("Could not load prescriptions on this device.");
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const chosen = rx?.find((r) => r.id === selected);

  useEffect(() => {
    setAllergyAck(false);
    setError("");
    if (!chosen) {
      setAllergens([]);
      return;
    }
    db.patientAllergies
      .where("patientId")
      .equals(chosen.patientId)
      .filter((a) => a.isActive === 1 && a.allergyType === "medication")
      .toArray()
      .then((as) => setAllergens(as.map((a) => a.allergen)))
      .catch(() => setAllergens([]));
  }, [chosen]);

  const plans: LinePlan[] = useMemo(() => {
    if (!chosen) return [];
    return chosen.lines.map((line) => ({
      line,
      item: items.find((i) => i.id === line.itemId),
      fefo: allocateFEFO(batches, line.itemId, line.qty),
    }));
  }, [chosen, items, batches]);

  const allergyHits = useMemo(
    () =>
      plans.flatMap((p) =>
        allergens
          .map((a) => ({
            med: p.item?.medName ?? "",
            allergen: a,
            match: matchMedicationToAllergen(p.item?.medName ?? "", a),
          }))
          .filter((h) => h.match),
      ),
    [plans, allergens],
  );

  const shortLines = plans.filter((p) => p.fefo.shortfall > 0 || !p.item);
  const canDispense =
    !!chosen &&
    plans.length > 0 &&
    shortLines.length === 0 &&
    (allergyHits.length === 0 || allergyAck) &&
    !loading;

  async function doDispense() {
    if (!chosen || !canDispense) return;
    setLoading(true);
    setError("");
    try {
      const now = new Date().toISOString();
      await mbhrDb.transaction(
        "rw",
        [
          mbhrDb.pharmacy_batches,
          mbhrDb.dispenses,
          mbhrDb.pharmacy_items,
          mbhrDb.stock_moves_rx,
          mbhrDb.prescriptions,
        ],
        async () => {
          for (const plan of plans) {
            for (const alloc of plan.fefo.allocations) {
              // Re-read inside the transaction: another device or tab may
              // have used this lot since the page loaded.
              const lot = await mbhrDb.pharmacy_batches.get(alloc.batchId);
              if (!lot || lot.qtyOnHand < alloc.qty) {
                throw new Error(`Lot ${alloc.lotNumber} no longer has ${alloc.qty} available.`);
              }
              await mbhrDb.dispenses.add({
                id: ulid(),
                prescriptionId: chosen.id,
                patientId: chosen.patientId,
                itemId: plan.line.itemId,
                batchId: alloc.batchId,
                qty: alloc.qty,
                dispensedBy: currentUser?.id ?? "unknown",
                dispensedAt: now,
              });
              await mbhrDb.pharmacy_batches.update(alloc.batchId, {
                qtyOnHand: lot.qtyOnHand - alloc.qty,
              });
              await mbhrDb.stock_moves_rx.add({
                id: ulid(),
                itemId: plan.line.itemId,
                batchId: alloc.batchId,
                qtyDelta: -alloc.qty,
                reason: "dispense",
                createdAt: now,
              });
            }
            const item = await mbhrDb.pharmacy_items.get(plan.line.itemId);
            if (item) {
              await mbhrDb.pharmacy_items.update(item.id, {
                onHandQty: Math.max(0, item.onHandQty - plan.line.qty),
                updatedAt: now,
              });
            }
          }
          await mbhrDb.prescriptions.update(chosen.id, { status: "dispensed" });
        },
      );

      if (allergyHits.length > 0) {
        await db.auditLogs
          .add({
            id: ulid(),
            actorRole: currentUser?.role ?? "unknown",
            action: "dispense_allergy_override",
            entity: "prescription",
            entityId: chosen.id,
            at: new Date(),
          })
          .catch(() => undefined);
      }

      pushToast({
        id: ulid(),
        title: "Prescription dispensed",
        body: `${names[chosen.patientId] ?? "Patient"} · ${plans.length} item${plans.length === 1 ? "" : "s"}`,
      });
      setSelected("");
      await loadData();
    } catch (err) {
      console.error("Error dispensing medication:", err);
      setError(
        err instanceof Error && err.message.startsWith("Lot ")
          ? `${err.message} Nothing was dispensed — stock has been refreshed.`
          : "Nothing was dispensed — the record could not be saved. Try again.",
      );
      await loadData();
    } finally {
      setLoading(false);
    }
  }

  if (rx === null) {
    return (
      <div>
        <PageHeader title="Dispense prescriptions" />
        <PharmacySkeleton />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Pharmacy", to: "/pharmacy" }, { label: "Dispense" }]}
        title="Dispense prescriptions"
        description="Stock is taken from the lot that expires first. Expired lots are never used."
      />

      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
        <section className="panel" aria-labelledby="open-rx-title">
          <div className="panel-header">
            <h2 id="open-rx-title" className="panel-title">
              Open prescriptions ({rx.length})
            </h2>
          </div>
          {rx.length === 0 ? (
            <EmptyState
              icon={DocumentTextIcon}
              title="No open prescriptions"
              description="Prescriptions written by clinicians appear here until they are dispensed."
            />
          ) : (
            <ul className="divide-y divide-line" role="listbox" aria-label="Open prescriptions">
              {rx.map((r) => {
                const first = items.find((i) => i.id === r.lines[0]?.itemId);
                const isSel = selected === r.id;
                return (
                  <li key={r.id} role="option" aria-selected={isSel}>
                    <button
                      type="button"
                      onClick={() => setSelected(r.id)}
                      className={`w-full px-4 py-3 text-left transition-colors ${
                        isSel ? "bg-primary-soft" : "hover:bg-surface-sunken"
                      }`}
                    >
                      <span className="block font-medium text-ink">
                        {names[r.patientId] ?? "Unknown patient"}
                      </span>
                      <span className="block text-caption text-ink-secondary">
                        {first ? `${first.medName} ${first.strength}` : "Unknown item"}
                        {r.lines.length > 1 ? ` + ${r.lines.length - 1} more` : ""}
                      </span>
                      <span className="block text-caption text-ink-muted">
                        {names[r.prescriberId] ?? "Unknown prescriber"} ·{" "}
                        {new Date(r.createdAt).toLocaleTimeString("en-NG", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="panel" aria-labelledby="dispense-title">
          <div className="panel-header">
            <h2 id="dispense-title" className="panel-title">
              {chosen ? names[chosen.patientId] ?? "Unknown patient" : "Dispense"}
            </h2>
            {chosen && (
              <span className="text-caption text-ink-muted">
                Prescribed by {names[chosen.prescriberId] ?? "unknown"}
              </span>
            )}
          </div>

          {!chosen ? (
            <p className="panel-body text-body text-ink-muted">
              Select a prescription to see which lots will be used.
            </p>
          ) : (
            <div className="panel-body space-y-4">
              {error && (
                <div className="banner banner-danger" role="alert">
                  <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
                  {error}
                </div>
              )}

              {allergyHits.length > 0 && (
                <div className="rounded-md border border-danger-line bg-danger-soft p-4" role="alert">
                  <p className="flex items-center gap-2 text-h3 text-danger-fg">
                    <ExclamationTriangleIcon className="h-5 w-5" aria-hidden />
                    Possible allergy
                  </p>
                  <ul className="mt-1 text-body text-danger-fg">
                    {allergyHits.map((h, i) => (
                      <li key={i}>
                        {h.med}: recorded allergy to <strong>{h.allergen}</strong>
                        {h.match?.kind === "class" ? ` (${h.match.drugClass} class)` : ""}
                      </li>
                    ))}
                  </ul>
                  <label className="mt-3 flex items-start gap-2 text-body text-ink">
                    <input
                      type="checkbox"
                      checked={allergyAck}
                      onChange={(e) => setAllergyAck(e.target.checked)}
                      className="mt-1 h-4 w-4"
                    />
                    <span>I have checked this with the prescriber and will dispense anyway.</span>
                  </label>
                </div>
              )}

              {plans.map(({ line, item, fefo }, idx) => (
                <article key={idx} className="rounded-md border border-line">
                  <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
                    <h3 className="text-h3 text-ink">
                      {item ? `${item.medName} ${item.strength}` : "Item not in stock list"}
                    </h3>
                    <span className="text-label text-ink">
                      {line.qty} {item?.unit ?? ""}
                    </span>
                  </header>
                  <div className="space-y-3 px-4 py-3">
                    <p className="text-body text-ink-secondary">
                      {line.dosage} · {line.frequency} · {line.durationDays} day
                      {line.durationDays === 1 ? "" : "s"}
                      {line.notes ? ` · ${line.notes}` : ""}
                    </p>

                    {fefo.allocations.length > 0 && (
                      <table className="data-table">
                        <caption className="sr-only">Lots to dispense from</caption>
                        <thead>
                          <tr>
                            <th scope="col">Dispense from lot</th>
                            <th scope="col">Expires</th>
                            <th scope="col" className="text-right">
                              Quantity
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {fefo.allocations.map((a) => {
                            const soon =
                              new Date(a.expiryDate).getTime() - Date.now() < SIX_MONTHS_MS;
                            return (
                              <tr key={a.batchId}>
                                <td className="font-mono">{a.lotNumber}</td>
                                <td>
                                  <span className="flex items-center gap-2">
                                    {formatExpiry(a.expiryDate)}
                                    {soon && <StatusBadge tone="warning">Expires soon</StatusBadge>}
                                  </span>
                                </td>
                                <td className="text-right">{a.qty}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}

                    {fefo.shortfall > 0 && (
                      <p className="banner banner-danger text-caption">
                        Not enough in-date stock: {fefo.shortfall} {item?.unit ?? "units"} short.
                        Do not dispense a partial amount without the prescriber.
                      </p>
                    )}

                    {fefo.expired.length > 0 && (
                      <p className="banner banner-warning text-caption">
                        Expired, set aside — do not dispense:{" "}
                        {fefo.expired
                          .map((l) => `lot ${l.lotNumber} (${l.qtyOnHand}, expired ${formatExpiry(l.expiryDate)})`)
                          .join("; ")}
                      </p>
                    )}
                  </div>
                </article>
              ))}

              <div className="flex justify-end border-t border-line pt-4">
                <button className="btn-primary" disabled={!canDispense} onClick={doDispense}>
                  {loading
                    ? "Saving…"
                    : `Dispense ${plans.length} item${plans.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
