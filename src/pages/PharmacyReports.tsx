import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { db, InventoryItem, Dispense, StockBatch } from "@/db";
import {
  ArrowLeftIcon,
  ChartBarIcon,
  ExclamationTriangleIcon,
  ArrowDownTrayIcon,
  CalendarDaysIcon,
  CubeIcon,
  ClockIcon,
} from "@heroicons/react/24/outline";

interface DispensingStats {
  totalDispensed: number;
  uniquePatients: number;
  topMedications: { name: string; count: number }[];
  dailyAverage: number;
}

interface ExpiryAlert {
  itemName: string;
  batchId: string;
  lotNumber: string;
  expiryDate: Date;
  quantity: number;
  daysUntilExpiry: number;
}

type DateRange = "7d" | "30d" | "90d" | "all";

export default function PharmacyReports() {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [dispenses, setDispenses] = useState<Dispense[]>([]);
  const [batches, setBatches] = useState<StockBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>("30d");
  const [activeTab, setActiveTab] = useState<
    "overview" | "dispensing" | "expiry" | "stock"
  >("overview");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [inv, disp, batch] = await Promise.all([
        db.inventory.toArray(),
        db.dispenses.orderBy("dispensedAt").reverse().toArray(),
        db.stockBatches.toArray(),
      ]);
      setInventory(inv);
      setDispenses(disp);
      setBatches(batch);
    } catch (error) {
      console.error("Error loading pharmacy data:", error);
    } finally {
      setLoading(false);
    }
  };

  const filteredDispenses = useMemo(() => {
    if (dateRange === "all") return dispenses;

    const now = new Date();
    const days = dateRange === "7d" ? 7 : dateRange === "30d" ? 30 : 90;
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    return dispenses.filter((d) => new Date(d.dispensedAt) >= cutoff);
  }, [dispenses, dateRange]);

  const dispensingStats: DispensingStats = useMemo(() => {
    const uniquePatients = new Set(filteredDispenses.map((d) => d.patientId))
      .size;
    const medicationCounts: Record<string, number> = {};

    filteredDispenses.forEach((d) => {
      medicationCounts[d.itemName] =
        (medicationCounts[d.itemName] || 0) + d.qty;
    });

    const topMedications = Object.entries(medicationCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    const days =
      dateRange === "7d"
        ? 7
        : dateRange === "30d"
          ? 30
          : dateRange === "90d"
            ? 90
            : Math.max(
                1,
                Math.ceil(
                  (Date.now() -
                    Math.min(
                      ...dispenses.map((d) =>
                        new Date(d.dispensedAt).getTime(),
                      ),
                    )) /
                    (24 * 60 * 60 * 1000),
                ),
              );

    return {
      totalDispensed: filteredDispenses.reduce((sum, d) => sum + d.qty, 0),
      uniquePatients,
      topMedications,
      dailyAverage: Math.round((filteredDispenses.length / days) * 10) / 10,
    };
  }, [filteredDispenses, dateRange, dispenses]);

  const lowStockItems = useMemo(
    () => inventory.filter((item) => item.onHandQty <= item.reorderThreshold),
    [inventory],
  );

  const expiryAlerts: ExpiryAlert[] = useMemo(() => {
    const now = new Date();
    const alerts: ExpiryAlert[] = [];

    batches.forEach((batch) => {
      const expiryDate = new Date(batch.expiryDate);
      const daysUntilExpiry = Math.ceil(
        (expiryDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
      );

      if (daysUntilExpiry <= 90 && batch.qtyOnHand > 0) {
        const item = inventory.find((i) => i.id === batch.drugId);
        alerts.push({
          itemName: item?.itemName || "Unknown",
          batchId: batch.id,
          lotNumber: batch.lotNumber,
          expiryDate,
          quantity: batch.qtyOnHand,
          daysUntilExpiry,
        });
      }
    });

    return alerts.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
  }, [batches, inventory]);

  const exportToCSV = (data: Record<string, unknown>[], filename: string) => {
    if (data.length === 0) return;

    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(","),
      ...data.map((row) =>
        headers
          .map((h) => {
            const val = row[h];
            if (val instanceof Date) return val.toISOString().split("T")[0];
            if (typeof val === "string" && val.includes(",")) return `"${val}"`;
            return String(val ?? "");
          })
          .join(","),
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}_${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link to="/pharmacy" className="text-blue-600 hover:text-blue-800">
            <ArrowLeftIcon className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Pharmacy Reports
            </h1>
            <p className="text-gray-600 text-sm">
              Analytics and insights for pharmacy operations
            </p>
          </div>
        </div>

        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as DateRange)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="all">All time</option>
        </select>
      </div>

      <div className="flex gap-2 border-b border-gray-200 overflow-x-auto">
        {(["overview", "dispensing", "expiry", "stock"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon={<ChartBarIcon className="w-6 h-6 text-blue-600" />}
              label="Items Dispensed"
              value={dispensingStats.totalDispensed.toLocaleString()}
              bgColor="bg-blue-50"
            />
            <StatCard
              icon={<CubeIcon className="w-6 h-6 text-green-600" />}
              label="Unique Patients"
              value={dispensingStats.uniquePatients.toLocaleString()}
              bgColor="bg-green-50"
            />
            <StatCard
              icon={<ClockIcon className="w-6 h-6 text-amber-600" />}
              label="Daily Average"
              value={`${dispensingStats.dailyAverage} dispenses`}
              bgColor="bg-amber-50"
            />
            <StatCard
              icon={
                <ExclamationTriangleIcon className="w-6 h-6 text-red-600" />
              }
              label="Low Stock Items"
              value={lowStockItems.length.toString()}
              bgColor="bg-red-50"
            />
          </div>

          {lowStockItems.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <h3 className="font-semibold text-red-800 mb-2 flex items-center gap-2">
                <ExclamationTriangleIcon className="w-5 h-5" />
                Low Stock Alert
              </h3>
              <div className="flex flex-wrap gap-2">
                {lowStockItems.slice(0, 5).map((item) => (
                  <span
                    key={item.id}
                    className="px-2 py-1 bg-red-100 text-red-800 rounded text-sm"
                  >
                    {item.itemName} ({item.onHandQty} {item.unit})
                  </span>
                ))}
                {lowStockItems.length > 5 && (
                  <span className="px-2 py-1 bg-red-100 text-red-800 rounded text-sm">
                    +{lowStockItems.length - 5} more
                  </span>
                )}
              </div>
            </div>
          )}

          {expiryAlerts.filter((a) => a.daysUntilExpiry <= 30).length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <h3 className="font-semibold text-amber-800 mb-2 flex items-center gap-2">
                <CalendarDaysIcon className="w-5 h-5" />
                Expiring Soon (30 days)
              </h3>
              <div className="flex flex-wrap gap-2">
                {expiryAlerts
                  .filter((a) => a.daysUntilExpiry <= 30)
                  .slice(0, 5)
                  .map((alert) => (
                    <span
                      key={alert.batchId}
                      className={`px-2 py-1 rounded text-sm ${
                        alert.daysUntilExpiry <= 7
                          ? "bg-red-100 text-red-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {alert.itemName} ({alert.daysUntilExpiry}d)
                    </span>
                  ))}
              </div>
            </div>
          )}

          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-900 mb-4">
              Top Medications Dispensed
            </h3>
            {dispensingStats.topMedications.length === 0 ? (
              <p className="text-gray-500 text-center py-4">
                No dispensing data available
              </p>
            ) : (
              <div className="space-y-3">
                {dispensingStats.topMedications.map((med, idx) => (
                  <div key={med.name} className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-500 w-6">
                      {idx + 1}.
                    </span>
                    <div className="flex-1">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="font-medium text-gray-900">
                          {med.name}
                        </span>
                        <span className="text-gray-600">
                          {med.count.toLocaleString()} units
                        </span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-600 rounded-full"
                          style={{
                            width: `${(med.count / dispensingStats.topMedications[0].count) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "dispensing" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() =>
                exportToCSV(
                  filteredDispenses.map((d) => ({
                    date: d.dispensedAt,
                    item: d.itemName,
                    quantity: d.qty,
                    dosage: d.dosage,
                    directions: d.directions,
                    dispensedBy: d.dispensedBy,
                  })),
                  "dispensing_report",
                )
              }
              className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <ArrowDownTrayIcon className="w-4 h-4" />
              Export CSV
            </button>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Date
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Medication
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Qty
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Dosage
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      By
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredDispenses.slice(0, 50).map((d) => (
                    <tr key={d.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {new Date(d.dispensedAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {d.itemName}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {d.qty}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {d.dosage}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {d.dispensedBy}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filteredDispenses.length > 50 && (
              <div className="px-4 py-3 bg-gray-50 text-sm text-gray-600 text-center">
                Showing 50 of {filteredDispenses.length} records. Export CSV for
                full data.
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "expiry" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() =>
                exportToCSV(
                  expiryAlerts.map((a) => ({
                    item: a.itemName,
                    lot: a.lotNumber,
                    expiryDate: a.expiryDate,
                    quantity: a.quantity,
                    daysRemaining: a.daysUntilExpiry,
                  })),
                  "expiry_report",
                )
              }
              className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <ArrowDownTrayIcon className="w-4 h-4" />
              Export CSV
            </button>
          </div>

          {expiryAlerts.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
              <CalendarDaysIcon className="w-12 h-12 mx-auto text-gray-400 mb-4" />
              <p className="text-gray-600">No items expiring within 90 days</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Item
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Lot #
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Expiry Date
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Qty
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Days Left
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {expiryAlerts.map((alert) => (
                      <tr key={alert.batchId} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                              alert.daysUntilExpiry <= 0
                                ? "bg-gray-100 text-gray-800"
                                : alert.daysUntilExpiry <= 7
                                  ? "bg-red-100 text-red-800"
                                  : alert.daysUntilExpiry <= 30
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-green-100 text-green-800"
                            }`}
                          >
                            {alert.daysUntilExpiry <= 0
                              ? "Expired"
                              : alert.daysUntilExpiry <= 7
                                ? "Critical"
                                : alert.daysUntilExpiry <= 30
                                  ? "Warning"
                                  : "OK"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">
                          {alert.itemName}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {alert.lotNumber}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {alert.expiryDate.toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {alert.quantity}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium">
                          <span
                            className={
                              alert.daysUntilExpiry <= 0
                                ? "text-gray-600"
                                : alert.daysUntilExpiry <= 7
                                  ? "text-red-600"
                                  : alert.daysUntilExpiry <= 30
                                    ? "text-amber-600"
                                    : "text-green-600"
                            }
                          >
                            {alert.daysUntilExpiry <= 0
                              ? "Expired"
                              : `${alert.daysUntilExpiry} days`}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "stock" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() =>
                exportToCSV(
                  inventory.map((i) => ({
                    item: i.itemName,
                    unit: i.unit,
                    onHand: i.onHandQty,
                    reorderAt: i.reorderThreshold,
                    status:
                      i.onHandQty <= i.reorderThreshold
                        ? "Low Stock"
                        : "In Stock",
                  })),
                  "stock_report",
                )
              }
              className="inline-flex items-center gap-2 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <ArrowDownTrayIcon className="w-4 h-4" />
              Export CSV
            </button>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Item
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Unit
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      On Hand
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Reorder At
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Stock Level
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {inventory
                    .sort(
                      (a, b) =>
                        a.onHandQty / a.reorderThreshold -
                        b.onHandQty / b.reorderThreshold,
                    )
                    .map((item) => {
                      const stockRatio =
                        item.reorderThreshold > 0
                          ? (item.onHandQty / item.reorderThreshold) * 100
                          : 100;
                      return (
                        <tr key={item.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                                item.onHandQty <= item.reorderThreshold
                                  ? "bg-red-100 text-red-800"
                                  : "bg-green-100 text-green-800"
                              }`}
                            >
                              {item.onHandQty <= item.reorderThreshold
                                ? "Low Stock"
                                : "In Stock"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">
                            {item.itemName}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {item.unit}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {item.onHandQty}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600">
                            {item.reorderThreshold}
                          </td>
                          <td className="px-4 py-3">
                            <div className="w-24 h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  stockRatio <= 100
                                    ? "bg-red-500"
                                    : stockRatio <= 150
                                      ? "bg-amber-500"
                                      : "bg-green-500"
                                }`}
                                style={{
                                  width: `${Math.min(100, stockRatio)}%`,
                                }}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  bgColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  bgColor: string;
}) {
  return (
    <div className={`${bgColor} rounded-lg p-4`}>
      <div className="flex items-center gap-3">
        {icon}
        <div>
          <p className="text-sm text-gray-600">{label}</p>
          <p className="text-xl font-bold text-gray-900">{value}</p>
        </div>
      </div>
    </div>
  );
}
