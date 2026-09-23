import { useCallback, useEffect, useMemo, useState } from "react";
import { db, InventoryItem, Dispense, StockBatch } from "@/db";
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  BeakerIcon,
  CalendarDaysIcon,
  CubeIcon,
  UsersIcon,
  ChartBarIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PharmacySkeleton } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { tabId, panelId } from "@/components/ui/tabIds";
import { formatNigerianDate, formatTime } from "@/utils/dateFormat";
import { StatTile } from "@/features/reports/StatTile";
import { BarList } from "@/features/reports/BarList";
import { DataScopeNote } from "@/features/reports/DataScopeNote";
import { useCsvExport } from "@/features/reports/useCsvExport";
import { csvFileName, daysUntil, toTime } from "@/features/reports/reportUtils";
import {
  EXPIRY_LEVEL_META,
  EXPIRY_WINDOW_DAYS,
  PERIOD_LABELS,
  STOCK_LEVEL_META,
  describeDaysLeft,
  expiryLevel,
  filterByPeriod,
  isPharmacyPeriod,
  sortByStockCover,
  stockCoverPercent,
  stockLevel,
  summariseDispensing,
  type PharmacyPeriod,
} from "@/features/reports/pharmacyReportUtils";

interface ExpiryAlert {
  itemName: string;
  batchId: string;
  lotNumber: string;
  expiryDate: Date;
  quantity: number;
  daysUntilExpiry: number;
}

type Tab = "overview" | "dispensing" | "expiry" | "stock";

function isTab(value: string): value is Tab {
  return value === "overview" || value === "dispensing" || value === "expiry" || value === "stock";
}

const TABLE_LIMIT = 50;
const ID_PREFIX = "rx-reports";

