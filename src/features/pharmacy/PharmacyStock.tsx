import React, { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  db as mbhrDb,
  type PharmacyBatch,
  type PharmacyItem,
  type StockDiscrepancy,
} from "@/db/mbhr";
import { createAuditLog, generateId } from "@/db";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { can } from "@/auth/roles";
import { formatNigerianDate } from "@/utils/dateFormat";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge, type Tone } from "@/components/ui/StatusBadge";
import { PharmacySkeleton } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/features/admin/ConfirmDialog";
import {
  addMedicine,
  adjustStock,
  deleteLocalMedicine,
  discardLocalStock,
  ledgerEnabled,
  readSiteClaim,
  receiveStock,
  resolveDiscrepancy,
  setMedicineActive,
  uploadOpeningStock,
  type SiteClaim,
} from "@/services/pharmacyCommands";
import { receiveProblem } from "@/services/pharmacyCommandsModel";
import {
  countPharmacyAwaitingAuthorised,
  countPharmacyUnsynced,
  pharmacyServerReachable,
  syncPharmacyNow,
} from "@/sync/pharmacySync";
import {
  BeakerIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  TrashIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ArchiveBoxXMarkIcon,
  ArrowPathIcon,
  ArrowUturnLeftIcon,
  ClipboardDocumentCheckIcon,
  CloudArrowUpIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";

interface ItemWithBatches extends PharmacyItem {
  batches: PharmacyBatch[];
  totalBatches: number;
  earliestExpiry?: string;
  expiredBatches: number;
  expiringSoonBatches: number;
}

type FilterType = "all" | "low_stock" | "expired" | "expiring_soon";

const FILTERS: ReadonlyArray<{ key: FilterType; label: string }> = [
  { key: "all", label: "All items" },
  { key: "low_stock", label: "Low stock" },
  { key: "expired", label: "Expired lots" },
  { key: "expiring_soon", label: "Expiring within 6 months" },
];

const EMPTY_ITEM_FORM = {
  medName: "",
  form: "tablet",
  strength: "",
  unit: "tablets",
  reorderThreshold: 50,
  isControlled: false,
};

const EMPTY_BATCH_FORM = {
  lotNumber: "",
  qtyOnHand: 0,
  expiryDate: "",
  supplier: "",
};

const EMPTY_COUNT_FORM = {
  counted: 0,
  reason: "adjust" as "adjust" | "expire",
  note: "",
};

interface StockSnapshot {
  items: ItemWithBatches[];
  discrepancies: StockDiscrepancy[];
  localOnlyItems: number;
  localOnlyLots: number;
  unsynced: number;
  awaitingAuthorised: number;
  error?: string;
}

function isActiveItem(item: PharmacyItem): boolean {
  return item.isActive !== false;
}

function getStockStatus(item: ItemWithBatches): { label: string; tone: Tone } {
  if (!isActiveItem(item)) return { label: "Deactivated", tone: "neutral" };
  if (item.onHandQty < 0) return { label: "Count needed", tone: "danger" };
  if (item.onHandQty === 0) return { label: "Out of stock", tone: "danger" };
  if (item.onHandQty <= item.reorderThreshold) {
    return { label: "Low stock", tone: "warning" };
  }
  return { label: "In stock", tone: "success" };
}

/** Where this medicine's record stands with the server. */
function getSyncStatus(item: PharmacyItem): { label: string; tone: Tone } | null {
  if (item.localOnly === 1) return { label: "This device only", tone: "neutral" };
  if (item.registerRejected) return { label: "Refused by the server", tone: "danger" };
  if (item.pendingRegister === 1) return { label: "Waiting to sync", tone: "warning" };
  return null;
}

function getExpiryStatus(expiryDate: string): { label: string; tone: Tone } {
  const now = new Date();
  const expiry = new Date(expiryDate);
  const sixMonthsFromNow = new Date(
    now.getTime() + 6 * 30 * 24 * 60 * 60 * 1000,
  );

  if (expiry < now) return { label: "Expired", tone: "danger" };
  if (expiry <= sixMonthsFromNow) {
    return { label: "Expires within 6 months", tone: "warning" };
  }
  return { label: "In date", tone: "success" };
}

async function loadStock(): Promise<StockSnapshot> {
  try {
    const [itemsData, batchesData, discrepancies, unsynced, awaitingAuthorised] =
      await Promise.all([
        mbhrDb.pharmacy_items.orderBy("medName").toArray(),
        mbhrDb.pharmacy_batches.toArray(),
        mbhrDb.stock_discrepancies.where("status").equals("open").toArray(),
        countPharmacyUnsynced(),
        countPharmacyAwaitingAuthorised(),
      ]);

    const now = new Date();
    const sixMonthsFromNow = new Date(
      now.getTime() + 6 * 30 * 24 * 60 * 60 * 1000,
    );
    const items: ItemWithBatches[] = itemsData.map((item) => {
      const itemBatches = batchesData.filter((batch) => batch.itemId === item.id);
      const expiredBatches = itemBatches.filter(
        (batch) => new Date(batch.expiryDate) < now,
      ).length;
      const expiringSoonBatches = itemBatches.filter((batch) => {
        const expiryDate = new Date(batch.expiryDate);
        return expiryDate >= now && expiryDate <= sixMonthsFromNow;
      }).length;
      const earliestExpiry = itemBatches
        .filter((batch) => batch.qtyOnHand > 0)
        .sort(
          (a, b) =>
            new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime(),
        )[0]?.expiryDate;
      return {
        ...item,
        batches: itemBatches.sort(
          (a, b) =>
            new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime(),
        ),
        totalBatches: itemBatches.length,
        earliestExpiry,
        expiredBatches,
        expiringSoonBatches,
      };
    });

    return {
      items,
      discrepancies,
      localOnlyItems: itemsData.filter((i) => i.localOnly === 1).length,
      localOnlyLots: batchesData.filter((b) => b.localOnly === 1).length,
      unsynced,
      awaitingAuthorised,
    };
  } catch (error) {
    console.error(
      "Error loading pharmacy data:",
      error instanceof Error ? error.name : "unknown",
    );
    return {
      items: [],
      discrepancies: [],
      localOnlyItems: 0,
      localOnlyLots: 0,
      unsynced: 0,
      awaitingAuthorised: 0,
      error: "Stock could not be read from this device. Reload the page and try again.",
    };
  }
}

function actionErrorText(error: unknown, fallback: string): string {
  const name = error instanceof Error ? error.name : "";
  switch (name) {
    case "NotAllowed":
      return "Only pharmacists and administrators can change stock.";
    case "Offline":
      return "This needs a connection to the server. Try again when online.";
    case "NoOnlineSignIn":
      return "Sign in online with your own account first, then try again.";
    case "ClaimedElsewhere":
      return "Opening stock for this site was already uploaded from another device. Use the server's stock instead.";
    case "RemoteReadFailed":
    case "RemoteWriteFailed":
    case "RemoteRejected":
      return "The server could not be reached or refused the request. Nothing was changed; try again.";
    case "InvalidLot":
      return error instanceof Error ? error.message : fallback;
    default:
      return fallback;
  }
}

export default function PharmacyStock() {
  const { currentUser } = useAuthStore();
  const { push: pushToast } = useToast();
  const snapshot = useLiveQuery(loadStock, []);
  const [filteredItems, setFilteredItems] = useState<ItemWithBatches[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddItem, setShowAddItem] = useState(false);
  const [showAddBatch, setShowAddBatch] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [formError, setFormError] = useState("");
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [syncing, setSyncing] = useState(false);
  const [onboarding, setOnboarding] = useState<"" | "upload" | "discard">("");
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [siteClaim, setSiteClaim] = useState<SiteClaim | null>(null);
  const [countTarget, setCountTarget] = useState<PharmacyBatch | null>(null);
  const [countForm, setCountForm] = useState(EMPTY_COUNT_FORM);
  const [isSubmittingCount, setIsSubmittingCount] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // Form states
  const [itemForm, setItemForm] = useState(EMPTY_ITEM_FORM);
  const [isSubmittingItem, setIsSubmittingItem] = useState(false);
  const [isSubmittingBatch, setIsSubmittingBatch] = useState(false);
  const [batchForm, setBatchForm] = useState(EMPTY_BATCH_FORM);

  const canManageStock = !!currentUser && can(currentUser.role, "inventory");
  const actor = currentUser ? { id: currentUser.id, role: currentUser.role } : null;
  const items = useMemo(() => snapshot?.items ?? [], [snapshot]);
  const loadError = snapshot?.error ?? "";
  const serverReachable = ledgerEnabled && online;

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    let filtered = items;

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (item) =>
          item.medName.toLowerCase().includes(query) ||
          item.strength.toLowerCase().includes(query) ||
          item.form.toLowerCase().includes(query),
      );
    }

    // Apply type filter
    switch (filterType) {
      case "low_stock":
        filtered = filtered.filter(
          (item) => isActiveItem(item) && item.onHandQty <= item.reorderThreshold,
        );
        break;
      case "expired":
        filtered = filtered.filter((item) => item.expiredBatches > 0);
        break;
      case "expiring_soon":
        filtered = filtered.filter((item) => item.expiringSoonBatches > 0);
        break;
    }

    setFilteredItems(filtered);
  }, [items, searchQuery, filterType]);

  const resetItemForm = () => {
    setItemForm(EMPTY_ITEM_FORM);
    setFormError("");
  };

  const resetBatchForm = () => {
    setBatchForm(EMPTY_BATCH_FORM);
    setFormError("");
  };

  const closeAddItem = () => {
    setShowAddItem(false);
    resetItemForm();
  };

  const closeAddBatch = () => {
    setShowAddBatch(null);
    resetBatchForm();
  };

  const closeCount = () => {
    setCountTarget(null);
    setCountForm(EMPTY_COUNT_FORM);
    setFormError("");
  };

  // Queued changes are sent in the background (and only while someone is
  // signed in online), so never claim they were sent.
  const whereSaved = (queued: boolean) =>
    queued
      ? serverReachable
        ? "Saved on this device, waiting for the server to confirm it."
        : "Saved on this device. The server confirms it at the next sync."
      : "Saved on this device.";

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!currentUser || !can(currentUser.role, "inventory")) {
      setFormError("Only pharmacists and administrators can add medicines.");
      return;
    }

    if (!itemForm.medName.trim()) {
      setFormError("Enter the medicine name.");
      return;
    }

    if (isSubmittingItem) return;
    setIsSubmittingItem(true);

    try {
      const newItem = await addMedicine(
        {
          medName: itemForm.medName.trim(),
          form: itemForm.form,
          strength: itemForm.strength.trim(),
          unit: itemForm.unit,
          reorderThreshold: itemForm.reorderThreshold,
          isControlled: itemForm.isControlled,
        },
        actor,
      );
      pushToast({
        id: generateId(),
        tone: "success",
        title: "Medicine added",
        body: `${newItem.medName} ${newItem.strength}. ${whereSaved(newItem.localOnly !== 1)} Add a lot to record stock.`,
      });
      setShowAddItem(false);
      resetItemForm();
    } catch (error) {
      console.error(
        "Error adding item:",
        error instanceof Error ? error.name : "unknown",
      );
      setFormError(actionErrorText(error, "The medicine was not added. Try again."));
    } finally {
      setIsSubmittingItem(false);
    }
  };

  const handleAddBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (!currentUser || !can(currentUser.role, "inventory")) {
      setFormError("Only pharmacists and administrators can add stock.");
      return;
    }

    const problem = showAddBatch
      ? receiveProblem({
          lotNumber: batchForm.lotNumber,
          qty: batchForm.qtyOnHand,
          expiryDate: batchForm.expiryDate,
        })
      : "Choose a medicine first.";
    if (problem) {
      setFormError(problem);
      return;
    }

    if (isSubmittingBatch || !showAddBatch) return;
    setIsSubmittingBatch(true);

    try {
      const result = await receiveStock(
        {
          itemId: showAddBatch,
          lotNumber: batchForm.lotNumber,
          qty: batchForm.qtyOnHand,
          expiryDate: batchForm.expiryDate,
          supplier: batchForm.supplier,
        },
        actor,
      );
      const medName = items.find((i) => i.id === showAddBatch)?.medName ?? "";
      pushToast({
        id: generateId(),
        tone: "success",
        title: "Lot added",
        body: `${batchForm.qtyOnHand} added to ${medName} (lot ${batchForm.lotNumber.trim()}). ${whereSaved(result.kind === "queued")}`,
      });
      setShowAddBatch(null);
      resetBatchForm();
    } catch (error) {
      console.error(
        "Error adding batch:",
        error instanceof Error ? error.name : "unknown",
      );
      setFormError(
        actionErrorText(error, "The lot was not added and stock is unchanged. Try again."),
      );
    } finally {
      setIsSubmittingBatch(false);
    }
  };

  const handleCount = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!currentUser || !can(currentUser.role, "inventory")) {
      setFormError("Only pharmacists and administrators can record a count.");
      return;
    }
    if (!countTarget || !Number.isInteger(countForm.counted) || countForm.counted < 0) {
      setFormError("Enter the counted quantity: a whole number, 0 or more.");
      return;
    }
    if (isSubmittingCount) return;
    setIsSubmittingCount(true);
    try {
      const result = await adjustStock(
        {
          batchId: countTarget.id,
          counted: countForm.counted,
          reason: countForm.reason,
          note: countForm.note.trim() || undefined,
        },
        actor,
      );
      if (result.kind === "unchanged") {
        pushToast({
          id: generateId(),
          tone: "info",
          title: "No change",
          body: `Lot ${countTarget.lotNumber} already shows ${countForm.counted}.`,
        });
      } else {
        await createAuditLog(
          currentUser.role,
          countForm.reason === "expire" ? "pharmacy_lot_write_off" : "pharmacy_lot_count",
          "pharmacy_batch",
          countTarget.id,
        ).catch(() => undefined);
        pushToast({
          id: generateId(),
          tone: "success",
          title: countForm.reason === "expire" ? "Expired stock written off" : "Count recorded",
          body: `Lot ${countTarget.lotNumber} now ${countForm.counted}. ${whereSaved(result.kind === "queued")}`,
        });
      }
      closeCount();
    } catch (error) {
      console.error("Error recording count:", error instanceof Error ? error.name : "unknown");
      setFormError(actionErrorText(error, "The count was not recorded and stock is unchanged. Try again."));
    } finally {
      setIsSubmittingCount(false);
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    const target = items.find((i) => i.id === itemId);
    const medName = target?.medName ?? "";
    if (!currentUser || !can(currentUser.role, "inventory")) {
      setConfirmDeleteId(null);
      pushToast({
        id: generateId(),
        tone: "error",
        title: "Not changed",
        body: "Only pharmacists and administrators can remove medicines.",
      });
      return;
    }

    setDeleting(true);
    try {
      if (target?.localOnly === 1) {
        await deleteLocalMedicine(itemId, actor);
        await createAuditLog(currentUser.role, "pharmacy_item_delete", "pharmacy_item", itemId).catch(
          () => undefined,
        );
        if (selectedItem === itemId) setSelectedItem(null);
        pushToast({
          id: generateId(),
          tone: "success",
          title: "Medicine deleted",
          body: `${medName} and its lots were removed from this device.`,
        });
      } else {
        const active = !(target && isActiveItem(target));
        const mode = await setMedicineActive(itemId, active, actor);
        await createAuditLog(
          currentUser.role,
          active ? "pharmacy_item_reactivate" : "pharmacy_item_deactivate",
          "pharmacy_item",
          itemId,
        ).catch(() => undefined);
        pushToast({
          id: generateId(),
          tone: "success",
          title: active ? "Medicine reactivated" : "Medicine deactivated",
          body: `${medName}. ${whereSaved(mode === "queued")}`,
        });
      }
    } catch (error) {
      console.error(
        "Error removing item:",
        error instanceof Error ? error.name : "unknown",
      );
      pushToast({
        id: generateId(),
        tone: "error",
        title: "Not changed",
        body: `${medName} is unchanged. ${actionErrorText(error, "Try again.")}`,
      });
    } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
    }
  };

  const handleSyncNow = async () => {
    if (!pharmacyServerReachable()) return;
    setSyncing(true);
    try {
      const result = await syncPharmacyNow();
      if (!result.ran) {
        pushToast({
          id: generateId(),
          tone: "warning",
          title: "Not synced",
          body: "Sign in online with your own account to sync pharmacy stock.",
        });
      } else if (result.failedTables.length > 0) {
        pushToast({
          id: generateId(),
          tone: "warning",
          title: "Sync incomplete",
          body: "Some stock could not be downloaded. Changes on this device are kept; try again.",
        });
      } else {
        const c = result.commands;
        const refused = c?.rejected ?? 0;
        const waiting = c
          ? c.retrying + c.unavailable + c.waitingPermission + c.notSender + c.deferred
          : 0;
        if (refused > 0) {
          pushToast({
            id: generateId(),
            tone: "warning",
            title: "Stock downloaded; some changes refused",
            body: `${refused} change${refused === 1 ? " was" : "s were"} refused by the server and undone on this device. ${
              refused === 1 ? "It is" : "They are"
            } listed under conflicts to review.`,
          });
        } else if (waiting > 0 || c?.skipped) {
          pushToast({
            id: generateId(),
            tone: "info",
            title: "Stock downloaded",
            body: "Some changes made on this device are still waiting to sync; the banner on this page shows how many.",
          });
        } else {
          pushToast({ id: generateId(), tone: "success", title: "Pharmacy stock synced" });
        }
      }
    } finally {
      setSyncing(false);
    }
  };

  const openOnboarding = async (kind: "upload" | "discard") => {
    setOnboarding(kind);
    setSiteClaim(null);
    try {
      setSiteClaim(await readSiteClaim());
    } catch {
      setSiteClaim(null);
    }
  };

  const handleOnboarding = async () => {
    if (!currentUser || !can(currentUser.role, "inventory") || !onboarding) {
      setOnboarding("");
      return;
    }
    setOnboardingBusy(true);
    try {
      if (onboarding === "upload") {
        const s = await uploadOpeningStock(actor);
        await createAuditLog(currentUser.role, "pharmacy_opening_stock_upload", "pharmacy_site", siteClaim?.siteKey ?? "").catch(
          () => undefined,
        );
        pushToast({
          id: generateId(),
          tone: "success",
          title: "Opening stock queued",
          body: `${s.medicines} medicines and ${s.lots} lots queued for the server${
            s.emptyLotsRemoved ? ` (${s.emptyLotsRemoved} empty lots removed)` : ""
          }. Check the "Waiting to sync" count reaches 0, then do a physical count.`,
        });
      } else {
        const s = await discardLocalStock(actor);
        await createAuditLog(currentUser.role, "pharmacy_local_stock_discard", "pharmacy_site", siteClaim?.siteKey ?? "").catch(
          () => undefined,
        );
        pushToast({
          id: generateId(),
          tone: "success",
          title: "Using the server's stock",
          body: `${s.medicines} medicines and ${s.lots} lots removed from this device.${
            s.unmatchedLines
              ? ` ${s.unmatchedLines} prescription line(s) name a medicine the server does not have; they cannot be dispensed until it is added.`
              : ""
          }`,
        });
      }
      setOnboarding("");
    } catch (error) {
      console.error("Error in opening stock:", error instanceof Error ? error.name : "unknown");
      pushToast({
        id: generateId(),
        tone: "error",
        title: "Nothing changed",
        body: actionErrorText(error, "The stock on this device is unchanged. Try again."),
      });
      setOnboarding("");
    } finally {
      setOnboardingBusy(false);
    }
  };

  const handleResolve = async (id: string) => {
    if (!currentUser || !can(currentUser.role, "inventory")) return;
    setResolvingId(id);
    try {
      await resolveDiscrepancy(id, actor);
      pushToast({ id: generateId(), tone: "success", title: "Discrepancy marked reconciled" });
    } catch (error) {
      pushToast({
        id: generateId(),
        tone: "error",
        title: "Not changed",
        body: actionErrorText(error, "Try again."),
      });
    } finally {
      setResolvingId(null);
    }
  };

  // Only pharmacists and admins can access
  if (!currentUser || !can(currentUser.role, "dispense")) {
    return (
      <div className="panel">
        <EmptyState
          icon={LockClosedIcon}
          title="Pharmacy stock is restricted"
          description="Only pharmacists and administrators can view pharmacy stock. Ask an administrator if you need access."
        />
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div>
        <PageHeader
          title="Pharmacy stock"
          description="Loading medicines and lots from this device…"
        />
        <PharmacySkeleton />
      </div>
    );
  }

  const activeItems = items.filter(isActiveItem);
  const lowStockCount = activeItems.filter(
    (item) => item.onHandQty <= item.reorderThreshold,
  ).length;
  const expiredCount = items.reduce((sum, item) => sum + item.expiredBatches, 0);
  const expiringCount = items.reduce(
    (sum, item) => sum + item.expiringSoonBatches,
    0,
  );
  const selected = items.find((i) => i.id === selectedItem);
  const batchTarget = items.find((i) => i.id === showAddBatch);
  const deleteTarget = items.find((i) => i.id === confirmDeleteId);
  const itemName = (id: string) => {
    const i = items.find((x) => x.id === id);
    return i ? `${i.medName} ${i.strength}`.trim() : "Unknown medicine";
  };
  const localOnlyStock = snapshot.localOnlyItems + snapshot.localOnlyLots;

  const stats: Array<{
    label: string;
    value: number;
    tone: Tone | null;
  }> = [
    { label: "Medicines", value: activeItems.length, tone: null },
    {
      label: "Low stock",
      value: lowStockCount,
      tone: lowStockCount > 0 ? "warning" : null,
    },
    {
      label: "Expired lots",
      value: expiredCount,
      tone: expiredCount > 0 ? "danger" : null,
    },
    {
      label: "Lots expiring within 6 months",
      value: expiringCount,
      tone: expiringCount > 0 ? "warning" : null,
    },
  ];

  const rowActions = (item: ItemWithBatches) => {
    const name = `${item.medName} ${item.strength}`.trim();
    const expanded = selectedItem === item.id;
    const active = isActiveItem(item);
    return (
      <div className="flex justify-end gap-1">
        {canManageStock && active && (
          <button
            type="button"
            onClick={() => {
              setFormError("");
              setShowAddBatch(item.id);
            }}
            className="btn-ghost px-2"
            aria-label={`Add a lot of ${name}`}
            title="Add lot"
          >
            <PlusIcon className="h-5 w-5" aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={() => setSelectedItem(expanded ? null : item.id)}
          className="btn-ghost px-2"
          aria-expanded={expanded}
          aria-controls={expanded ? "batch-details" : undefined}
          aria-label={`${expanded ? "Hide" : "Show"} lots of ${name}`}
          title={expanded ? "Hide lots" : "Show lots"}
        >
          {expanded ? (
            <ChevronUpIcon className="h-5 w-5" aria-hidden />
          ) : (
            <ChevronDownIcon className="h-5 w-5" aria-hidden />
          )}
        </button>
        {canManageStock &&
          (item.localOnly === 1 ? (
            <button
              type="button"
              onClick={() => setConfirmDeleteId(item.id)}
              className="btn-ghost px-2 text-danger-fg hover:bg-danger-soft hover:text-danger-fg"
              aria-label={`Delete ${name} from this device`}
              title="Delete medicine"
            >
              <TrashIcon className="h-5 w-5" aria-hidden />
            </button>
          ) : active ? (
            <button
              type="button"
              onClick={() => setConfirmDeleteId(item.id)}
              className="btn-ghost px-2 text-danger-fg hover:bg-danger-soft hover:text-danger-fg"
              aria-label={`Deactivate ${name}`}
              title="Deactivate medicine"
            >
              <ArchiveBoxXMarkIcon className="h-5 w-5" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDeleteId(item.id)}
              className="btn-ghost px-2"
              aria-label={`Reactivate ${name}`}
              title="Reactivate medicine"
            >
              <ArrowUturnLeftIcon className="h-5 w-5" aria-hidden />
            </button>
          ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pharmacy stock"
        description={
          ledgerEnabled
            ? "Medicines by lot and expiry date. The server keeps the stock balance; changes made here count once the server confirms them."
            : "Medicines by lot and expiry date, stored on this device only (no server is set up)."
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {ledgerEnabled && (
              <button
                type="button"
                onClick={handleSyncNow}
                disabled={!online || syncing}
                className="btn-secondary"
              >
                <ArrowPathIcon className="h-5 w-5" aria-hidden />
                {syncing ? "Syncing…" : online ? "Sync stock now" : "Offline"}
              </button>
            )}
            {canManageStock && (
            <button
              type="button"
              onClick={() => {
                setFormError("");
                setShowAddItem(true);
              }}
              className="btn-primary"
            >
              <PlusIcon className="h-5 w-5" aria-hidden />
              Add medicine
            </button>
            )}
          </div>
        }
      />

      {loadError && (
        <div className="banner banner-danger" role="alert">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
          <span>{loadError}</span>
        </div>
      )}

      {ledgerEnabled && (snapshot.unsynced > 0 || snapshot.awaitingAuthorised > 0 || !online) && (
        <div className="banner banner-warning" role="status" aria-live="polite">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
          <span>
            {!online && "Offline: stock changes are saved on this device and confirmed by the server when it syncs. "}
            {snapshot.unsynced > 0 &&
              `${snapshot.unsynced} pharmacy change${snapshot.unsynced === 1 ? "" : "s"} waiting to sync. `}
            {snapshot.awaitingAuthorised > 0 &&
              `${snapshot.awaitingAuthorised} waiting for an authorised person to sync.`}
          </span>
        </div>
      )}

      {canManageStock && localOnlyStock > 0 && (
        <section className="panel" aria-labelledby="opening-stock-title">
          <div className="panel-header">
            <h2 id="opening-stock-title" className="panel-title">
              Stock kept only on this device
            </h2>
          </div>
          <div className="panel-body space-y-3 text-body text-ink-secondary">
            <p>
              {snapshot.localOnlyItems} medicine{snapshot.localOnlyItems === 1 ? "" : "s"} and{" "}
              {snapshot.localOnlyLots} lot{snapshot.localOnlyLots === 1 ? "" : "s"} were recorded before the server
              kept the stock (or with no server set up). They are not on the server and other devices cannot see them.
            </p>
            {ledgerEnabled ? (
              <>
                <p>
                  On <strong className="text-ink">one device per site</strong>, upload them as the site's opening
                  stock. On every other device, use the server's stock instead so nothing is counted twice. Then do a
                  physical count of each lot.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!online}
                    onClick={() => openOnboarding("upload")}
                  >
                    <CloudArrowUpIcon className="h-5 w-5" aria-hidden />
                    Upload as opening stock
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!online}
                    onClick={() => openOnboarding("discard")}
                  >
                    Use the server's stock instead
                  </button>
                </div>
                {!online && (
                  <p className="field-hint">Both need a connection to the server.</p>
                )}
              </>
            ) : (
              <p>No server is set up, so this stock stays on this device.</p>
            )}
          </div>
        </section>
      )}

      {snapshot.discrepancies.length > 0 && (
        <section className="panel" aria-labelledby="discrepancies-title">
          <div className="panel-header">
            <h2 id="discrepancies-title" className="panel-title">
              Stock discrepancies ({snapshot.discrepancies.length})
            </h2>
          </div>
          <p className="border-b border-line px-4 py-3 text-body text-ink-secondary">
            Medicine was handed over offline beyond what the server held. Count the lots, record the count, then mark
            each one reconciled.
            {canManageStock && !online && " Marking one reconciled needs a connection to the server."}
          </p>
          <ul className="divide-y divide-line">
            {snapshot.discrepancies.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="text-body text-ink">
                  <StatusBadge tone="warning">Not covered</StatusBadge>{" "}
                  {d.qtyUncovered} × {itemName(d.itemId)}
                  {d.createdAt ? ` · ${formatNigerianDate(d.createdAt)}` : ""}
                </span>
                {canManageStock && (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!online || resolvingId === d.id}
                    onClick={() => handleResolve(d.id)}
                  >
                    <ClipboardDocumentCheckIcon className="h-5 w-5" aria-hidden />
                    {resolvingId === d.id ? "Saving…" : "Mark reconciled"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Summary (hidden when stock could not be read, so no false zeros) */}
      {!loadError && (
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="card p-4">
              <dt className="section-label">{stat.label}</dt>
              <dd className="mt-1 flex items-center gap-2">
                <span className="text-stat tabular-nums text-ink">
                  {stat.value}
                </span>
                {stat.tone && (
                  <StatusBadge tone={stat.tone}>Needs attention</StatusBadge>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <section className="panel" aria-label="Medicines">
        {/* Filters and search */}
        <div className="flex flex-col gap-3 border-b border-line p-3 lg:flex-row lg:items-center lg:justify-between">
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Filter medicines"
          >
            {FILTERS.map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => setFilterType(filter.key)}
                aria-pressed={filterType === filter.key}
                className={`min-h-touch-target rounded-md border px-3 py-1.5 text-label transition-colors ${
                  filterType === filter.key
                    ? "border-primary bg-primary-soft text-primary-fg"
                    : "border-line bg-surface text-ink-secondary hover:bg-surface-hover"
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <div className="relative lg:w-72">
            <label htmlFor="pharmacy-stock-search" className="sr-only">
              Search medicines
            </label>
            <MagnifyingGlassIcon
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted"
              aria-hidden
            />
            <input
              id="pharmacy-stock-search"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-field pl-9"
              placeholder="Search by name, strength or form"
            />
          </div>
        </div>

        <p className="sr-only" role="status" aria-live="polite">
          {filteredItems.length} medicine
          {filteredItems.length === 1 ? "" : "s"} shown
        </p>

        {filteredItems.length === 0 ? (
          loadError ? null : (
            <EmptyState
              icon={BeakerIcon}
              title={
                items.length === 0
                  ? "No medicines recorded yet"
                  : "No medicines match"
              }
              description={
                items.length === 0
                  ? canManageStock
                    ? "Add a medicine, then add a lot with its quantity and expiry date."
                    : "A pharmacist or administrator needs to add medicines."
                  : "Try a different search or filter."
              }
            />
          )
        ) : (
          <>
            {/* Tablet and desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Medicine</th>
                    <th scope="col" className="text-right">
                      On hand
                    </th>
                    <th scope="col">Status</th>
                    <th scope="col" className="text-right">
                      Lots
                    </th>
                    <th scope="col">Next expiry</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => {
                    const status = getStockStatus(item);
                    const expiry = item.earliestExpiry
                      ? getExpiryStatus(item.earliestExpiry)
                      : null;
                    return (
                      <tr key={item.id}>
                        <td>
                          <div className="font-medium text-ink">
                            {item.medName} {item.strength}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-caption text-ink-muted">
                            <span>
                              {item.form} · {item.unit}
                            </span>
                            {item.isControlled && (
                              <StatusBadge tone="warning">
                                Controlled
                              </StatusBadge>
                            )}
                          </div>
                        </td>
                        <td className="text-right tabular-nums">
                          <div className="font-medium text-ink">
                            {item.onHandQty}
                          </div>
                          <div className="text-caption text-ink-muted">
                            Reorder at {item.reorderThreshold}
                          </div>
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            <StatusBadge tone={status.tone} icon>
                              {status.label}
                            </StatusBadge>
                            {getSyncStatus(item) && (
                              <StatusBadge tone={getSyncStatus(item)!.tone} icon>
                                {getSyncStatus(item)!.label}
                              </StatusBadge>
                            )}
                          </div>
                        </td>
                        <td className="text-right tabular-nums">
                          <div className="text-ink">{item.totalBatches}</div>
                          {(item.expiredBatches > 0 ||
                            item.expiringSoonBatches > 0) && (
                            <div className="text-caption">
                              {item.expiredBatches > 0 && (
                                <span className="block text-danger-fg">
                                  {item.expiredBatches} expired
                                </span>
                              )}
                              {item.expiringSoonBatches > 0 && (
                                <span className="block text-warning-fg">
                                  {item.expiringSoonBatches} expiring
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td>
                          {item.earliestExpiry && expiry ? (
                            <div className="space-y-1">
                              <div className="tabular-nums text-ink">
                                {formatNigerianDate(item.earliestExpiry)}
                              </div>
                              <StatusBadge tone={expiry.tone}>
                                {expiry.label}
                              </StatusBadge>
                            </div>
                          ) : (
                            <span className="text-ink-muted">No stock</span>
                          )}
                        </td>
                        <td className="text-right">{rowActions(item)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Phone list */}
            <ul className="divide-y divide-line md:hidden">
              {filteredItems.map((item) => {
                const status = getStockStatus(item);
                return (
                  <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="font-medium text-ink">
                        {item.medName} {item.strength}
                      </p>
                      <p className="text-caption tabular-nums text-ink-muted">
                        {item.onHandQty} {item.unit} · reorder at{" "}
                        {item.reorderThreshold} · {item.totalBatches} lot
                        {item.totalBatches === 1 ? "" : "s"}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        <StatusBadge tone={status.tone} icon>
                          {status.label}
                        </StatusBadge>
                        {getSyncStatus(item) && (
                          <StatusBadge tone={getSyncStatus(item)!.tone} icon>
                            {getSyncStatus(item)!.label}
                          </StatusBadge>
                        )}
                        {item.isControlled && (
                          <StatusBadge tone="warning">Controlled</StatusBadge>
                        )}
                        {item.expiredBatches > 0 && (
                          <StatusBadge tone="danger">
                            {item.expiredBatches} expired
                          </StatusBadge>
                        )}
                        {item.expiringSoonBatches > 0 && (
                          <StatusBadge tone="warning">
                            {item.expiringSoonBatches} expiring
                          </StatusBadge>
                        )}
                        {item.earliestExpiry && (
                          <span className="text-caption text-ink-muted">
                            Next expiry{" "}
                            {formatNigerianDate(item.earliestExpiry)}
                          </span>
                        )}
                      </div>
                    </div>
                    {rowActions(item)}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {/* Batch Details */}
      {selected && (
        <section
          id="batch-details"
          className="panel"
          aria-labelledby="batch-details-title"
        >
          <div className="panel-header">
            <h2 id="batch-details-title" className="panel-title">
              Lots · {selected.medName} {selected.strength}
            </h2>
            <button
              type="button"
              onClick={() => setSelectedItem(null)}
              className="btn-ghost"
            >
              Close
            </button>
          </div>
          {selected.batches.length === 0 ? (
            <EmptyState
              title="No lots recorded"
              description={
                canManageStock
                  ? "Add a lot with its quantity and expiry date to record stock."
                  : "A pharmacist or administrator needs to add a lot."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Lot number</th>
                    <th scope="col" className="text-right">
                      Quantity
                    </th>
                    <th scope="col">Expiry date</th>
                    <th scope="col">Status</th>
                    <th scope="col">Supplier</th>
                    {canManageStock && (
                      <th scope="col">
                        <span className="sr-only">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {selected.batches.map((batch) => {
                    const expiryStatus = getExpiryStatus(batch.expiryDate);
                    return (
                      <tr key={batch.id}>
                        <td className="font-mono font-medium">
                          {batch.lotNumber}
                        </td>
                        <td className="text-right tabular-nums">
                          {batch.qtyOnHand}
                        </td>
                        <td className="tabular-nums">
                          {formatNigerianDate(batch.expiryDate)}
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            <StatusBadge tone={expiryStatus.tone} icon>
                              {expiryStatus.label}
                            </StatusBadge>
                            {batch.localOnly === 1 ? (
                              <StatusBadge tone="neutral">This device only</StatusBadge>
                            ) : batch.serverQtyOnHand === undefined ? (
                              <StatusBadge tone="warning">Waiting to sync</StatusBadge>
                            ) : batch.qtyOnHand !== batch.serverQtyOnHand ? (
                              <StatusBadge tone="warning">
                                Changes waiting to sync (server: {batch.serverQtyOnHand})
                              </StatusBadge>
                            ) : null}
                          </div>
                        </td>
                        <td className="text-ink-secondary">
                          {batch.supplier || "—"}
                        </td>
                        {canManageStock && (
                          <td className="text-right">
                            <button
                              type="button"
                              className="btn-ghost"
                              onClick={() => {
                                setFormError("");
                                setCountForm({
                                  ...EMPTY_COUNT_FORM,
                                  counted: Math.max(0, batch.qtyOnHand),
                                  reason: expiryStatus.label === "Expired" ? "expire" : "adjust",
                                });
                                setCountTarget(batch);
                              }}
                              aria-label={`Record a count for lot ${batch.lotNumber}`}
                            >
                              Count
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Add Item dialog */}
      {showAddItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-medicine-title"
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-line bg-surface shadow-xl"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !isSubmittingItem) closeAddItem();
            }}
          >
            <div className="panel-header">
              <h2 id="add-medicine-title" className="panel-title">
                Add medicine
              </h2>
            </div>
            <form
              onSubmit={handleAddItem}
              className="panel-body space-y-4"
              noValidate
            >
              {formError && (
                <div className="banner banner-danger" role="alert">
                  <ExclamationTriangleIcon
                    className="h-5 w-5 shrink-0"
                    aria-hidden
                  />
                  <span>{formError}</span>
                </div>
              )}
              <div>
                <label htmlFor="ps-medName" className="field-label">
                  Medicine name *
                </label>
                <input
                  id="ps-medName"
                  type="text"
                  required
                  autoFocus
                  value={itemForm.medName}
                  onChange={(e) =>
                    setItemForm({ ...itemForm, medName: e.target.value })
                  }
                  className="input-field"
                  placeholder="e.g. Paracetamol"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="ps-form" className="field-label">
                    Form
                  </label>
                  <select
                    id="ps-form"
                    value={itemForm.form}
                    onChange={(e) =>
                      setItemForm({ ...itemForm, form: e.target.value })
                    }
                    className="input-field"
                  >
                    <option value="tablet">Tablet</option>
                    <option value="capsule">Capsule</option>
                    <option value="syrup">Syrup</option>
                    <option value="injection">Injection</option>
                    <option value="cream">Cream</option>
                    <option value="drops">Drops</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="ps-strength" className="field-label">
                    Strength
                  </label>
                  <input
                    id="ps-strength"
                    type="text"
                    value={itemForm.strength}
                    onChange={(e) =>
                      setItemForm({ ...itemForm, strength: e.target.value })
                    }
                    className="input-field"
                    placeholder="e.g. 500 mg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="ps-unit" className="field-label">
                    Unit
                  </label>
                  <select
                    id="ps-unit"
                    value={itemForm.unit}
                    onChange={(e) =>
                      setItemForm({ ...itemForm, unit: e.target.value })
                    }
                    className="input-field"
                  >
                    <option value="tablets">Tablets</option>
                    <option value="capsules">Capsules</option>
                    <option value="bottles">Bottles</option>
                    <option value="vials">Vials</option>
                    <option value="tubes">Tubes</option>
                    <option value="boxes">Boxes</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="ps-reorder" className="field-label">
                    Reorder at
                  </label>
                  <input
                    id="ps-reorder"
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={itemForm.reorderThreshold}
                    onChange={(e) =>
                      setItemForm({
                        ...itemForm,
                        reorderThreshold: parseInt(e.target.value) || 0,
                      })
                    }
                    className="input-field tabular-nums"
                    aria-describedby="ps-reorder-hint"
                  />
                  <p id="ps-reorder-hint" className="field-hint">
                    Marked low stock at or below this quantity.
                  </p>
                </div>
              </div>

              <div className="flex min-h-touch-target items-center gap-3">
                <input
                  type="checkbox"
                  id="isControlled"
                  checked={itemForm.isControlled}
                  onChange={(e) =>
                    setItemForm({ ...itemForm, isControlled: e.target.checked })
                  }
                  className="h-5 w-5 rounded border-line-strong text-primary focus:ring-primary"
                />
                <label htmlFor="isControlled" className="text-body text-ink">
                  Controlled substance
                </label>
              </div>

              <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeAddItem}
                  disabled={isSubmittingItem}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingItem}
                  className="btn-primary"
                >
                  {isSubmittingItem ? "Adding…" : "Add medicine"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Batch dialog */}
      {showAddBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-lot-title"
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-line bg-surface shadow-xl"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !isSubmittingBatch) closeAddBatch();
            }}
          >
            <div className="panel-header">
              <h2 id="add-lot-title" className="panel-title">
                Add lot · {batchTarget?.medName} {batchTarget?.strength}
              </h2>
            </div>
            <form
              onSubmit={handleAddBatch}
              className="panel-body space-y-4"
              noValidate
            >
              {formError && (
                <div className="banner banner-danger" role="alert">
                  <ExclamationTriangleIcon
                    className="h-5 w-5 shrink-0"
                    aria-hidden
                  />
                  <span>{formError}</span>
                </div>
              )}
              <div>
                <label htmlFor="ps-lot" className="field-label">
                  Lot number *
                </label>
                <input
                  id="ps-lot"
                  type="text"
                  required
                  autoFocus
                  value={batchForm.lotNumber}
                  onChange={(e) =>
                    setBatchForm({ ...batchForm, lotNumber: e.target.value })
                  }
                  className="input-field"
                  placeholder="As printed on the pack"
                />
              </div>

              <div>
                <label htmlFor="ps-qty" className="field-label">
                  Quantity received *
                </label>
                <input
                  id="ps-qty"
                  type="number"
                  required
                  min="1"
                  inputMode="numeric"
                  value={batchForm.qtyOnHand}
                  onChange={(e) =>
                    setBatchForm({
                      ...batchForm,
                      qtyOnHand: parseInt(e.target.value) || 0,
                    })
                  }
                  className="input-field tabular-nums"
                />
              </div>

              <div>
                <label htmlFor="ps-expiry" className="field-label">
                  Expiry date *
                </label>
                <input
                  id="ps-expiry"
                  type="date"
                  required
                  value={batchForm.expiryDate}
                  onChange={(e) =>
                    setBatchForm({ ...batchForm, expiryDate: e.target.value })
                  }
                  className="input-field"
                />
              </div>

              <div>
                <label htmlFor="ps-supplier" className="field-label">
                  Supplier
                </label>
                <input
                  id="ps-supplier"
                  type="text"
                  value={batchForm.supplier}
                  onChange={(e) =>
                    setBatchForm({ ...batchForm, supplier: e.target.value })
                  }
                  className="input-field"
                  placeholder="Optional"
                />
              </div>

              <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeAddBatch}
                  disabled={isSubmittingBatch}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingBatch}
                  className="btn-primary"
                >
                  {isSubmittingBatch ? "Adding…" : "Add lot"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete / deactivate / reactivate confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-medicine-title"
            aria-describedby="delete-medicine-desc"
            className="w-full max-w-md rounded-lg border border-line bg-surface p-6 shadow-xl"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !deleting) setConfirmDeleteId(null);
            }}
          >
            {deleteTarget.localOnly === 1 ? (
              <>
                <h2 id="delete-medicine-title" className="text-h2 text-ink">
                  Delete {deleteTarget.medName} {deleteTarget.strength}?
                </h2>
                <div
                  id="delete-medicine-desc"
                  className="mt-2 space-y-2 text-body text-ink-secondary"
                >
                  <p>
                    This removes the medicine and its {deleteTarget.totalBatches}{" "}
                    lot{deleteTarget.totalBatches === 1 ? "" : "s"} (
                    {deleteTarget.onHandQty} {deleteTarget.unit} on hand) from
                    stock on this device. It is not on the server.
                  </p>
                  <p className="font-medium text-danger-fg">
                    This cannot be undone.
                  </p>
                </div>
              </>
            ) : isActiveItem(deleteTarget) ? (
              <>
                <h2 id="delete-medicine-title" className="text-h2 text-ink">
                  Deactivate {deleteTarget.medName} {deleteTarget.strength}?
                </h2>
                <div
                  id="delete-medicine-desc"
                  className="mt-2 space-y-2 text-body text-ink-secondary"
                >
                  <p>
                    It will no longer be offered when prescribing. Its lots and
                    stock history are kept ({deleteTarget.onHandQty}{" "}
                    {deleteTarget.unit} on hand), and open prescriptions for it
                    can still be dispensed. You can reactivate it later.
                  </p>
                </div>
              </>
            ) : (
              <>
                <h2 id="delete-medicine-title" className="text-h2 text-ink">
                  Reactivate {deleteTarget.medName} {deleteTarget.strength}?
                </h2>
                <p
                  id="delete-medicine-desc"
                  className="mt-2 text-body text-ink-secondary"
                >
                  It will be offered when prescribing again.
                </p>
              </>
            )}
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                autoFocus
                onClick={() => setConfirmDeleteId(null)}
                disabled={deleting}
                className="btn-secondary"
              >
                Keep as it is
              </button>
              <button
                type="button"
                onClick={() => handleRemoveItem(deleteTarget.id)}
                disabled={deleting}
                className={
                  deleteTarget.localOnly !== 1 && !isActiveItem(deleteTarget)
                    ? "btn-primary"
                    : "btn-danger"
                }
              >
                {deleteTarget.localOnly === 1 ? (
                  <>
                    <TrashIcon className="h-4 w-4" aria-hidden />
                    {deleting ? "Deleting…" : "Delete medicine"}
                  </>
                ) : isActiveItem(deleteTarget) ? (
                  deleting ? "Deactivating…" : "Deactivate medicine"
                ) : deleting ? (
                  "Reactivating…"
                ) : (
                  "Reactivate medicine"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Count / write-off dialog */}
      {countTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="count-lot-title"
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border border-line bg-surface shadow-xl"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !isSubmittingCount) closeCount();
            }}
          >
            <div className="panel-header">
              <h2 id="count-lot-title" className="panel-title">
                Count lot {countTarget.lotNumber} · {itemName(countTarget.itemId)}
              </h2>
            </div>
            <form onSubmit={handleCount} className="panel-body space-y-4" noValidate>
              {formError && (
                <div className="banner banner-danger" role="alert">
                  <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
                  <span>{formError}</span>
                </div>
              )}
              <p className="text-body text-ink-secondary">
                This device shows {countTarget.qtyOnHand}. Enter what is physically on the shelf; the
                difference is recorded in the stock ledger.
              </p>
              <div>
                <label htmlFor="ps-counted" className="field-label">
                  Counted quantity *
                </label>
                <input
                  id="ps-counted"
                  type="number"
                  min="0"
                  inputMode="numeric"
                  required
                  autoFocus
                  value={countForm.counted}
                  onChange={(e) =>
                    setCountForm({ ...countForm, counted: parseInt(e.target.value, 10) || 0 })
                  }
                  className="input-field tabular-nums"
                />
              </div>
              <div>
                <label htmlFor="ps-count-reason" className="field-label">
                  Reason
                </label>
                <select
                  id="ps-count-reason"
                  value={countForm.reason}
                  onChange={(e) =>
                    setCountForm({
                      ...countForm,
                      reason: e.target.value === "expire" ? "expire" : "adjust",
                    })
                  }
                  className="input-field"
                >
                  <option value="adjust">Physical count</option>
                  <option value="expire">Expired stock written off</option>
                </select>
              </div>
              <div>
                <label htmlFor="ps-count-note" className="field-label">
                  Note
                </label>
                <input
                  id="ps-count-note"
                  type="text"
                  maxLength={200}
                  value={countForm.note}
                  onChange={(e) => setCountForm({ ...countForm, note: e.target.value })}
                  className="input-field"
                  placeholder="Optional, e.g. damaged packs"
                  aria-describedby="ps-count-note-hint"
                />
                <p id="ps-count-note-hint" className="field-hint">
                  About the stock only. Do not enter patient details.
                </p>
              </div>
              <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeCount}
                  disabled={isSubmittingCount}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button type="submit" disabled={isSubmittingCount} className="btn-primary">
                  {isSubmittingCount ? "Saving…" : "Record count"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={onboarding !== ""}
        title={
          onboarding === "upload"
            ? "Upload this device's stock as the site's opening stock?"
            : "Use the server's stock instead of this device's?"
        }
        confirmLabel={onboarding === "upload" ? "Upload opening stock" : "Remove this device's stock"}
        tone={onboarding === "upload" ? "primary" : "danger"}
        busy={onboardingBusy}
        busyLabel={onboarding === "upload" ? "Uploading…" : "Removing…"}
        onConfirm={handleOnboarding}
        onCancel={() => setOnboarding("")}
      >
        {onboarding === "upload" ? (
          <div className="space-y-2">
            <p>
              {snapshot.localOnlyItems} medicines and {snapshot.localOnlyLots} lots on this device become the
              opening stock{siteClaim ? ` for site "${siteClaim.siteKey}"` : ""}. Only one device per site may do
              this; the server refuses a second one.
            </p>
            {siteClaim?.claimedElsewhereAt && (
              <p className="flex items-start gap-2 font-medium text-danger-fg">
                <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
                Another device already uploaded this site's opening stock on{" "}
                {formatNigerianDate(siteClaim.claimedElsewhereAt)}. Use the server's stock instead.
              </p>
            )}
            <p>Open prescriptions on this device are uploaded too; dispensed ones are uploaded as history.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p>
              {snapshot.localOnlyItems} medicines and {snapshot.localOnlyLots} lots kept only on this device are
              removed, and the server's stock is used. Prescriptions are kept and uploaded.
            </p>
            <p className="flex items-start gap-2">
              <InformationCircleIcon className="h-5 w-5 shrink-0" aria-hidden />
              Do this only if another device uploaded this site's opening stock, or the stock here is not real.
            </p>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
