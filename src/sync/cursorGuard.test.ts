import { describe, expect, it } from "vitest";
import { advanceCursor, CURSOR_MAX_AHEAD_MS, isCursorAhead } from "./cursorGuard";

const NOW = Date.parse("2026-09-25T12:00:00.000Z");

describe("advanceCursor", () => {
  it("moves to a later row", () => {
    expect(
      advanceCursor("2026-09-25T10:00:00.000Z", "2026-09-25T11:00:00+00:00", NOW),
    ).toBe("2026-09-25T11:00:00+00:00");
  });

  it("does not move back to an earlier row or the same time in another format", () => {
    const cursor = "2026-09-25T11:00:00.000Z";
    expect(advanceCursor(cursor, "2026-09-25T10:00:00.000Z", NOW)).toBe(cursor);
    expect(advanceCursor(cursor, "2026-09-25T11:00:00+00:00", NOW)).toBe(cursor);
  });

  it("does not move past this device's clock for a future-dated row", () => {
    const cursor = "2026-09-25T11:00:00.000Z";
    expect(advanceCursor(cursor, "2999-01-01T00:00:00Z", NOW)).toBe(cursor);
    const justAhead = new Date(NOW + CURSOR_MAX_AHEAD_MS - 1000).toISOString();
    expect(advanceCursor(cursor, justAhead, NOW)).toBe(justAhead);
  });

  it("ignores rows without a usable timestamp", () => {
    const cursor = "2026-09-25T11:00:00.000Z";
    expect(advanceCursor(cursor, undefined, NOW)).toBe(cursor);
    expect(advanceCursor(cursor, "", NOW)).toBe(cursor);
    expect(advanceCursor(cursor, "not a date", NOW)).toBe(cursor);
  });

  it("starts from an empty cursor", () => {
    expect(advanceCursor("", "2026-09-25T11:00:00.000Z", NOW)).toBe(
      "2026-09-25T11:00:00.000Z",
    );
  });
});

describe("isCursorAhead", () => {
  it("flags a saved cursor in the future only", () => {
    expect(isCursorAhead("2999-01-01T00:00:00.000Z", NOW)).toBe(true);
    expect(isCursorAhead("2026-09-25T11:59:00.000Z", NOW)).toBe(false);
    expect(isCursorAhead("1970-01-01T00:00:00.000Z", NOW)).toBe(false);
    expect(isCursorAhead("not a date", NOW)).toBe(false);
  });
});
