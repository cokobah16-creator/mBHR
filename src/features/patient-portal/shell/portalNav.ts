import type { ComponentType, SVGProps } from "react";
import {
  HomeIcon,
  ClipboardDocumentListIcon,
  BeakerIcon,
  HeartIcon,
  ArchiveBoxIcon,
  CalendarDaysIcon,
  ChatBubbleLeftRightIcon,
  FolderIcon,
  ArrowDownTrayIcon,
  UserCircleIcon,
  VideoCameraIcon,
  MapPinIcon,
  ShieldCheckIcon,
  UserPlusIcon,
} from "@heroicons/react/24/outline";

export type NavIcon = ComponentType<SVGProps<SVGSVGElement>>;

export interface NavItem {
  path: string;
  labelKey: string;
  icon: NavIcon;
  /** Extra path prefixes that count as this section (e.g. a visit's detail page). */
  match?: string[];
}

// Portal sections, in the order patients look for them. Every path is an
// existing route under /patient/* in App.tsx.
export const PRIMARY_NAV: NavItem[] = [
  { path: "/patient/dashboard", labelKey: "portal.nav.home", icon: HomeIcon },
  {
    path: "/patient/medical-history",
    labelKey: "portal.nav.visits",
    icon: ClipboardDocumentListIcon,
    match: ["/patient/visit"],
  },
  {
    path: "/patient/lab-results",
    labelKey: "portal.nav.labResults",
    icon: BeakerIcon,
  },
  {
    path: "/patient/conditions",
    labelKey: "portal.nav.conditions",
    icon: HeartIcon,
  },
  {
    path: "/patient/prescriptions",
    labelKey: "portal.nav.medicines",
    icon: ArchiveBoxIcon,
  },
  {
    path: "/patient/appointments",
    labelKey: "portal.nav.appointments",
    icon: CalendarDaysIcon,
  },
  {
    path: "/patient/messages",
    labelKey: "portal.nav.messages",
    icon: ChatBubbleLeftRightIcon,
  },
  {
    path: "/patient/documents",
    labelKey: "portal.nav.documents",
    icon: FolderIcon,
  },
  {
    path: "/patient/export",
    labelKey: "portal.nav.myHealthData",
    icon: ArrowDownTrayIcon,
  },
  {
    path: "/patient/account",
    labelKey: "portal.nav.account",
    icon: UserCircleIcon,
  },
];

export const OTHER_NAV: NavItem[] = [
  {
    path: "/patient/telehealth",
    labelKey: "portal.nav.telehealth",
    icon: VideoCameraIcon,
  },
  {
    path: "/patient/outreach",
    labelKey: "portal.action.findOutreach",
    icon: MapPinIcon,
  },
  {
    path: "/patient/data-sharing",
    labelKey: "portal.action.dataSharing",
    icon: ShieldCheckIcon,
  },
  {
    path: "/patient/caregiver/add",
    labelKey: "portal.profile.addCaregiverShort",
    icon: UserPlusIcon,
  },
];

// Mobile bottom bar: the four places patients go most, then "More".
export const BOTTOM_PATHS = [
  "/patient/dashboard",
  "/patient/medical-history",
  "/patient/messages",
  "/patient/appointments",
];

export const BOTTOM_NAV: NavItem[] = BOTTOM_PATHS.map(
  (path) => PRIMARY_NAV.find((i) => i.path === path) as NavItem,
);
export const MORE_NAV: NavItem[] = PRIMARY_NAV.filter(
  (i) => !BOTTOM_PATHS.includes(i.path),
);

export function isActivePath(pathname: string, item: NavItem): boolean {
  return [item.path, ...(item.match ?? [])].some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/** True when the page shown lives behind "More" on phones. */
export function isMoreActive(pathname: string): boolean {
  return [...MORE_NAV, ...OTHER_NAV].some((i) => isActivePath(pathname, i));
}
