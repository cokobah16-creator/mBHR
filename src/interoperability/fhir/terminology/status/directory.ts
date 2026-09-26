// Location.status <- public.sites.is_active (mappers/directory.ts).

import type { StatusMap } from "../statusMaps";

export type LocationStatus = "active" | "suspended" | "inactive";

/**
 * sites.is_active is a boolean; it is compared as the text PostgREST would
 * give for it ("true" / "false"). R4 location-status has no "unknown", so a
 * missing flag leaves the element out.
 */
export const LOCATION_STATUS: StatusMap<LocationStatus> = {
  element: "Location.status",
  source: "public.sites.is_active",
  valueSet: "http://hl7.org/fhir/ValueSet/location-status",
  allowed: ["active", "suspended", "inactive"],
  rules: [
    {
      source: ["true"],
      fhir: "active",
      reason: "The site is marked in use in the server registry (it is also listed publicly).",
    },
    {
      source: ["false"],
      fhir: "inactive",
      reason:
        "The site is switched off in the registry. Not suspended: mBHR does not record a temporary closure.",
    },
  ],
  missing: { fhir: null, reason: "No flag recorded: left out (R4 location-status has no unknown code)." },
  unrecognised: { fhir: null, reason: "Not a recorded true/false flag: left out, not guessed." },
};

/** This area's status maps (for the shared status map tests and docs). */
export const DIRECTORY_STATUS_MAPS: readonly StatusMap[] = [LOCATION_STATUS];
