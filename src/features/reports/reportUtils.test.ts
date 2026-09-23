import { describe, it, expect } from "vitest";
import {
  toTime,
  isInRange,
  localDateKey,
  parseLocalDateKey,
  localRangeBounds,
  listLocalDays,
  countByLocalDay,
  daysUntil,
  averageMinutes,
  percentOf,
  describeChange,
  toCsv,
  csvFileName,
} from "./reportUtils";
import {
  filterByPeriod,
  summariseDispensing,
  stockLevel,
  stockCoverPercent,
  sortByStockCover,
  expiryLevel,
  describeDaysLeft,
  isPharmacyPeriod,
} from "./pharmacyReportUtils";

describe("toTime / isInRange", () => {
  it("accepts Date objects and ISO strings alike", () => {
    const d = new Date(2026, 8, 23, 10, 0);
    expect(toTime(d)).toBe(d.getTime());
    expect(toTime(d.toISOString())).toBe(d.getTime());
  });

  it("returns null for missing or invalid values", () => {
    expect(toTime(undefined)).toBeNull();
    expect(toTime(null)).toBeNull();
    expect(toTime("")).toBeNull();
    expect(toTime("not a date")).toBeNull();
  });

  it("treats the range as start-inclusive, end-exclusive", () => {
    const start = new Date(2026, 8, 23);
    const end = new Date(2026, 8, 24);
    expect(isInRange(start, start, end)).toBe(true);
    expect(isInRange(end, start, end)).toBe(false);
    expect(isInRange(new Date(2026, 8, 23, 23, 59).toISOString(), start, end)).toBe(true);
    expect(isInRange(undefined, start, end)).toBe(false);
  });
});

