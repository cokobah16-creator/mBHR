import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db as mbhrDb, ulid, type InventoryNM } from "@/db/mbhr";
import { generateId } from "@/db";
import { useGam } from "@/stores/gamification";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { can } from "@/auth/roles";
import {
  CheckCircleIcon,
  CubeIcon,
  ExclamationCircleIcon,
  LockClosedIcon,
} from "@heroicons/react/24/outline";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TrainingModeFrame } from "@/components/training/TrainingModeFrame";
import { TrainingStat } from "@/components/training/TrainingWidgets";
import {
  RESTOCK_TAP_AMOUNTS,
  SWIFT_STOCKER_MIN_TOKENS,
  restockTapTokens,
} from "@/components/training/trainingRules";

type Delta = Record<string, number>;

const LIVE_CHANGES =
  "Recording a restock adds the quantities to this device's non-medical supply counts and logs a stock movement under your account. Only record items you have actually put on the shelf.";

export default function RestockGame() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const userId = currentUser?.id;
  const allowed = !!currentUser && can(currentUser.role, "inventory");
  const addTokens = useGam((s) => s.addTokens);
  const ensureWallet = useGam((s) => s.ensureWallet);
  const wallet = useGam((s) => s.wallet);
  const { push } = useToast();
  const [deltas, setDeltas] = useState<Delta>({});
  const [tokens, setTokens] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const items = useLiveQuery<InventoryNM[]>(
    () => mbhrDb.inventory_nm.orderBy("itemName").toArray(),
    [],
  );

  useEffect(() => {
    if (!userId || !allowed) return;
    ensureWallet(userId).catch((err) => {
      console.error(
        "Could not open prize-shop wallet:",
        err instanceof Error ? err.name : err,
      );
    });
  }, [userId, allowed, ensureWallet]);

  const low = useMemo(
    () => (items ?? []).filter((i) => i.onHandQty <= i.reorderThreshold),
    [items],
  );
  const pending = useMemo(
    () =>
      (items ?? [])
        .filter((i) => (deltas[i.id] || 0) > 0)
        .map((i) => ({ item: i, qty: deltas[i.id] })),
    [items, deltas],
  );

  let emptyDescription = "Every non-medical supply is above its reorder level.";
  if (items && items.length === 0) {
    emptyDescription = "No non-medical supplies are recorded on this device yet.";
  }

  // Restock changes real supply counts, so only people who manage inventory
  // may use it.
  if (!allowed) {
    return (
      <TrainingModeFrame
        title="Restock game"
        description="Non-medical supplies"
        liveChanges={LIVE_CHANGES}
      >
        <div className="panel">
          <EmptyState
            icon={LockClosedIcon}
            title="You can't record restocks"
            description="This game changes real supply counts, so it needs inventory permission. Ask an administrator if you need access."
            action={
              <Link to="/games" className="btn-secondary">
                Back to training
              </Link>
            }
          />
        </div>
      </TrainingModeFrame>
    );
  }

  function tap(id: string, amount: number) {
    setError("");
    setDeltas((d) => ({ ...d, [id]: (d[id] || 0) + amount }));
    setTokens((t) => t + restockTapTokens(amount));
  }

  function clearPending() {
    setDeltas({});
    setTokens(0);
    setError("");
  }

  async function commit() {
    if (!currentUser || saving) return;
    if (!can(currentUser.role, "inventory")) {
      setError("You need inventory permission to record a restock.");
      return;
    }
    const sessionTokens = tokens;
    const itemCount = pending.length;
    setSaving(true);
    setError("");
    const now = new Date().toISOString();
    try {
      await mbhrDb.transaction(
        "rw",
        mbhrDb.inventory_nm,
        mbhrDb.stock_moves_nm,
        async () => {
          for (const [itemId, qty] of Object.entries(deltas)) {
            if (qty <= 0) continue;
            const item = await mbhrDb.inventory_nm.get(itemId);
            if (!item) continue;
            await mbhrDb.stock_moves_nm.add({
              id: ulid(),
              itemId,
              qtyDelta: qty,
              reason: "restock",
              actorId: currentUser.id,
              createdAt: now,
            });
            await mbhrDb.inventory_nm.update(itemId, {
              onHandQty: item.onHandQty + qty,
              updatedAt: now,
            });
          }
        },
      );
    } catch (err) {
      console.error(
        "Could not record restock:",
        err instanceof Error ? err.name : err,
      );
      setError("The restock was not saved and no supply counts changed. Try again.");
      setSaving(false);
      return;
    }

    setDeltas({});
    setTokens(0);

    // Award tokens and badges to the person who did the restock.
    try {
      await addTokens(
        currentUser.id,
        sessionTokens,
        sessionTokens >= SWIFT_STOCKER_MIN_TOKENS ? "swift_stocker" : undefined,
      );
      push({
        id: generateId(),
        tone: "success",
        title: `Restock recorded: ${itemCount} ${itemCount === 1 ? "item" : "items"}`,
        body: `Supply counts updated on this device. ${sessionTokens} tokens added to your prize-shop wallet.`,
      });
    } catch (err) {
      console.error(
        "Could not add restock tokens:",
        err instanceof Error ? err.name : err,
      );
      push({
        id: generateId(),
        tone: "warning",
        title: "Restock recorded, but tokens were not added",
        body: "Supply counts were updated on this device. The tokens for this restock could not be saved.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <TrainingModeFrame
      title="Restock game"
      description="Non-medical supplies at or below their reorder level."
      liveChanges={LIVE_CHANGES}
      actions={
        <Link to="/inv/prizes" className="btn-secondary">
          Prize shop
        </Link>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <TrainingStat
            label="Tokens this restock"
            value={tokens}
            hint="Added when you record the restock"
          />
          <TrainingStat
            label="Your prize-shop tokens"
            value={wallet}
            hint="Stored on this device"
          />
        </div>

        {error && (
          <div className="banner banner-danger" role="alert">
            <ExclamationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
            <p>{error}</p>
          </div>
        )}

        {items === undefined ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" aria-hidden>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="card space-y-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
        ) : low.length === 0 ? (
          <div className="panel">
            <EmptyState
              icon={CheckCircleIcon}
              title="Nothing needs restocking"
              description={emptyDescription}
            />
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {low.map((it) => {
              const out = it.onHandQty <= 0;
              const added = deltas[it.id] || 0;
              return (
                <li key={it.id} className="card space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-h3 text-ink">{it.itemName}</h2>
                    <StatusBadge tone={out ? "danger" : "warning"}>
                      {out ? "Out of stock" : "Low stock"}
                    </StatusBadge>
                  </div>
                  <p className="text-body text-ink-secondary">
                    On hand{" "}
                    <span className="font-semibold tabular-nums text-ink">
                      {it.onHandQty}
                    </span>{" "}
                    {it.unit} · reorder at {it.reorderThreshold}
                  </p>
                  <div
                    className="grid grid-cols-3 gap-2"
                    role="group"
                    aria-label={`Add ${it.itemName}`}
                  >
                    {RESTOCK_TAP_AMOUNTS.map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        className="btn-secondary px-2"
                        onClick={() => tap(it.id, amount)}
                        disabled={saving}
                        aria-label={`Add ${amount} ${it.unit} of ${it.itemName}`}
                      >
                        +{amount}
                      </button>
                    ))}
                  </div>
                  {added > 0 && (
                    <p className="text-body text-info-fg">
                      To record: +{added} {it.unit} (on hand will be{" "}
                      {it.onHandQty + added})
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <section className="panel" aria-labelledby="restock-review">
          <div className="panel-header">
            <h2 id="restock-review" className="panel-title">
              Review before recording
            </h2>
          </div>
          <div className="panel-body space-y-4">
            {pending.length === 0 ? (
              <p className="text-body text-ink-muted">
                Nothing added yet. Use the + buttons for supplies you have put
                on the shelf.
              </p>
            ) : (
              <ul className="space-y-1 text-body text-ink">
                {pending.map(({ item, qty }) => (
                  <li key={item.id} className="flex items-center gap-2">
                    <CubeIcon className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
                    {item.itemName}: +{qty} {item.unit}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className="btn-primary"
                disabled={pending.length === 0 || saving}
                onClick={() => void commit()}
              >
                {saving
                  ? "Recording…"
                  : `Record restock${pending.length > 0 ? ` (${pending.length} ${pending.length === 1 ? "item" : "items"})` : ""}`}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={clearPending}
                disabled={pending.length === 0 || saving}
              >
                Clear
              </button>
            </div>
            <p className="text-caption text-ink-muted">
              Recording updates the real supply counts on this device.
            </p>
          </div>
        </section>
      </div>
    </TrainingModeFrame>
  );
}
