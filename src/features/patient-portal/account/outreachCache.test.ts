import { describe, it, expect } from "vitest";
import {
  localIsoDate,
  parseCachedList,
  parseSavedAt,
  shortTime,
  upcomingOnly,
} from "./outreachCache";

describe("parseCachedList", () => {
  it("returns [] for missing, invalid or non-array values", () => {
    expect(parseCachedList(null)).toEqual([]);
    expect(parseCachedList("nope")).toEqual([]);
    expect(parseCachedList('{"a":1}')).toEqual([]);
  });

  it("returns a stored array", () => {
    expect(parseCachedList<{ id: string }>('[{"id":"e1"}]')).toEqual([
      { id: "e1" },
    ]);
  });
});

describe("parseSavedAt", () => {
  it("parses an ISO time and rejects junk", () => {
    expect(parseSavedAt("2026-09-01T08:00:00.000Z")?.toISOString()).toBe(
      "2026-09-01T08:00:00.000Z",
    );
    expect(parseSavedAt("not a date")).toBeNull();
    expect(parseSavedAt(null)).toBeNull();
  });
});

describe("shortTime", () => {
  it("trims seconds from a time value", () => {
    expect(shortTime("09:30:00")).toBe("09:30");
    expect(shortTime(undefined)).toBe("");
  });
});

describe("localIsoDate", () => {
  it("formats the local calendar date", () => {
    expect(localIsoDate(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});

describe("upcomingOnly", () => {
  const events = [
    { id: "past", event_date: "2026-09-01" },
    { id: "today", event_date: "2026-09-23" },
    { id: "later", event_date: "2026-10-02" },
    { id: "no-date" },
  ];

  it("drops events dated before today and keeps today and later", () => {
    expect(upcomingOnly(events, "2026-09-23").map((e) => e.id)).toEqual([
      "today",
      "later",
      "no-date",
    ]);
  });
});
