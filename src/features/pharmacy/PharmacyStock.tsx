import React, { useCallback, useEffect, useState } from "react";
import { db as mbhrDb, ulid } from "@/db/mbhr";
import { createAuditLog, generateId } from "@/db";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/stores/toast";
import { can } from "@/auth/roles";
import { formatNigerianDate } from "@/utils/dateFormat";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge, type Tone } from "@/components/ui/StatusBadge";
import { PharmacySkeleton } from "@/components/ui/Skeleton";
import {
  BeakerIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  TrashIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "@heroicons/react/24/outline";

interface PharmacyItem {
  id: string;
  medName: string;
  form: string;
  strength: string;
  unit: string;
  onHandQty: number;
  reorderThreshold: number;
  isControlled?: boolean;
  updatedAt: string;
}

interface PharmacyBatch {
  id: string;
  itemId: string;
  lotNumber: string;
  expiryDate: string;
  qtyOnHand: number;
  receivedAt: string;
  supplier?: string;
}

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

function getStockStatus(item: ItemWithBatches): { label: string; tone: Tone } {
  if (item.onHandQty === 0) return { label: "Out of stock", tone: "danger" };
  if (item.onHandQty <= item.reorderThreshold) {
    return { label: "Low stock", tone: "warning" };
  }
  return { label: "In stock", tone: "success" };
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

export default function PharmacyStock() {
  const { currentUser } = useAuthStore();
  const { push: pushToast } = useToast();
  const [items, setItems] = useState<ItemWithBatches[]>([]);
  const [filteredItems, setFilteredItems] = useState<ItemWithBatches[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showAddItem, setShowAddItem] = useState(false);
  const [showAddBatch, setShowAddBatch] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [, setEditingItem] = useState<PharmacyItem | null>(null);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<FilterType>("all");
  const [formError, setFormError] = useState("");

  // Form states
  const [itemForm, setItemForm] = useState(EMPTY_ITEM_FORM);
  const [isSubmittingItem, setIsSubmittingItem] = useState(false);
  const [isSubmittingBatch, setIsSubmittingBatch] = useState(false);
  const [batchForm, setBatchForm] = useState(EMPTY_BATCH_FORM);

  const canManageStock = !!currentUser && can(currentUser.role, "inventory");

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [itemsData, batchesData] = await Promise.all([
        mbhrDb.pharmacy_items.orderBy("medName").toArray(),
        mbhrDb.pharmacy_batches.toArray(),
      ]);

      const itemsWithBatches: ItemWithBatches[] = itemsData.map((item) => {
        const itemBatches = batchesData.filter(
          (batch) => batch.itemId === item.id,
        );
        const now = new Date();
        const sixMonthsFromNow = new Date(
          now.getTime() + 6 * 30 * 24 * 60 * 60 * 1000,
        );

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
              new Date(a.expiryDate).getTime() -
              new Date(b.expiryDate).getTime(),
          )[0]?.expiryDate;

        return {
          ...item,
          batches: itemBatches.sort(
            (a, b) =>
              new Date(a.expiryDate).getTime() -
              new Date(b.expiryDate).getTime(),
          ),
          totalBatches: itemBatches.length,
          earliestExpiry,
          expiredBatches,
          expiringSoonBatches,
        };
      });

      setItems(itemsWithBatches);
    } catch (error) {
      console.error(
        "Error loading pharmacy data:",
        error instanceof Error ? error.name : error,
      );
      setLoadError(
        "Stock could not be read from this device. Reload the page and try again.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
          (item) => item.onHandQty <= item.reorderThreshold,
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
    setEditingItem(null);
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
      const newItem = {
        id: ulid(),
        medName: itemForm.medName.trim(),
        form: itemForm.form,
        strength: itemForm.strength.trim(),
        unit: itemForm.unit,
        onHandQty: 0,
        reorderThreshold: itemForm.reorderThreshold,
        isControlled: itemForm.isControlled,
        updatedAt: new Date().toISOString(),
      };

      await mbhrDb.pharmacy_items.add(newItem);
      await loadData();
      pushToast({
        id: generateId(),
        tone: "success",
        title: "Medicine added",
        body: `${newItem.medName} ${newItem.strength} saved on this device. Add a lot to record stock.`,
      });
      setShowAddItem(false);
      resetItemForm();
    } catch (error) {
      console.error(
        "Error adding item:",
        error instanceof Error ? error.name : error,
      );
      setFormError("The medicine was not added. Try again.");
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

    if (
      !showAddBatch ||
      !batchForm.lotNumber.trim() ||
      !batchForm.expiryDate ||
      batchForm.qtyOnHand <= 0
    ) {
      setFormError(
        "Enter the lot number, a quantity of at least 1 and the expiry date.",
      );
      return;
    }

    if (isSubmittingBatch) return;
    setIsSubmittingBatch(true);

    try {
      await mbhrDb.transaction(
        "rw",
        mbhrDb.pharmacy_batches,
        mbhrDb.pharmacy_items,
        async () => {
          // Add batch
          await mbhrDb.pharmacy_batches.add({
            id: ulid(),
            itemId: showAddBatch,
            lotNumber: batchForm.lotNumber.trim(),
            expiryDate: batchForm.expiryDate,
            qtyOnHand: batchForm.qtyOnHand,
            receivedAt: new Date().toISOString(),
            supplier: batchForm.supplier.trim() || undefined,
          });

          // Update item total quantity
          const item = await mbhrDb.pharmacy_items.get(showAddBatch);
          if (item) {
            await mbhrDb.pharmacy_items.update(showAddBatch, {
              onHandQty: item.onHandQty + batchForm.qtyOnHand,
              updatedAt: new Date().toISOString(),
            });
          }
        },
      );

      const medName = items.find((i) => i.id === showAddBatch)?.medName ?? "";
      await loadData();
      pushToast({
        id: generateId(),
        tone: "success",
        title: "Lot added",
        body: `${batchForm.qtyOnHand} added to ${medName} (lot ${batchForm.lotNumber.trim()}). Saved on this device.`,
      });
      setShowAddBatch(null);
      resetBatchForm();
    } catch (error) {
      console.error(
        "Error adding batch:",
        error instanceof Error ? error.name : error,
      );
      setFormError("The lot was not added and stock is unchanged. Try again.");
    } finally {
      setIsSubmittingBatch(false);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!currentUser || !can(currentUser.role, "inventory")) {
      setConfirmDeleteId(null);
      pushToast({
        id: generateId(),
        tone: "error",
        title: "Not deleted",
        body: "Only pharmacists and administrators can delete medicines.",
      });
      return;
    }

    const medName = items.find((i) => i.id === itemId)?.medName ?? "";
    setDeleting(true);
    try {
      await mbhrDb.transaction(
        "rw",
        mbhrDb.pharmacy_items,
        mbhrDb.pharmacy_batches,
        async () => {
          await mbhrDb.pharmacy_batches.where("itemId").equals(itemId).delete();
          await mbhrDb.pharmacy_items.delete(itemId);
        },
      );
      await createAuditLog(
        currentUser.role,
        "pharmacy_item_delete",
        "pharmacy_item",
        itemId,
      ).catch(() => undefined);
      if (selectedItem === itemId) setSelectedItem(null);
      await loadData();
      pushToast({
        id: generateId(),
        tone: "success",
        title: "Medicine deleted",
        body: `${medName} and its lots were removed from this device.`,
      });
    } catch (error) {
      console.error(
        "Error deleting item:",
        error instanceof Error ? error.name : error,
      );
      pushToast({
        id: generateId(),
        tone: "error",
        title: "Not deleted",
        body: `${medName} is still in stock records. Try again.`,
      });
    } finally {
      setDeleting(false);
      setConfirmDeleteId(null);
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

  if (loading) {
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

  const lowStockCount = items.filter(
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

  const stats: Array<{
    label: string;
    value: number;
    tone: Tone | null;
  }> = [
    { label: "Medicines", value: items.length, tone: null },
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
    return (
      <div className="flex justify-end gap-1">
        {canManageStock && (
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
        {canManageStock && (
          <button
            type="button"
            onClick={() => setConfirmDeleteId(item.id)}
            className="btn-ghost px-2 text-danger-fg hover:bg-danger-soft hover:text-danger-fg"
            aria-label={`Delete ${name}`}
            title="Delete medicine"
          >
            <TrashIcon className="h-5 w-5" aria-hidden />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pharmacy stock"
        description="Medicines by lot and expiry date, stored on this device."
        actions={
          canManageStock && (
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
          )
        }
      />

      {loadError && (
        <div className="banner banner-danger" role="alert">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
          <span>{loadError}</span>
        </div>
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
                          <StatusBadge tone={status.tone} icon>
                            {status.label}
                          </StatusBadge>
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
                          <StatusBadge tone={expiryStatus.tone} icon>
                            {expiryStatus.label}
                          </StatusBadge>
                        </td>
                        <td className="text-ink-secondary">
                          {batch.supplier || "—"}
                        </td>
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

      {/* Delete confirmation */}
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
                stock on this device.
              </p>
              <p className="font-medium text-danger-fg">
                This cannot be undone.
              </p>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                autoFocus
                onClick={() => setConfirmDeleteId(null)}
                disabled={deleting}
                className="btn-secondary"
              >
                Keep medicine
              </button>
              <button
                type="button"
                onClick={() => handleDeleteItem(deleteTarget.id)}
                disabled={deleting}
                className="btn-danger"
              >
                <TrashIcon className="h-4 w-4" aria-hidden />
                {deleting ? "Deleting…" : "Delete medicine"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
