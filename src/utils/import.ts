// Counterpart to `src/utils/export.ts`.
//
// Reads a JSON file that the export utility produced and re-inflates it into
// the local Dexie database. Two safety properties:
//   1. Idempotent — re-importing the same file is a no-op. Existing rows are
//      compared by primary key and only overwritten if the imported row is
//      strictly newer (updated_at / updatedAt).
//   2. Best-effort partial — if one table fails, the others still import.
//      Failures are collected and returned so the UI can surface them.
//
// Usage:
//   const result = await importDbExport(file);
//   if (result.errors.length) showErrors(result.errors);

import type { IndexableType, Table } from "dexie";

// Tag a freshly-imported record so the next sync push will reconcile it.
const importStamp = (row: Record<string, unknown>) => ({
  ...row,
  _dirty: 1,
  _syncedAt: undefined,
});

function parseTimestamp(value: unknown): number {
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof value === "number") return value;
  return 0;
}

function rowIsStrictlyNewer(
  incoming: Record<string, unknown>,
  existing: Record<string, unknown>,
): boolean {
  const a = parseTimestamp(incoming.updatedAt ?? incoming.updated_at);
  const b = parseTimestamp(existing.updatedAt ?? existing.updated_at);
  return a > b;
}

export interface ImportResult {
  importedTables: string[];
  rowsByTable: Record<string, { imported: number; skipped: number }>;
  errors: { table: string; error: string }[];
}

// `tables` is a map of expected table name -> the Dexie Table instance.
// Keeping it explicit (rather than poking `db[name]`) so a malicious or
// out-of-date export can't reach into arbitrary stores.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTable = Table<any, IndexableType>;

// Accepts the JSON body as a string. UI callers read the File first with
// `await file.text()`. Keeping the importer pure (string in, result out)
// makes it trivially testable without jsdom needing File.text() support.
export async function importDbExport(
  json: string,
  tables: Record<string, AnyTable>,
): Promise<ImportResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return {
      importedTables: [],
      rowsByTable: {},
      errors: [{ table: "(parse)", error: (e as Error).message }],
    };
  }

  // Accept either:
  //   (a) a single-table export: an array of rows. Caller passes a single
  //       entry in `tables` and we use whatever the file holds.
  //   (b) a multi-table export: an object of { tableName: rows[] }.
  let payload: Record<string, unknown[]>;
  if (Array.isArray(parsed)) {
    const names = Object.keys(tables);
    if (names.length !== 1) {
      return {
        importedTables: [],
        rowsByTable: {},
        errors: [
          {
            table: "(shape)",
            error: "Array export but multiple target tables provided.",
          },
        ],
      };
    }
    payload = { [names[0]!]: parsed as unknown[] };
  } else if (parsed && typeof parsed === "object") {
    payload = parsed as Record<string, unknown[]>;
  } else {
    return {
      importedTables: [],
      rowsByTable: {},
      errors: [{ table: "(shape)", error: "Unrecognised export shape." }],
    };
  }

  const result: ImportResult = {
    importedTables: [],
    rowsByTable: {},
    errors: [],
  };

  for (const [name, rows] of Object.entries(payload)) {
    const table = tables[name];
    if (!table) {
      result.errors.push({
        table: name,
        error: "Unknown target table; skipping.",
      });
      continue;
    }
    if (!Array.isArray(rows)) {
      result.errors.push({
        table: name,
        error: "Expected array of rows.",
      });
      continue;
    }

    let imported = 0;
    let skipped = 0;
    try {
      await table.db.transaction("rw", table, async () => {
        for (const raw of rows) {
          if (!raw || typeof raw !== "object") {
            skipped++;
            continue;
          }
          const row = raw as Record<string, unknown>;
          const pk = row.id;
          if (pk === undefined || pk === null) {
            skipped++;
            continue;
          }
          const existing = (await table.get(pk as IndexableType)) as
            | Record<string, unknown>
            | undefined;
          if (!existing) {
            await table.put(importStamp(row));
            imported++;
          } else if (rowIsStrictlyNewer(row, existing)) {
            await table.put(importStamp(row));
            imported++;
          } else {
            skipped++;
          }
        }
      });
      result.importedTables.push(name);
      result.rowsByTable[name] = { imported, skipped };
    } catch (e) {
      result.errors.push({
        table: name,
        error: (e as Error).message,
      });
    }
  }

  return result;
}
