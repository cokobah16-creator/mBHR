import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  db as mbhrDb,
  ulid,
  type PharmacyBatch,
  type PharmacyItem,
  type Prescription,
} from "@/db/mbhr";
import { db } from "@/db";
import { can } from "@/auth/roles";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { allocateFEFO, type FefoResult } from "./fefo";
import { matchMedicationToAllergen } from "@/utils/allergyMatch";
import {
  confirmDispenseNow,
  dispensePrescription,
  ledgerEnabled,
  type CommandAnswer,
} from "@/services/pharmacyCommands";
import { dispenseMode } from "@/services/pharmacyCommandsModel";
import { rejectReasonText } from "@/sync/pharmacySyncModel";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PharmacySkeleton } from "@/components/ui/Skeleton";
import { DocumentTextIcon } from "@heroicons/react/24/outline";
import { ExclamationTriangleIcon, InformationCircleIcon } from "@heroicons/react/20/solid";

type Line = Prescription["lines"][number];

interface LinePlan {
  line: Line;
  item?: PharmacyItem;
  fefo: FefoResult;
}

interface DispenseData {
  rx: Prescription[];
  /** Dispensed on this device, waiting for the server (or refused). */
  recent: Prescription[];
  commandStatus: Record<string, string>;
  batches: PharmacyBatch[];
  items: PharmacyItem[];
  names: Record<string, string>;
  openDiscrepancies: number;
  error?: string;
}

const SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function formatExpiry(iso: string) {
  return new Date(iso).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

async function loadDispenseData(): Promise<DispenseData> {
  try {
    const [rxData, batches, items, pendingRx, commands, openDiscrepancies] = await Promise.all([
      mbhrDb.prescriptions.where("status").equals("open").toArray(),
      mbhrDb.pharmacy_batches.toArray(),
      mbhrDb.pharmacy_items.toArray(),
      mbhrDb.prescriptions.filter((r) => !!r.pendingCommandId || (r.uncoveredQty ?? 0) > 0).toArray(),
      mbhrDb.rx_commands.where("status").anyOf(["pending", "waiting_permission"]).toArray(),
      mbhrDb.stock_discrepancies.where("status").equals("open").count(),
    ]);
    const since = new Date(Date.now() - DAY_MS).toISOString();
    const recent = pendingRx
      .filter((r) => !!r.pendingCommandId || (r.dispensedAt ?? "") >= since)
      .sort((a, b) => (b.dispensedAt ?? "").localeCompare(a.dispensedAt ?? ""));
    // Resolve people so the pharmacist sees names, not record ids.
    const ids = [...new Set([...rxData, ...recent].flatMap((r) => [r.patientId, r.prescriberId]))];
    const [patients, users] = await Promise.all([db.patients.bulkGet(ids), db.users.bulkGet(ids)]);
    const names: Record<string, string> = {};
    patients.forEach((p) => p && (names[p.id] = `${p.givenName} ${p.familyName}`));
    users.forEach((u) => u && (names[u.id] = u.fullName));
    const commandStatus: Record<string, string> = {};
    commands.forEach((c) => (commandStatus[c.id] = c.status));
    return {
      rx: rxData.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      recent,
      commandStatus,
      batches,
      items,
      names,
      openDiscrepancies,
    };
  } catch (err) {
    console.error("Error loading dispense data:", err instanceof Error ? err.name : "unknown");
    return {
      rx: [],
      recent: [],
      commandStatus: {},
      batches: [],
      items: [],
      names: {},
      openDiscrepancies: 0,
      error: "Prescriptions could not be read on this device. Reload the page; nothing has been dispensed.",
    };
  }
}

function errorMessage(err: unknown): string {
  const name = err instanceof Error ? err.name : "";
  switch (name) {
    case "LotChanged":
      return `${(err as Error).message} Nothing was dispensed — stock has been refreshed.`;
    case "NotAllowed":
      return "Your account cannot dispense medicines. Nothing was dispensed.";
    case "PrescriptionNotOpen":
      return "This prescription is no longer open: it was dispensed or cancelled. Nothing was dispensed.";
    case "MixedStock":
      return "This prescription mixes stock kept only on this device with the server's stock. Upload or discard this device's stock on the Pharmacy stock page first. Nothing was dispensed.";
    case "UnknownItem":
      return "A medicine on this prescription is not in the stock list. Nothing was dispensed.";
    case "IncompleteAllocation":
      return "Not every line is covered by in-date stock. Nothing was dispensed.";
    default:
      return "Nothing was dispensed — the record could not be saved. Try again.";
  }
}

export default function Dispense() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const { push: pushToast } = useToast();
  const data = useLiveQuery(loadDispenseData, []);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [allergens, setAllergens] = useState<string[]>([]);
  const [allergyStatus, setAllergyStatus] = useState<"loading" | "ready" | "error">("ready");
  const [allergyRetry, setAllergyRetry] = useState(0);
  const [selected, setSelected] = useState<string>("");
  const [selectedPatientId, setSelectedPatientId] = useState<string>("");
  const [loading, setLoading] = useState<"" | "saving" | "confirming">("");
  const [error, setError] = useState("");
  const [allergyAck, setAllergyAck] = useState(false);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const rx = data?.rx;
  const items = useMemo(() => data?.items ?? [], [data]);
  const batches = useMemo(() => data?.batches ?? [], [data]);
  const names = data?.names ?? {};
  const chosen = rx?.find((r) => r.id === selected);

  // Keyed on the selection, not the loaded object: a prescription leaves
  // and re-enters the open list while the server checks it, and that must
  // not wipe the message the pharmacist needs to read.
  useEffect(() => {
    setAllergyAck(false);
    setError("");
    setAllergens([]);
    if (!selectedPatientId) {
      setAllergyStatus("ready");
      return;
    }
    // Dispensing stays blocked until this patient's allergies are known;
    // a failed lookup must never read as "no allergies".
    setAllergyStatus("loading");
    let stale = false;
    db.patientAllergies
      .where("patientId")
      .equals(selectedPatientId)
      .filter((a) => a.isActive === 1 && a.allergyType === "medication")
      .toArray()
      .then((as) => {
        if (stale) return;
        setAllergens(as.map((a) => a.allergen));
        setAllergyStatus("ready");
      })
      .catch(() => {
        if (!stale) setAllergyStatus("error");
      });
    return () => {
      stale = true;
    };
  }, [selected, selectedPatientId, allergyRetry]);

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

  const mode = chosen ? dispenseMode(chosen.lines, items) : "missing";
  const mayDispense = !!currentUser && can(currentUser.role, "dispense");
  const shortLines = plans.filter((p) => p.fefo.shortfall > 0 || !p.item);
  const canDispense =
    !!chosen &&
    mayDispense &&
    plans.length > 0 &&
    shortLines.length === 0 &&
    mode !== "mixed" &&
    mode !== "missing" &&
    allergyStatus === "ready" &&
    (allergyHits.length === 0 || allergyAck) &&
    !loading;

  function itemName(itemId: string) {
    const item = items.find((i) => i.id === itemId);
    return item ? `${item.medName} ${item.strength}`.trim() : "A medicine";
  }

  function rejectionMessage(answer: CommandAnswer): string {
    const lines = answer.shortLines
      .map((l) => `${itemName(l.itemId)}: ${l.available} in date on the server, ${l.requested} prescribed`)
      .join("; ");
    return `Not dispensed. ${rejectReasonText(answer.rejectReason)}${lines ? ` (${lines}.)` : ""} Do not hand over this medicine; the stock shown has been corrected.`;
  }

  async function doDispense() {
    if (!chosen || !canDispense || !currentUser) return;
    if (!can(currentUser.role, "dispense")) {
      setError("Your account cannot dispense medicines. Nothing was dispensed.");
      return;
    }
    const patientName = names[chosen.patientId] ?? "Patient";
    const count = `${plans.length} item${plans.length === 1 ? "" : "s"}`;
    setLoading("saving");
    setError("");
    try {
      const outcome = await dispensePrescription(
        {
          prescription: chosen,
          plan: plans.map((p) => ({ itemId: p.line.itemId, qty: p.line.qty, allocations: p.fefo.allocations })),
          items,
          allergyOverride: allergyHits.length > 0,
        },
        { id: currentUser.id, role: currentUser.role },
      );

      if (allergyHits.length > 0) {
        await db.auditLogs
          .add({
            id: ulid(),
            actorRole: currentUser.role ?? "unknown",
            action: "dispense_allergy_override",
            entity: "prescription",
            entityId: chosen.id,
            at: new Date(),
          })
          .catch(() => undefined);
      }

      if (outcome.kind === "local") {
        pushToast({
          id: ulid(),
          title: "Prescription dispensed",
          tone: "success",
          body: `${patientName} · ${count}. Saved on this device (stock kept only on this device).`,
        });
        setSelected("");
        setSelectedPatientId("");
        return;
      }

      if (outcome.offline) {
        pushToast({
          id: ulid(),
          title: "Dispensed · saved on this device",
          tone: "info",
          body: `${patientName} · ${count}. Stock will be confirmed when it syncs.`,
        });
        setSelected("");
        setSelectedPatientId("");
        return;
      }

      setLoading("confirming");
      const answer = await confirmDispenseNow(outcome.commandId);
      if (answer.status === "applied") {
        pushToast({
          id: ulid(),
          title: "Prescription dispensed",
          tone: "success",
          body: `${patientName} · ${count}. Stock confirmed by the server.`,
        });
        setSelected("");
        setSelectedPatientId("");
      } else if (answer.status === "rejected") {
        // The prescription is open again (the answer's handler undid it).
        setError(rejectionMessage(answer));
      } else {
        pushToast({
          id: ulid(),
          title: "Dispensed · saved on this device",
          tone: "info",
          body: `${patientName} · ${count}. The server has not confirmed the stock yet; it will at the next sync.`,
        });
        setSelected("");
        setSelectedPatientId("");
      }
    } catch (err) {
      console.error("Error dispensing medication:", err instanceof Error ? err.name : "unknown");
      setError(errorMessage(err));
    } finally {
      setLoading("");
    }
  }

  if (!data || !rx) {
    return (
      <div>
        <PageHeader title="Dispense prescriptions" />
        <PharmacySkeleton />
      </div>
    );
  }

  const recent = data.recent;
  const syncNote = !ledgerEnabled
    ? "Stock is kept on this device only (no server is set up)."
    : online
      ? "The server confirms stock for each dispense."
      : "Offline: dispensing is saved on this device and the server confirms stock when it syncs.";

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Pharmacy", to: "/pharmacy/menu" }, { label: "Dispense" }]}
        title="Dispense prescriptions"
        description={`Stock is taken from the lot that expires first. Expired lots are never used. ${syncNote}`}
      />

      {data.error && (
        <div className="banner banner-danger mb-4" role="alert">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
          {data.error}
        </div>
      )}

      {loading === "confirming" && !chosen && (
        <div className="banner banner-info mb-4" role="status" aria-live="polite">
          <InformationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
          Checking stock with the server. Do not hand over the medicine yet.
        </div>
      )}

      {error && !chosen && (
        <div className="banner banner-danger mb-4" role="alert">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
          {error}
        </div>
      )}

      {data.openDiscrepancies > 0 && (
        <div className="banner banner-warning mb-4" role="status">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
          <span>
            {data.openDiscrepancies} stock discrepanc{data.openDiscrepancies === 1 ? "y" : "ies"}: medicine was
            handed over offline beyond the server's stock. Count those lots on the Pharmacy stock page.
          </span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
        <div className="space-y-4">
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
                        onClick={() => {
                          setSelected(r.id);
                          setSelectedPatientId(r.patientId);
                        }}
                        className={`min-h-touch-target w-full px-4 py-3 text-left transition-colors ${
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
                        {r.lastRejectReason && (
                          <span className="mt-1 block">
                            <StatusBadge tone="danger">Refused by the server</StatusBadge>
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {recent.length > 0 && (
            <section className="panel" aria-labelledby="recent-rx-title">
              <div className="panel-header">
                <h2 id="recent-rx-title" className="panel-title">
                  Dispensed on this device
                </h2>
              </div>
              <ul className="divide-y divide-line" aria-live="polite">
                {recent.map((r) => {
                  const status = r.pendingCommandId ? data.commandStatus[r.pendingCommandId] : undefined;
                  return (
                    <li key={r.id} className="space-y-1 px-4 py-3">
                      <span className="block font-medium text-ink">{names[r.patientId] ?? "Unknown patient"}</span>
                      {r.pendingCommandId ? (
                        <StatusBadge tone="warning">
                          {status === "waiting_permission"
                            ? "Waiting for an authorised person to sync"
                            : "Saved on this device · waiting to sync"}
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="warning">
                          {r.uncoveredQty} unit{r.uncoveredQty === 1 ? "" : "s"} beyond server stock · count needed
                        </StatusBadge>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>

        <section className="panel" aria-labelledby="dispense-title">
          <div className="panel-header">
            <h2 id="dispense-title" className="panel-title">
              {chosen ? (names[chosen.patientId] ?? "Unknown patient") : "Dispense"}
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

              {!error && chosen.lastRejectReason && (
                <div className="banner banner-warning" role="status">
                  <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
                  <span>
                    The last attempt to dispense this was refused by the server.{" "}
                    {rejectReasonText(chosen.lastRejectReason)} Check the stock before trying again.
                  </span>
                </div>
              )}

              {!mayDispense && (
                <div className="banner banner-info" role="status">
                  <InformationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
                  Only pharmacists and administrators can dispense.
                </div>
              )}

              {mode === "mixed" && (
                <div className="banner banner-warning" role="status">
                  <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
                  <span>
                    This prescription uses stock kept only on this device and stock on the server. Upload or discard
                    this device's stock on the Pharmacy stock page before dispensing it.
                  </span>
                </div>
              )}

              {mode === "local" && ledgerEnabled && (
                <p className="text-caption text-ink-muted">
                  These medicines are stock kept only on this device. Dispensing changes this device's count; the
                  server records the dispensing but not the stock until the opening stock is uploaded.
                </p>
              )}

              {allergyStatus === "error" && (
                <div className="banner banner-danger" role="alert">
                  <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
                  <span className="flex-1">
                    This patient's allergies could not be read, so dispensing is blocked.
                  </span>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setAllergyRetry((n) => n + 1)}
                  >
                    Try again
                  </button>
                </div>
              )}

              {allergyStatus === "loading" && (
                <p className="text-caption text-ink-muted" role="status">
                  Checking recorded allergies…
                </p>
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
                  <label className="mt-3 flex min-h-touch-target items-start gap-2 text-body text-ink">
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

              <div className="flex flex-col items-end gap-2 border-t border-line pt-4">
                <p className="text-caption text-ink-muted" role="status" aria-live="polite">
                  {loading === "confirming"
                    ? "Checking stock with the server. Do not hand over the medicine yet."
                    : ""}
                </p>
                <button className="btn-primary" disabled={!canDispense} onClick={doDispense}>
                  {loading === "saving"
                    ? "Saving…"
                    : loading === "confirming"
                      ? "Checking with the server…"
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
