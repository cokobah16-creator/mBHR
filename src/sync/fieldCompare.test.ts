import { describe, it, expect } from "vitest";
import {
  findFieldConflicts,
  sameSyncValue,
  stableStringify,
  timeOf,
} from "./fieldCompare";

describe("timeOf", () => {
  it("reads Date objects and ISO strings as the same instant", () => {
    const date = new Date("2024-03-05T10:15:30.123Z");
    expect(timeOf(date)).toBe(date.getTime());
    expect(timeOf("2024-03-05T10:15:30.123Z")).toBe(date.getTime());
    expect(timeOf("2024-03-05T10:15:30.123+00:00")).toBe(date.getTime());
  });

  it("truncates Postgres microseconds to milliseconds", () => {
    expect(timeOf("2024-03-05T10:15:30.123456+00:00")).toBe(
      Date.parse("2024-03-05T10:15:30.123Z"),
    );
  });

  it("accepts short zone offsets and a space separator", () => {
    const expected = Date.parse("2024-03-05T09:15:30.000Z");
    expect(timeOf("2024-03-05 10:15:30+01")).toBe(expected);
    expect(timeOf("2024-03-05T10:15:30+0100")).toBe(expected);
    expect(timeOf("2024-03-05T10:15:30+01:00")).toBe(expected);
  });

  it("reads date-only strings", () => {
    expect(timeOf("1990-05-01")).toBe(Date.parse("1990-05-01"));
  });

  it("never reads phone numbers, plain numbers or text as dates", () => {
    expect(timeOf("08012345678")).toBeNull();
    expect(timeOf("2024")).toBeNull();
    expect(timeOf(20240305)).toBeNull();
    expect(timeOf("Headache for 2024-03-05")).toBeNull();
    expect(timeOf(new Date("not a date"))).toBeNull();
    expect(timeOf("2024-13-45")).toBeNull();
  });
});

describe("stableStringify", () => {
  it("ignores object key order at every level", () => {
    expect(stableStringify({ a: 1, b: { c: 2, d: 3 } })).toBe(
      stableStringify({ b: { d: 3, c: 2 }, a: 1 }),
    );
  });

  it("keeps array order", () => {
    expect(stableStringify(["a", "b"])).not.toBe(stableStringify(["b", "a"]));
  });

  it("drops undefined properties and writes dates as ISO strings", () => {
    expect(stableStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(stableStringify({ at: new Date("2024-01-01T00:00:00Z") })).toBe(
      '{"at":"2024-01-01T00:00:00.000Z"}',
    );
  });
});

describe("sameSyncValue", () => {
  it("treats null, undefined and empty text as the same empty value", () => {
    expect(sameSyncValue(undefined, null)).toBe(true);
    expect(sameSyncValue(null, undefined)).toBe(true);
    expect(sameSyncValue("", null)).toBe(true);
    expect(sameSyncValue(undefined, "")).toBe(true);
  });

  it("treats an empty value and a real value as different", () => {
    expect(sameSyncValue(null, "08012345678")).toBe(false);
    expect(sameSyncValue("Ada", undefined)).toBe(false);
    expect(sameSyncValue(0, null)).toBe(false);
    expect(sameSyncValue(false, null)).toBe(false);
  });

  it("compares a Date with its ISO string by instant", () => {
    const date = new Date("2024-03-05T10:15:30.123Z");
    expect(sameSyncValue(date, "2024-03-05T10:15:30.123+00:00")).toBe(true);
    expect(sameSyncValue("2024-03-05T10:15:30.123456+00:00", date)).toBe(true);
    expect(sameSyncValue(date, new Date(date.getTime()))).toBe(true);
  });

  it("reports different instants as different", () => {
    expect(
      sameSyncValue(new Date("2024-03-05T10:15:30Z"), "2024-03-05T10:15:31Z"),
    ).toBe(false);
  });

  it("does not treat a date and non-date text as equal", () => {
    expect(sameSyncValue(new Date("2024-03-05T00:00:00Z"), "yesterday")).toBe(false);
  });

  it("compares objects and arrays by content", () => {
    expect(sameSyncValue({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(sameSyncValue(["high_bp"], ["high_bp"])).toBe(true);
    expect(sameSyncValue(["high_bp"], ["fever"])).toBe(false);
    expect(sameSyncValue({ high_bp: true }, { high_bp: false })).toBe(false);
    expect(sameSyncValue([], {})).toBe(false);
  });

  it("compares other values strictly", () => {
    expect(sameSyncValue("Ada", "Ada")).toBe(true);
    expect(sameSyncValue("Ada", "ada")).toBe(false);
    expect(sameSyncValue(37.5, 37.5)).toBe(true);
    expect(sameSyncValue(37.5, "37.5")).toBe(false);
    expect(sameSyncValue(1, true)).toBe(false);
  });
});

describe("findFieldConflicts", () => {
  const columnMap = {
    id: "id",
    givenName: "given_name",
    phone: "phone",
    photoUrl: "photo_url",
    dob: "dob",
    flags: "flags",
    takenAt: "taken_at",
    createdAt: "created_at",
    updatedAt: "updated_at",
  };

  it("finds no conflict when only the representation differs", () => {
    const local = {
      id: "p1",
      givenName: "Ada",
      phone: null,
      dob: "1990-05-01",
      flags: ["high_bp"],
      takenAt: new Date("2024-03-05T10:15:30.123Z"),
    };
    const remote = {
      id: "p1",
      given_name: "Ada",
      phone: null,
      photo_url: null,
      dob: "1990-05-01",
      flags: ["high_bp"],
      taken_at: "2024-03-05T10:15:30.123456+00:00",
    };
    expect(findFieldConflicts(local, remote, columnMap)).toEqual([]);
  });

  it("ignores bookkeeping timestamps", () => {
    const local = { id: "p1", createdAt: new Date(0), updatedAt: new Date(1) };
    const remote = {
      id: "p1",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-02T00:00:00Z",
    };
    expect(findFieldConflicts(local, remote, columnMap)).toEqual([]);
  });

  it("skips fields this device does not hold, since the upload leaves them out", () => {
    const local = { id: "p1", givenName: "Ada" };
    const remote = { id: "p1", given_name: "Ada", phone: "08012345678" };
    expect(findFieldConflicts(local, remote, columnMap)).toEqual([]);
  });

  it("reports a cleared field on this device against a server value", () => {
    const local = { id: "p1", phone: null };
    const remote = { id: "p1", phone: "08012345678" };
    const conflicts = findFieldConflicts(local, remote, columnMap);
    expect(conflicts.map((c) => c.field)).toEqual(["phone"]);
  });

  it("reports real differences with label, both values and type", () => {
    const local = {
      id: "p1",
      givenName: "Ada",
      takenAt: new Date("2024-03-05T10:00:00Z"),
      flags: ["high_bp"],
    };
    const remote = {
      id: "p1",
      given_name: "Adaeze",
      taken_at: "2024-03-05T11:00:00Z",
      flags: [],
    };
    expect(findFieldConflicts(local, remote, columnMap)).toEqual([
      {
        field: "givenName",
        label: "given Name",
        localValue: "Ada",
        remoteValue: "Adaeze",
        type: "string",
      },
      {
        field: "flags",
        label: "flags",
        localValue: ["high_bp"],
        remoteValue: [],
        type: "object",
      },
      {
        field: "takenAt",
        label: "taken At",
        localValue: local.takenAt,
        remoteValue: "2024-03-05T11:00:00Z",
        type: "date",
      },
    ]);
  });
});
