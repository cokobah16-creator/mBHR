import { describe, it, expect, vi, beforeEach } from "vitest";
import type Dexie from "dexie";
import { closeOnVersionChange } from "./versionChange";
import { useAppUpdateStore } from "@/stores/appUpdate";

type Handler = (event: { newVersion: number | null }) => unknown;

function fakeDatabase() {
  const handlers: Handler[] = [];
  const database = {
    on: vi.fn((name: string, handler: Handler) => {
      if (name === "versionchange") handlers.push(handler);
    }),
    close: vi.fn(),
  };
  return {
    database,
    fire: (newVersion: number | null) =>
      handlers.forEach((handler) => handler({ newVersion })),
  };
}

describe("closeOnVersionChange", () => {
  beforeEach(() => {
    useAppUpdateStore.setState({ databaseClosed: null, reloadToUpdate: null });
  });

  it("closes the database and asks for a reload when another window upgrades it", () => {
    const main = fakeDatabase();
    const pharmacy = fakeDatabase();
    closeOnVersionChange([main.database, pharmacy.database] as unknown as Dexie[]);

    pharmacy.fire(6);

    expect(pharmacy.database.close).toHaveBeenCalled();
    expect(main.database.close).not.toHaveBeenCalled();
    expect(useAppUpdateStore.getState().databaseClosed).toBe("upgraded");
  });

  it("closes the database when another window erases this device's data", () => {
    const main = fakeDatabase();
    closeOnVersionChange([main.database] as unknown as Dexie[]);

    main.fire(null);

    expect(main.database.close).toHaveBeenCalled();
    expect(useAppUpdateStore.getState().databaseClosed).toBe("erased");
  });

  it("does nothing until another window asks", () => {
    const main = fakeDatabase();
    closeOnVersionChange([main.database] as unknown as Dexie[]);

    expect(main.database.close).not.toHaveBeenCalled();
    expect(useAppUpdateStore.getState().databaseClosed).toBeNull();
  });
});
