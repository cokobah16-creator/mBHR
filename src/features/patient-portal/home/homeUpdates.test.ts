import { describe, it, expect } from "vitest";
import {
  HOME_LIST_LIMIT,
  NEW_RESULT_DAYS,
  nextOutreach,
  openRequests,
  recentResults,
} from "./homeUpdates";

const NOW = new Date("2026-09-26T12:00:00Z").getTime();
const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000);

describe("recentResults", () => {
  it("lists results released in the last NEW_RESULT_DAYS days, newest first", () => {
    const out = recentResults(
      [
        { resultId: "old", testName: "FBC", releasedAt: daysAgo(NEW_RESULT_DAYS + 1) },
        { resultId: "a", testName: "Malaria RDT", releasedAt: daysAgo(5) },
        { resultId: "b", testName: "Glucose", releasedAt: daysAgo(1) },
      ],
      NOW,
    );
    expect(out.map((r) => r.resultId)).toEqual(["b", "a"]);
  });

  it("uses the result date when there is no release date, and skips undated results", () => {
    const out = recentResults(
      [
        { resultId: "dated", testName: "HB", resultDate: daysAgo(2) },
        { resultId: "undated", testName: "HB" },
      ],
      NOW,
    );
    expect(out).toEqual([{ resultId: "dated", testName: "HB", availableAt: daysAgo(2) }]);
  });

  it(`lists at most ${HOME_LIST_LIMIT}`, () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      resultId: String(i),
      testName: "T",
      releasedAt: daysAgo(i),
    }));
    expect(recentResults(many, NOW)).toHaveLength(HOME_LIST_LIMIT);
  });
});

describe("openRequests", () => {
  it("keeps only requests still waiting on the care team, newest first", () => {
    const out = openRequests([
      { id: "1", status: "pending", created_at: "2026-09-20T10:00:00Z" },
      { id: "2", status: "approved", created_at: "2026-09-25T10:00:00Z" },
      { id: "3", status: "in_review", created_at: "2026-09-24T10:00:00Z", visit_mode: "televisit" },
      { id: "4", status: "declined", created_at: "2026-09-23T10:00:00Z" },
      { id: "5", status: null, created_at: "2026-09-22T10:00:00Z" },
    ]);
    expect(out.map((r) => [r.id, r.status, r.kind])).toEqual([
      ["3", "underReview", "televisit"],
      ["1", "submitted", "appointment"],
    ]);
    expect(out[1].storedStatus).toBe("pending");
  });

  it("skips a request with an unreadable date", () => {
    expect(openRequests([{ id: "1", status: "pending", created_at: "not a date" }])).toEqual([]);
  });
});

describe("nextOutreach", () => {
  const today = "2026-09-26";

  it("picks the soonest planned or running outreach from today on", () => {
    const out = nextOutreach(
      [
        { id: "past", event_name: "Past", event_date: "2026-09-01", status: "planned" },
        { id: "later", event_name: "Later", event_date: "2026-10-10", status: "planned" },
        { id: "done", event_name: "Done", event_date: "2026-09-27", status: "completed" },
        {
          id: "soon",
          event_name: " Kaduna outreach ",
          event_date: "2026-09-26",
          status: "active",
          sites: { name: "Town hall", lga: "Zaria", state: null },
        },
      ],
      today,
    );
    expect(out).toEqual({
      id: "soon",
      name: "Kaduna outreach",
      date: "2026-09-26",
      place: "Town hall, Zaria",
    });
  });

  it("returns null when nothing is coming up, and an empty name when unnamed", () => {
    expect(nextOutreach([], today)).toBeNull();
    expect(
      nextOutreach([{ id: "x", event_name: null, event_date: "2026-10-01", status: "planned" }], today),
    ).toEqual({ id: "x", name: "", date: "2026-10-01", place: undefined });
  });
});
