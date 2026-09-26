import { describe, it, expect, vi, beforeEach } from "vitest";
import type { User } from "./index";

const { rows } = vi.hoisted(() => ({ rows: [] as User[] }));

// The staff table, hand-mocked: only what olderDeviceEntry reads.
vi.mock("./index", () => ({
  db: {
    users: {
      filter: (fn: (u: User) => boolean) => ({
        first: async () => rows.find(fn),
      }),
    },
  },
}));

import { olderDeviceEntry } from "./offlineAccess";

const ONLINE_ID = "1a6d08a8-605d-4acd-9dd8-04a89bbb2193";

function record(over: Partial<User> & { id: string }): User {
  return {
    fullName: "Ada Okafor",
    role: "admin",
    email: "ada@clinic.ng",
    pinHash: "hash",
    pinSalt: "salt",
    isActive: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  };
}

beforeEach(() => {
  rows.length = 0;
});

describe("olderDeviceEntry", () => {
  it("finds the switched-off entry with the same email and a PIN, ignoring case", async () => {
    const older = record({ id: "01J8ZX3K5N6P7Q8R9S0T1V2W3X", email: " ADA@Clinic.ng " });
    rows.push(record({ id: ONLINE_ID, isActive: 1 }), older);

    expect(await olderDeviceEntry({ id: ONLINE_ID, email: "ada@clinic.ng" })).toBe(older);
  });

  it("finds nothing without an email, a PIN, or when the entry is still on", async () => {
    rows.push(
      record({ id: "a", pinHash: "", pinSalt: "" }),
      record({ id: "b", isActive: 1 }),
      record({ id: "c", email: "someone@clinic.ng" }),
    );

    expect(await olderDeviceEntry({ id: ONLINE_ID, email: "ada@clinic.ng" })).toBeUndefined();
    expect(await olderDeviceEntry({ id: ONLINE_ID, email: "" })).toBeUndefined();
    expect(await olderDeviceEntry({ id: ONLINE_ID })).toBeUndefined();
  });

  it("never returns the person's own record", async () => {
    rows.push(record({ id: ONLINE_ID }));

    expect(await olderDeviceEntry({ id: ONLINE_ID, email: "ada@clinic.ng" })).toBeUndefined();
  });
});
