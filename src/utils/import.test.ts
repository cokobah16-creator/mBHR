import { describe, expect, it, beforeEach } from "vitest";
import type { IndexableType, Table } from "dexie";
import { importDbExport } from "./import";

// Hand-rolled in-memory Table to avoid pulling in fake-indexeddb.
// Implements only the surface importDbExport touches: get, put, and
// `table.db.transaction(mode, table, fn)`.
function makeMockTable<T extends { id: string }>(): Table<T, IndexableType> {
  const store = new Map<string, T>();

  const table = {
    get: async (id: IndexableType) => store.get(String(id)),
    put: async (row: T) => {
      store.set(String(row.id), row);
      return row.id as unknown as IndexableType;
    },
    db: {
      transaction: async (
        _mode: string,
        _tbl: unknown,
        fn: () => Promise<unknown>,
      ) => fn(),
    },
    _store: store,
  } as unknown as Table<T, IndexableType> & { _store: Map<string, T> };

  return table;
}

function getStore<T extends { id: string }>(
  t: Table<T, IndexableType>,
): Map<string, T> {
  return (t as unknown as { _store: Map<string, T> })._store;
}

const json = (payload: unknown): string => JSON.stringify(payload);

interface Row {
  id: string;
  name?: string;
  updatedAt?: string;
  _dirty?: number;
}

let patients: Table<Row, IndexableType>;
beforeEach(() => {
  patients = makeMockTable<Row>();
});

describe("importDbExport", () => {
  it("imports a multi-table object payload", async () => {
    const file = json({
      patients: [
        { id: "p1", name: "Ada", updatedAt: "2026-05-20T10:00:00Z" },
        { id: "p2", name: "Bola", updatedAt: "2026-05-20T11:00:00Z" },
      ],
    });
    const res = await importDbExport(file, { patients });
    expect(res.errors).toEqual([]);
    expect(res.rowsByTable.patients).toEqual({ imported: 2, skipped: 0 });
    expect(getStore(patients).size).toBe(2);
  });

  it("imports a single-table array payload", async () => {
    const file = json([
      { id: "p1", name: "Ada", updatedAt: "2026-05-20T10:00:00Z" },
    ]);
    const res = await importDbExport(file, { patients });
    expect(res.errors).toEqual([]);
    expect(res.rowsByTable.patients.imported).toBe(1);
  });

  it("skips rows older than the existing one (idempotent re-import)", async () => {
    getStore(patients).set("p1", {
      id: "p1",
      name: "Ada NEW",
      updatedAt: "2026-05-20T12:00:00Z",
    });
    const file = json([
      { id: "p1", name: "Ada OLD", updatedAt: "2026-05-20T10:00:00Z" },
    ]);
    const res = await importDbExport(file, { patients });
    expect(res.rowsByTable.patients).toEqual({ imported: 0, skipped: 1 });
    expect(getStore(patients).get("p1")?.name).toBe("Ada NEW");
  });

  it("marks imported rows _dirty for the next sync push", async () => {
    const file = json([
      { id: "p1", name: "Ada", updatedAt: "2026-05-20T10:00:00Z" },
    ]);
    await importDbExport(file, { patients });
    expect(getStore(patients).get("p1")?._dirty).toBe(1);
  });

  it("collects errors for unknown target tables without aborting other tables", async () => {
    const file = json({
      patients: [{ id: "p1", updatedAt: "2026-05-20T10:00:00Z" }],
      visits: [{ id: "v1", updatedAt: "2026-05-20T10:00:00Z" }],
    });
    const res = await importDbExport(file, { patients });
    expect(res.importedTables).toEqual(["patients"]);
    expect(res.errors).toEqual([
      { table: "visits", error: "Unknown target table; skipping." },
    ]);
  });

  it("returns a parse error for invalid JSON", async () => {
    const res = await importDbExport("not json", { patients });
    expect(res.errors[0]?.table).toBe("(parse)");
  });
});
