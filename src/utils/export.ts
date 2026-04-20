// CSV/JSON export utilities for data export functionality
import type { Table } from "dexie";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCSV(rows: any[]) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(",")),
  ].join("\n");
}

export async function exportTable<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: Table<T, any>,
  filename: string,
  type: "csv" | "json" = "csv",
) {
  const rows = await table.toArray();
  const blob =
    type === "json"
      ? new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" })
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new Blob([toCSV(rows as any)], { type: "text/csv" });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