export default function PharmacyReports() {
  const exportCsv = useCsvExport();
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [dispenses, setDispenses] = useState<Dispense[]>([]);
  const [batches, setBatches] = useState<StockBatch[]>([]);
  const [staffNames, setStaffNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [period, setPeriod] = useState<PharmacyPeriod>("30d");
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [inv, disp, batch, users] = await Promise.all([
        db.inventory.toArray(),
        db.dispenses.toArray(),
        db.stockBatches.toArray(),
        db.users.toArray(),
      ]);
      // Newest first. Sorted here rather than by index because synced
      // records store their date as text and would sort separately.
      disp.sort((a, b) => (toTime(b.dispensedAt) ?? 0) - (toTime(a.dispensedAt) ?? 0));
      setInventory(inv);
      setDispenses(disp);
      setBatches(batch);
      setStaffNames(new Map<string, string>(users.map((u) => [u.id, u.fullName])));
      setLoadedAt(new Date());
    } catch (error) {
      console.error(
        "Error loading pharmacy data:",
        error instanceof Error ? error.name : error,
      );
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredDispenses = useMemo(
    () => filterByPeriod(dispenses, period),
    [dispenses, period],
  );

  const summary = useMemo(
    () => summariseDispensing(filteredDispenses, dispenses, period),
    [filteredDispenses, dispenses, period],
  );

  // Same rule as before: at or below the reorder level. Out of stock first.
  const lowStockItems = useMemo(
    () =>
      sortByStockCover(
        inventory.filter((item) => item.onHandQty <= item.reorderThreshold),
      ),
    [inventory],
  );

  const stockRows = useMemo(() => sortByStockCover(inventory), [inventory]);

  const expiryAlerts: ExpiryAlert[] = useMemo(() => {
    const now = new Date();
    const names = new Map<string, string>(inventory.map((i) => [i.id, i.itemName]));
    const alerts: ExpiryAlert[] = [];
    batches.forEach((batch) => {
      const days = daysUntil(batch.expiryDate, now);
      if (days === null) return;
      if (days <= EXPIRY_WINDOW_DAYS && batch.qtyOnHand > 0) {
        alerts.push({
          itemName: names.get(batch.drugId) || "Unknown item",
          batchId: batch.id,
          lotNumber: batch.lotNumber,
          expiryDate: new Date(batch.expiryDate),
          quantity: batch.qtyOnHand,
          daysUntilExpiry: days,
        });
      }
    });
    return alerts.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
  }, [batches, inventory]);

  const expiringSoon = expiryAlerts.filter((a) => a.daysUntilExpiry <= 30);
  const staffName = (value: string) => staffNames.get(value) ?? value;
  const periodLabel = PERIOD_LABELS[period];

  const header = (
    <PageHeader
      title="Pharmacy reports"
      description="Dispensing, lots close to expiry and stock levels."
      breadcrumbs={[{ label: "Pharmacy", to: "/pharmacy" }, { label: "Reports" }]}
      actions={
        // Stays mounted while loading so keyboard focus is not lost.
        <button type="button" onClick={loadData} disabled={loading} className="btn-secondary">
          <ArrowPathIcon className="h-4 w-4" aria-hidden />
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      }
    />
  );

  if (loading && !loadedAt) {
    return (
      <div className="mx-auto max-w-7xl">
        {header}
        <PharmacySkeleton />
      </div>
    );
  }

  if (loadFailed && !loadedAt) {
    return (
      <div className="mx-auto max-w-7xl">
        {header}
        <div className="banner banner-danger" role="alert">
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
          <div className="flex-1">
            <p>Pharmacy records could not be read from this device.</p>
            <button type="button" onClick={loadData} className="btn-secondary mt-2">
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const exportDispensing = () =>
    exportCsv(
      "dispensing records",
      csvFileName("dispensing_report"),
      ["date", "item", "quantity", "dosage", "directions", "dispensedBy"],
      filteredDispenses.map((d) => [
        d.dispensedAt ? new Date(d.dispensedAt) : "",
        d.itemName,
        d.qty,
        d.dosage,
        d.directions,
        staffName(d.dispensedBy),
      ]),
    );

  const exportExpiry = () =>
    exportCsv(
      "expiring lots",
      csvFileName("expiry_report"),
      ["item", "lot", "expiryDate", "quantity", "daysRemaining"],
      expiryAlerts.map((a) => [a.itemName, a.lotNumber, a.expiryDate, a.quantity, a.daysUntilExpiry]),
    );

  const exportStock = () =>
    exportCsv(
      "stock levels",
      csvFileName("stock_report"),
      ["item", "unit", "onHand", "reorderAt", "status"],
      stockRows.map((i) => [
        i.itemName,
        i.unit,
        i.onHandQty,
        i.reorderThreshold,
        STOCK_LEVEL_META[stockLevel(i)].label,
      ]),
    );

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      {header}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="sm:w-56">
          <label htmlFor="rx-report-period" className="field-label">
            Dispensing period
          </label>
          <select
            id="rx-report-period"
            value={period}
            onChange={(e) => {
              if (isPharmacyPeriod(e.target.value)) setPeriod(e.target.value);
            }}
            className="input-field"
          >
            {(Object.keys(PERIOD_LABELS) as PharmacyPeriod[]).map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1 sm:max-w-xl sm:text-right">
          <DataScopeNote
            period={`Dispensing: ${periodLabel.toLowerCase()}. Stock and expiry: as of now`}
          />
          {loadedAt && (
            <p className="text-caption text-ink-muted" aria-live="polite">
              {loading ? "Refreshing…" : `Read at ${formatTime(loadedAt)}`}
              {loadFailed ? " · the last refresh failed" : ""}
            </p>
          )}
        </div>
      </div>

      <Tabs<Tab>
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "dispensing", label: "Dispensing", badge: filteredDispenses.length },
          { id: "expiry", label: "Expiry", badge: expiryAlerts.length || undefined },
          { id: "stock", label: "Stock", badge: lowStockItems.length || undefined },
        ]}
        active={activeTab}
        onChange={(id) => {
          if (isTab(id)) setActiveTab(id);
        }}
        idPrefix={ID_PREFIX}
        label="Pharmacy report sections"
      />

      {activeTab === "overview" && (
        <section
          role="tabpanel"
          id={panelId(ID_PREFIX, "overview")}
          aria-labelledby={tabId(ID_PREFIX, "overview")}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Units dispensed"
              value={summary.unitsDispensed.toLocaleString("en-NG")}
              hint={periodLabel}
              icon={BeakerIcon}
            />
            <StatTile
              label="Patients dispensed to"
              value={summary.uniquePatients.toLocaleString("en-NG")}
              hint={periodLabel}
              icon={UsersIcon}
            />
            <StatTile
              label="Dispensing records per day"
              value={summary.recordsPerDay.toLocaleString("en-NG")}
              hint={`${summary.records.toLocaleString("en-NG")} records over ${summary.days} ${summary.days === 1 ? "day" : "days"}`}
              icon={ChartBarIcon}
            />
            <StatTile
              label="At or below reorder level"
              value={lowStockItems.length.toLocaleString("en-NG")}
              hint="Now"
              icon={CubeIcon}
            />
          </div>

          {lowStockItems.length > 0 && (
            <div className="banner banner-warning">
              <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {lowStockItems.length} {lowStockItems.length === 1 ? "item is" : "items are"} at or below the reorder level
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {lowStockItems.slice(0, 5).map((item) => {
                    const meta = STOCK_LEVEL_META[stockLevel(item)];
                    return (
                      <li key={item.id}>
                        <StatusBadge tone={meta.tone}>
                          {item.itemName}: {item.onHandQty} {item.unit}
                          <span className="sr-only"> ({meta.label})</span>
                        </StatusBadge>
                      </li>
                    );
                  })}
                  {lowStockItems.length > 5 && (
                    <li>
                      <button
                        type="button"
                        onClick={() => setActiveTab("stock")}
                        className="min-h-touch-target text-label underline"
                      >
                        and {lowStockItems.length - 5} more
                      </button>
                    </li>
                  )}
                </ul>
              </div>
            </div>
          )}

          {expiringSoon.length > 0 && (
            <div className="banner banner-warning">
              <CalendarDaysIcon className="h-5 w-5 shrink-0" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {expiringSoon.length} {expiringSoon.length === 1 ? "lot expires" : "lots expire"} within 30 days or {expiringSoon.length === 1 ? "has" : "have"} expired
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {expiringSoon.slice(0, 5).map((alert) => {
                    const meta = EXPIRY_LEVEL_META[expiryLevel(alert.daysUntilExpiry)];
                    return (
                      <li key={alert.batchId}>
                        <StatusBadge tone={meta.tone}>
                          {alert.itemName}: {describeDaysLeft(alert.daysUntilExpiry)}
                        </StatusBadge>
                      </li>
                    );
                  })}
                  {expiringSoon.length > 5 && (
                    <li>
                      <button
                        type="button"
                        onClick={() => setActiveTab("expiry")}
                        className="min-h-touch-target text-label underline"
                      >
                        and {expiringSoon.length - 5} more
                      </button>
                    </li>
                  )}
                </ul>
              </div>
            </div>
          )}

          <section className="panel" aria-labelledby="rx-top-title">
            <div className="panel-header">
              <h2 id="rx-top-title" className="panel-title">
                Most dispensed medicines
              </h2>
              <span className="text-caption text-ink-muted">Units · {periodLabel.toLowerCase()}</span>
            </div>
            {summary.topMedicines.length === 0 ? (
              <EmptyState
                icon={BeakerIcon}
                title="No dispensing recorded in this period"
                description="Choose a longer period, or check that dispensing is being recorded on this device."
              />
            ) : (
              <div className="panel-body">
                <BarList
                  label="Units dispensed per medicine"
                  scale="max"
                  items={summary.topMedicines.map((m) => ({
                    key: m.name,
                    label: m.name,
                    value: m.units,
                    detail: "units",
                  }))}
                />
              </div>
            )}
          </section>
        </section>
      )}

      {activeTab === "dispensing" && (
        <section
          role="tabpanel"
          id={panelId(ID_PREFIX, "dispensing")}
          aria-labelledby={tabId(ID_PREFIX, "dispensing")}
          className="panel"
        >
          <div className="panel-header flex-wrap">
            <h2 className="panel-title">
              Dispensing records · {periodLabel.toLowerCase()}
            </h2>
            <button
              type="button"
              onClick={exportDispensing}
              disabled={filteredDispenses.length === 0}
              className="btn-secondary"
            >
              <ArrowDownTrayIcon className="h-4 w-4" aria-hidden />
              Export {filteredDispenses.length.toLocaleString("en-NG")} as CSV
            </button>
          </div>
          {filteredDispenses.length === 0 ? (
            <EmptyState
              icon={BeakerIcon}
              title="No dispensing recorded in this period"
              description="Records appear here once medicines are dispensed on this device."
            />
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Medicine</th>
                      <th scope="col" className="text-right">Qty</th>
                      <th scope="col">Dosage</th>
                      <th scope="col">Dispensed by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDispenses.slice(0, TABLE_LIMIT).map((d) => (
                      <tr key={d.id}>
                        <td className="whitespace-nowrap tabular-nums">{formatNigerianDate(d.dispensedAt)}</td>
                        <td className="font-medium">{d.itemName}</td>
                        <td className="text-right tabular-nums">{d.qty}</td>
                        <td className="text-ink-secondary">{d.dosage}</td>
                        <td className="text-ink-secondary">{staffName(d.dispensedBy)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="divide-y divide-line md:hidden">
                {filteredDispenses.slice(0, TABLE_LIMIT).map((d) => (
                  <li key={d.id} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium text-ink">{d.itemName}</span>
                      <span className="tabular-nums text-ink-secondary">× {d.qty}</span>
                    </div>
                    <p className="text-caption text-ink-muted">
                      {formatNigerianDate(d.dispensedAt)}
                      {d.dosage ? ` · ${d.dosage}` : ""} · {staffName(d.dispensedBy)}
                    </p>
                  </li>
                ))}
              </ul>
              {filteredDispenses.length > TABLE_LIMIT && (
                <p className="border-t border-line bg-surface-sunken px-4 py-3 text-caption text-ink-muted">
                  Showing the latest {TABLE_LIMIT} of {filteredDispenses.length.toLocaleString("en-NG")} records.
                  The CSV export includes all of them.
                </p>
              )}
            </>
          )}
        </section>
      )}

      {activeTab === "expiry" && (
        <section
          role="tabpanel"
          id={panelId(ID_PREFIX, "expiry")}
          aria-labelledby={tabId(ID_PREFIX, "expiry")}
          className="panel"
        >
          <div className="panel-header flex-wrap">
            <h2 className="panel-title">Lots expiring within {EXPIRY_WINDOW_DAYS} days</h2>
            <button
              type="button"
              onClick={exportExpiry}
              disabled={expiryAlerts.length === 0}
              className="btn-secondary"
            >
              <ArrowDownTrayIcon className="h-4 w-4" aria-hidden />
              Export CSV
            </button>
          </div>
          {expiryAlerts.length === 0 ? (
            <EmptyState
              icon={CalendarDaysIcon}
              title={`No stock expires within ${EXPIRY_WINDOW_DAYS} days`}
              description="Only lots with stock on hand are checked. Lots are recorded when stock is received."
            />
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Status</th>
                      <th scope="col">Item</th>
                      <th scope="col">Lot</th>
                      <th scope="col">Expiry date</th>
                      <th scope="col" className="text-right">Qty</th>
                      <th scope="col" className="text-right">Days left</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expiryAlerts.map((alert) => {
                      const meta = EXPIRY_LEVEL_META[expiryLevel(alert.daysUntilExpiry)];
                      return (
                        <tr key={alert.batchId}>
                          <td>
                            <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                          </td>
                          <td className="font-medium">{alert.itemName}</td>
                          <td className="font-mono text-ink-secondary">{alert.lotNumber}</td>
                          <td className="whitespace-nowrap tabular-nums">{formatNigerianDate(alert.expiryDate)}</td>
                          <td className="text-right tabular-nums">{alert.quantity}</td>
                          <td className="text-right tabular-nums">{describeDaysLeft(alert.daysUntilExpiry)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <ul className="divide-y divide-line md:hidden">
                {expiryAlerts.map((alert) => {
                  const meta = EXPIRY_LEVEL_META[expiryLevel(alert.daysUntilExpiry)];
                  return (
                    <li key={alert.batchId} className="space-y-1 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <span className="font-medium text-ink">{alert.itemName}</span>
                        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                      </div>
                      <p className="text-caption tabular-nums text-ink-muted">
                        Lot {alert.lotNumber} · expires {formatNigerianDate(alert.expiryDate)} · {alert.quantity} on hand
                      </p>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      )}

      {activeTab === "stock" && (
        <section
          role="tabpanel"
          id={panelId(ID_PREFIX, "stock")}
          aria-labelledby={tabId(ID_PREFIX, "stock")}
          className="panel"
        >
          <div className="panel-header flex-wrap">
            <h2 className="panel-title">Stock levels</h2>
            <button
              type="button"
              onClick={exportStock}
              disabled={stockRows.length === 0}
              className="btn-secondary"
            >
              <ArrowDownTrayIcon className="h-4 w-4" aria-hidden />
              Export CSV
            </button>
          </div>
          {stockRows.length === 0 ? (
            <EmptyState
              icon={CubeIcon}
              title="No stock recorded on this device"
              description="Add the medicines brought to this outreach in Inventory so stock levels can be reported."
            />
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Status</th>
                      <th scope="col">Item</th>
                      <th scope="col">Unit</th>
                      <th scope="col" className="text-right">On hand</th>
                      <th scope="col" className="text-right">Reorder at</th>
                      <th scope="col" className="text-right">Cover</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockRows.map((item) => {
                      const meta = STOCK_LEVEL_META[stockLevel(item)];
                      const cover = stockCoverPercent(item);
                      return (
                        <tr key={item.id}>
                          <td>
                            <StatusBadge tone={meta.tone} icon={meta.tone !== "success"}>
                              {meta.label}
                            </StatusBadge>
                          </td>
                          <td className="font-medium">{item.itemName}</td>
                          <td className="text-ink-secondary">{item.unit}</td>
                          <td className="text-right tabular-nums">{item.onHandQty}</td>
                          <td className="text-right tabular-nums text-ink-secondary">{item.reorderThreshold}</td>
                          <td className="text-right tabular-nums text-ink-secondary">
                            {cover === null ? "No reorder level" : `${cover}% of reorder level`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <ul className="divide-y divide-line md:hidden">
                {stockRows.map((item) => {
                  const meta = STOCK_LEVEL_META[stockLevel(item)];
                  return (
                    <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-ink">{item.itemName}</span>
                        <span className="block text-caption tabular-nums text-ink-muted">
                          {item.onHandQty} {item.unit} · reorder at {item.reorderThreshold}
                        </span>
                      </span>
                      <StatusBadge tone={meta.tone} icon={meta.tone !== "success"}>
                        {meta.label}
                      </StatusBadge>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}