describe("local dates", () => {
  it("formats the local calendar day, not the UTC day", () => {
    // 00:30 local is still the same local day regardless of time zone.
    expect(localDateKey(new Date(2026, 8, 23, 0, 30))).toBe("2026-09-23");
    expect(localDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("parses yyyy-mm-dd as local midnight and rejects bad input", () => {
    const d = parseLocalDateKey("2026-09-23");
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(8);
    expect(d?.getDate()).toBe(23);
    expect(d?.getHours()).toBe(0);
    expect(parseLocalDateKey("2026-02-30")).toBeNull();
    expect(parseLocalDateKey("23/09/2026")).toBeNull();
    expect(parseLocalDateKey("")).toBeNull();
  });

  it("builds inclusive-day bounds and rejects reversed ranges", () => {
    const b = localRangeBounds("2026-09-20", "2026-09-23");
    expect(b?.start.getTime()).toBe(new Date(2026, 8, 20).getTime());
    expect(b?.end.getTime()).toBe(new Date(2026, 8, 24).getTime());
    expect(localRangeBounds("2026-09-24", "2026-09-23")).toBeNull();
    expect(localRangeBounds("", "2026-09-23")).toBeNull();
  });

  it("lists every day in the range", () => {
    const days = listLocalDays(new Date(2026, 8, 20), new Date(2026, 8, 23));
    expect(days.map(localDateKey)).toEqual(["2026-09-20", "2026-09-21", "2026-09-22"]);
  });
});

describe("countByLocalDay", () => {
  it("counts Date and string timestamps per local day, including empty days", () => {
    const start = new Date(2026, 8, 20);
    const end = new Date(2026, 8, 23);
    const counts = countByLocalDay(
      [
        new Date(2026, 8, 20, 9),
        new Date(2026, 8, 20, 17).toISOString(),
        new Date(2026, 8, 22, 8),
        new Date(2026, 8, 23, 8), // outside (end exclusive)
        "garbage",
        undefined,
      ],
      start,
      end,
    );
    expect([...counts.entries()]).toEqual([
      ["2026-09-20", 2],
      ["2026-09-21", 0],
      ["2026-09-22", 1],
    ]);
  });
});

describe("daysUntil / averageMinutes / percentOf / describeChange", () => {
  it("rounds days up and goes negative once past", () => {
    const now = new Date(2026, 8, 23, 12);
    expect(daysUntil(new Date(2026, 8, 30, 12), now)).toBe(7);
    expect(daysUntil(new Date(2026, 8, 23, 13), now)).toBe(1);
    expect(daysUntil(new Date(2026, 8, 20, 12), now)).toBe(-3);
    expect(daysUntil(undefined, now)).toBeNull();
  });

  it("averages only complete, forward pairs", () => {
    const t0 = new Date(2026, 8, 23, 9, 0);
    expect(
      averageMinutes([
        { start: t0, end: new Date(2026, 8, 23, 9, 10) },
        { start: t0.toISOString(), end: new Date(2026, 8, 23, 9, 30) },
        { start: undefined, end: t0 },
        { start: new Date(2026, 8, 23, 10), end: t0 },
      ]),
    ).toEqual({ minutes: 20, count: 2 });
    expect(averageMinutes([])).toBeNull();
  });

  it("handles zero totals", () => {
    expect(percentOf(3, 0)).toBe(0);
    expect(percentOf(1, 3)).toBe(33);
  });

  it("describes changes in words", () => {
    expect(describeChange(5, 2, "yesterday")).toBe("3 more than yesterday");
    expect(describeChange(2, 5, "yesterday")).toBe("3 fewer than yesterday");
    expect(describeChange(4, 4, "yesterday")).toBe("Same as yesterday");
  });
});

describe("toCsv", () => {
  it("quotes commas, quotes and new lines", () => {
    expect(toCsv(["a", "b"], [["x,y", 'say "hi"'], ["line\nbreak", 3]])).toBe(
      'a,b\r\n"x,y","say ""hi"""\r\n"line\nbreak",3',
    );
  });

  it("neutralises spreadsheet formulas but keeps negative numbers", () => {
    expect(toCsv(["v"], [["=SUM(A1)"], ["-5"], ["@cmd"], [-5]])).toBe(
      "v\r\n'=SUM(A1)\r\n-5\r\n'@cmd\r\n-5",
    );
  });

  it("writes dates as local yyyy-mm-dd and blanks for missing values", () => {
    expect(toCsv(["d", "n"], [[new Date(2026, 8, 23, 0, 30), null]])).toBe("d,n\r\n2026-09-23,");
  });

  it("names files with the local date", () => {
    expect(csvFileName("stock_report", new Date(2026, 8, 23, 0, 30))).toBe(
      "stock_report_2026-09-23.csv",
    );
  });
});

describe("pharmacy report derivations", () => {
  const now = new Date(2026, 8, 23, 12);
  const records = [
    { patientId: "p1", itemName: "Paracetamol", qty: 10, dispensedAt: new Date(2026, 8, 22) },
    { patientId: "p1", itemName: "Amoxicillin", qty: 15, dispensedAt: new Date(2026, 8, 20).toISOString() },
    { patientId: "p2", itemName: "Paracetamol", qty: 20, dispensedAt: new Date(2026, 7, 1) },
  ];

  it("filters by rolling period, accepting string dates", () => {
    expect(filterByPeriod(records, "7d", now)).toHaveLength(2);
    expect(filterByPeriod(records, "all", now)).toHaveLength(3);
  });

  it("summarises units, patients and records per day", () => {
    const inPeriod = filterByPeriod(records, "7d", now);
    const s = summariseDispensing(inPeriod, records, "7d", now);
    expect(s.unitsDispensed).toBe(25);
    expect(s.records).toBe(2);
    expect(s.uniquePatients).toBe(1);
    expect(s.days).toBe(7);
    expect(s.recordsPerDay).toBe(0.3);
    expect(s.topMedicines[0]).toEqual({ name: "Amoxicillin", units: 15 });
  });

  it("averages all records over the days since the first dispense", () => {
    const s = summariseDispensing(records, records, "all", now);
    expect(s.days).toBe(Math.ceil((now.getTime() - new Date(2026, 7, 1).getTime()) / 86400000));
    expect(summariseDispensing([], [], "all", now).days).toBe(1);
  });

  it("classifies stock with the existing reorder rule", () => {
    expect(stockLevel({ onHandQty: 0, reorderThreshold: 10 })).toBe("out");
    expect(stockLevel({ onHandQty: 10, reorderThreshold: 10 })).toBe("low");
    expect(stockLevel({ onHandQty: 11, reorderThreshold: 10 })).toBe("ok");
    expect(stockCoverPercent({ onHandQty: 15, reorderThreshold: 10 })).toBe(150);
    expect(stockCoverPercent({ onHandQty: 15, reorderThreshold: 0 })).toBeNull();
  });

  it("sorts lowest cover first without mutating, unset reorder levels last", () => {
    const items = [
      { itemName: "B", onHandQty: 50, reorderThreshold: 10 },
      { itemName: "A", onHandQty: 5, reorderThreshold: 0 },
      { itemName: "C", onHandQty: 5, reorderThreshold: 10 },
    ];
    const sorted = sortByStockCover(items);
    expect(sorted.map((i) => i.itemName)).toEqual(["C", "B", "A"]);
    expect(items[0].itemName).toBe("B");
  });

  it("keeps the 7/30/90-day expiry windows", () => {
    expect(expiryLevel(0)).toBe("expired");
    expect(expiryLevel(-4)).toBe("expired");
    expect(expiryLevel(7)).toBe("week");
    expect(expiryLevel(8)).toBe("month");
    expect(expiryLevel(30)).toBe("month");
    expect(expiryLevel(31)).toBe("quarter");
    expect(describeDaysLeft(1)).toBe("1 day");
    expect(describeDaysLeft(-1)).toBe("Expired");
  });

  it("recognises valid periods", () => {
    expect(isPharmacyPeriod("30d")).toBe(true);
    expect(isPharmacyPeriod("1y")).toBe(false);
  });
});
