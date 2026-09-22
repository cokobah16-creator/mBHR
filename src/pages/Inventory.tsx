import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, InventoryItem, generateId } from "@/db";
import { useAuthStore } from "@/stores/auth";
import { can } from "@/auth/roles";
import { useToast } from "@/stores/toast";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge, type Tone } from "@/components/ui/StatusBadge";
import { PharmacySkeleton } from "@/components/ui/Skeleton";
import { CubeIcon, PlusIcon, PencilIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";

type StockStatus = "out" | "low" | "ok";
type Filter = "all" | StockStatus;

function stockStatus(item: InventoryItem): StockStatus {
  if (item.onHandQty <= 0) return "out";
  if (item.onHandQty <= item.reorderThreshold) return "low";
  return "ok";
}

const STATUS: Record<StockStatus, { label: string; tone: Tone }> = {
  out: { label: "Out of stock", tone: "danger" },
  low: { label: "Low stock", tone: "warning" },
  ok: { label: "In stock", tone: "success" },
};

const EMPTY_FORM = { itemName: "", unit: "", onHandQty: 0, reorderThreshold: 0 };

export function Inventory() {
  const role = useAuthStore((s) => s.currentUser?.role);
  const { push: pushToast } = useToast();
  const inventory = useLiveQuery(() => db.inventory.orderBy("itemName").toArray(), []);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const counts = useMemo(() => {
    const c = { all: 0, out: 0, low: 0, ok: 0 };
    (inventory ?? []).forEach((i) => {
      c.all++;
      c[stockStatus(i)]++;
    });
    return c;
  }, [inventory]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (inventory ?? [])
      .filter((i) => filter === "all" || stockStatus(i) === filter)
      .filter((i) => !q || i.itemName.toLowerCase().includes(q))
      .sort((a, b) => {
        // Problems first, then alphabetical.
        const rank = { out: 0, low: 1, ok: 2 } as const;
        return rank[stockStatus(a)] - rank[stockStatus(b)] || a.itemName.localeCompare(b.itemName);
      });
  }, [inventory, filter, search]);

  const resetForm = () => {
    setFormData(EMPTY_FORM);
    setShowForm(false);
    setEditingItem(null);
    setFormError("");
  };

  const startEdit = (item: InventoryItem) => {
    setFormData({
      itemName: item.itemName,
      unit: item.unit,
      onHandQty: item.onHandQty,
      reorderThreshold: item.reorderThreshold,
    });
    setEditingItem(item);
    setFormError("");
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!formData.itemName.trim() || !formData.unit.trim()) {
      setFormError("Item name and unit are required.");
      return;
    }
    if (formData.onHandQty < 0 || formData.reorderThreshold < 0) {
      setFormError("Quantities cannot be negative.");
      return;
    }
    setSaving(true);
    try {
      if (editingItem) {
        await db.inventory.update(editingItem.id, {
          ...formData,
          itemName: formData.itemName.trim(),
          unit: formData.unit.trim(),
          updatedAt: new Date(),
          _dirty: 1,
        });
      } else {
        await db.inventory.add({
          id: generateId(),
          ...formData,
          itemName: formData.itemName.trim(),
          unit: formData.unit.trim(),
          updatedAt: new Date(),
          _dirty: 1,
        });
      }
      pushToast({
        id: generateId(),
        tone: "success",
        title: editingItem ? "Stock updated" : "Item added",
        body: `${formData.itemName.trim()}: ${formData.onHandQty} ${formData.unit.trim()}`,
      });
      resetForm();
    } catch (error) {
      console.error("Error saving inventory item:", error instanceof Error ? error.name : error);
      setFormError("The item was not saved. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const canSeeLots = !!role && ["pharmacist", "admin"].includes(role);
  // Viewing stock is open to all staff; changing it follows the RBAC
  // matrix (inventory permission: pharmacist, admin).
  const canEdit = !!role && can(role, "inventory");

  if (inventory === undefined) {
    return (
      <div>
        <PageHeader title="Inventory" />
        <PharmacySkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Inventory"
        description="Medicines and supplies on hand at this outreach. Items that need attention are listed first."
        actions={
          <>
            {canSeeLots && (
              <Link to="/rx/stock" className="btn-secondary">
                Lots and expiry
              </Link>
            )}
            {canEdit && (
              <button
                onClick={() => {
                  setEditingItem(null);
                  setFormData(EMPTY_FORM);
                  setShowForm(true);
                }}
                className="btn-primary"
              >
                <PlusIcon className="h-5 w-5" aria-hidden />
                Add item
              </button>
            )}
          </>
        }
      />

      {showForm && canEdit && (
        <form onSubmit={handleSubmit} className="panel" aria-labelledby="inv-form-title" noValidate>
          <div className="panel-header">
            <h2 id="inv-form-title" className="panel-title">
              {editingItem ? `Update ${editingItem.itemName}` : "Add item"}
            </h2>
          </div>
          <div className="panel-body space-y-4">
            {formError && (
              <div className="banner banner-danger" role="alert">
                {formError}
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="inv-name" className="field-label">
                  Item name
                </label>
                <input
                  id="inv-name"
                  className="input-field"
                  value={formData.itemName}
                  onChange={(e) => setFormData({ ...formData, itemName: e.target.value })}
                  placeholder="e.g. Paracetamol 500 mg"
                  required
                />
              </div>
              <div>
                <label htmlFor="inv-unit" className="field-label">
                  Unit
                </label>
                <input
                  id="inv-unit"
                  className="input-field"
                  value={formData.unit}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                  placeholder="e.g. tablets"
                  required
                />
              </div>
              <div>
                <label htmlFor="inv-qty" className="field-label">
                  Quantity on hand
                </label>
                <input
                  id="inv-qty"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  className="input-field tabular-nums"
                  value={formData.onHandQty}
                  onChange={(e) => setFormData({ ...formData, onHandQty: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div>
                <label htmlFor="inv-reorder" className="field-label">
                  Reorder when at or below
                </label>
                <input
                  id="inv-reorder"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  className="input-field tabular-nums"
                  value={formData.reorderThreshold}
                  onChange={(e) => setFormData({ ...formData, reorderThreshold: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-line px-4 py-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={resetForm} className="btn-secondary" disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Saving…" : editingItem ? "Save changes" : "Add item"}
            </button>
          </div>
        </form>
      )}

      <section className="panel" aria-label="Stock">
        <div className="flex flex-col gap-3 border-b border-line p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by stock status">
            {(
              [
                ["all", "All"],
                ["out", "Out of stock"],
                ["low", "Low"],
                ["ok", "In stock"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                aria-pressed={filter === key}
                className={`rounded-md border px-3 py-1.5 text-label tabular-nums transition-colors ${
                  filter === key
                    ? "border-primary bg-primary-soft text-primary-fg"
                    : "border-line bg-surface text-ink-secondary hover:bg-surface-hover"
                }`}
              >
                {label} ({counts[key]})
              </button>
            ))}
          </div>
          <div className="relative sm:w-64">
            <label htmlFor="inv-search" className="sr-only">
              Search items
            </label>
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden />
            <input
              id="inv-search"
              type="search"
              className="input-field pl-9"
              placeholder="Search items"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {inventory.length === 0 ? (
          <EmptyState
            icon={CubeIcon}
            title="No stock recorded on this device"
            description="Add the medicines and supplies brought to this outreach so dispensing and low-stock alerts work."
          />
        ) : visible.length === 0 ? (
          <p className="panel-body text-body text-ink-muted">No items match.</p>
        ) : (
          <>
            <table className="data-table hidden sm:table">
              <thead>
                <tr>
                  <th scope="col">Item</th>
                  <th scope="col" className="text-right">On hand</th>
                  <th scope="col" className="text-right">Reorder at</th>
                  <th scope="col">Status</th>
                  <th scope="col">Updated</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => {
                  const st = STATUS[stockStatus(item)];
                  return (
                    <tr key={item.id}>
                      <td className="font-medium text-ink">{item.itemName}</td>
                      <td className="text-right tabular-nums">
                        {item.onHandQty} <span className="text-ink-muted">{item.unit}</span>
                      </td>
                      <td className="text-right tabular-nums text-ink-secondary">{item.reorderThreshold}</td>
                      <td>
                        <StatusBadge tone={st.tone} icon={st.tone !== "success"}>
                          {st.label}
                        </StatusBadge>
                      </td>
                      <td className="text-caption text-ink-muted">
                        {new Date(item.updatedAt).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}
                      </td>
                      <td className="text-right">
                        {canEdit && (
                        <button
                          onClick={() => startEdit(item)}
                          className="btn-ghost"
                          aria-label={`Update ${item.itemName}`}
                        >
                          <PencilIcon className="h-4 w-4" aria-hidden />
                          Update
                        </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <ul className="divide-y divide-line sm:hidden">
              {visible.map((item) => {
                const st = STATUS[stockStatus(item)];
                return (
                  <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-ink">{item.itemName}</span>
                      <span className="block text-caption tabular-nums text-ink-muted">
                        {item.onHandQty} {item.unit} · reorder at {item.reorderThreshold}
                      </span>
                    </span>
                    <StatusBadge tone={st.tone} icon={st.tone !== "success"}>
                      {st.label}
                    </StatusBadge>
                    {canEdit && (
                      <button onClick={() => startEdit(item)} className="btn-ghost px-2" aria-label={`Update ${item.itemName}`}>
                        <PencilIcon className="h-5 w-5" aria-hidden />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
