import { describe, it, expect } from "vitest";
import { pharmacyTasksForRole } from "./pharmacyTasks";

const paths = (role: Parameters<typeof pharmacyTasksForRole>[0]) =>
  pharmacyTasksForRole(role).map((t) => t.to);

describe("pharmacyTasksForRole", () => {
  it("gives pharmacists dispensing, stock, reminders and reports", () => {
    expect(paths("pharmacist")).toEqual([
      "/rx/dispense",
      "/rx/stock",
      "/pharmacy/sms-reminders",
      "/pharmacy/reports",
    ]);
  });

  it("gives prescribers only the prescription form", () => {
    expect(paths("doctor")).toEqual(["/rx/new"]);
    expect(paths("nurse")).toEqual(["/rx/new"]);
  });

  it("gives admins everything", () => {
    expect(paths("admin")).toHaveLength(5);
  });

  it("gives nothing to roles without pharmacy access or no user", () => {
    expect(paths("volunteer")).toEqual([]);
    expect(paths(null)).toEqual([]);
  });
});
