import type { ComponentType, SVGProps } from "react";
import {
  BeakerIcon,
  CubeIcon,
  ClipboardDocumentListIcon,
  ChartBarIcon,
  EnvelopeIcon,
} from "@heroicons/react/24/outline";
import type { Role } from "@/auth/roles";

export interface PharmacyTask {
  to: string;
  title: string;
  desc: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Mirrors the route guard in App.tsx so staff only see what they can open. */
  roles: Role[];
}

/**
 * Pharmacy tasks, shared by the nav's pharmacy menu and /pharmacy/menu.
 * Lives beside the shell, not in features/pharmacy (a separate build chunk),
 * because the shell loads at startup.
 */
export const PHARMACY_TASKS: PharmacyTask[] = [
  {
    to: "/rx/dispense",
    title: "Dispense",
    desc: "Record what was given and counsel the patient.",
    Icon: BeakerIcon,
    roles: ["pharmacist", "admin"],
  },
  {
    to: "/rx/stock",
    title: "Stock and expiry",
    desc: "Stock counts, lots, restocking and first-expiry-first-out.",
    Icon: CubeIcon,
    roles: ["pharmacist", "admin"],
  },
  {
    to: "/rx/new",
    title: "New prescription",
    desc: "Write a prescription for a patient to collect at pharmacy.",
    Icon: ClipboardDocumentListIcon,
    roles: ["doctor", "nurse", "admin"],
  },
  {
    to: "/pharmacy/sms-reminders",
    title: "SMS reminders",
    desc: "Medication reminders for patients and whether each has been sent.",
    Icon: EnvelopeIcon,
    roles: ["pharmacist", "admin"],
  },
  {
    to: "/pharmacy/reports",
    title: "Reports",
    desc: "Dispensing summary, expiring lots and stock levels.",
    Icon: ChartBarIcon,
    roles: ["pharmacist", "admin"],
  },
];

export function pharmacyTasksForRole(role: Role | null | undefined): PharmacyTask[] {
  return role ? PHARMACY_TASKS.filter((t) => t.roles.includes(role)) : [];
}
