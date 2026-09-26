import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  BOTTOM_NAV,
  MORE_NAV,
  OTHER_NAV,
  PRIMARY_NAV,
  isActivePath,
  isMoreActive,
} from "./portalNav";

describe("portal navigation", () => {
  it("puts Home, Visits, Messages and Appointments on the phone bottom bar", () => {
    expect(BOTTOM_NAV.map((i) => i.path)).toEqual([
      "/patient/dashboard",
      "/patient/medical-history",
      "/patient/messages",
      "/patient/appointments",
    ]);
  });

  it("keeps every other section reachable from More", () => {
    const reachable = new Set(
      [...BOTTOM_NAV, ...MORE_NAV, ...OTHER_NAV].map((i) => i.path),
    );
    for (const item of [...PRIMARY_NAV, ...OTHER_NAV]) {
      expect(reachable.has(item.path)).toBe(true);
    }
    expect(MORE_NAV.some((i) => BOTTOM_NAV.includes(i))).toBe(false);
  });

  it("only links to routes the app defines", () => {
    const app = readFileSync(path.resolve(__dirname, "../../../App.tsx"), "utf8");
    for (const item of [...PRIMARY_NAV, ...OTHER_NAV]) {
      const sub = item.path.replace("/patient", "");
      expect(app).toContain(`path="${sub}"`);
    }
  });

  it("marks Visits active on a visit's detail page", () => {
    const visits = PRIMARY_NAV.find((i) => i.path === "/patient/medical-history")!;
    expect(isActivePath("/patient/visit/abc", visits)).toBe(true);
    expect(isActivePath("/patient/medical-history", visits)).toBe(true);
    expect(isActivePath("/patient/messages", visits)).toBe(false);
  });

  it("does not treat a longer sibling path as the same section", () => {
    const home = PRIMARY_NAV[0];
    expect(isActivePath("/patient/dashboard-old", home)).toBe(false);
  });

  it("highlights More for pages that live behind it", () => {
    expect(isMoreActive("/patient/lab-results")).toBe(true);
    expect(isMoreActive("/patient/outreach")).toBe(true);
    expect(isMoreActive("/patient/messages")).toBe(false);
  });
});
