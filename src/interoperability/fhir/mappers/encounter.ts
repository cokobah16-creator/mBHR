// public.visits -> Encounter
//
// A visit is one patient's attendance at an outreach clinic or site: the
// clinical interaction mBHR records. Queue tickets are not encounters and
// are not published. mBHR has no inpatient care, so every visit is
// ambulatory (v3 ActCode AMB). visits.status is free text; only the values
// the app writes are translated (ENCOUNTER_STATUS), and anything else is
// "unknown" rather than a guess.

import type { Encounter } from "../types/fhir";
import { V3_ACT_CODE } from "../terminology/codeSystems";
import { mapEncounterStatus } from "../terminology/statusMaps";
import { instant, patientReference, str, versionMeta, type MapContext, type Row } from "./common";

export const VISIT_COLUMNS = ["id", "patient_id", "started_at", "site_name", "status", "updated_at"] as const;

/**
 * site_name values that are not places:
 *   "Mobile Clinic"  the tablet's default when no site was chosen
 *   "Portal entry"   a visit a staff member recorded afterwards from the
 *                    online dashboard (created closed, at the time of entry)
 */
export const NOT_A_PLACE = ["mobile clinic", "portal entry"];
export const PORTAL_ENTRY_SITE = "portal entry";

/**
 * visits.status -> Encounter.status (see ENCOUNTER_STATUS in
 * terminology/statusMaps.ts). The raw column value, untrimmed: the map and
 * the status search compare it exactly, so a padded " closed" is unknown
 * everywhere, never finished.
 */
export function mapVisitStatus(status: unknown): Encounter["status"] {
  return mapEncounterStatus(status);
}

export function mapEncounter(row: Row, ctx: MapContext): Encounter | null {
  const id = str(row, "id");
  const subject = patientReference(ctx, row.patient_id);
  if (!id || !subject) return null;

  const encounter: Encounter = {
    resourceType: "Encounter",
    id,
    meta: versionMeta(row),
    status: mapVisitStatus(row.status),
    class: { system: V3_ACT_CODE, code: "AMB", display: "ambulatory" },
    subject,
  };
  const site = str(row, "site_name");
  const portalEntry = site?.toLowerCase() === PORTAL_ENTRY_SITE;
  // A "Portal entry" visit's start time is when it was typed in, not when
  // care happened, so no period is published for it.
  const start = portalEntry ? undefined : instant(row, "started_at");
  if (start) encounter.period = { start };
  // The site is free text chosen on the tablet (not a registered Location),
  // so it is published as a display-only reference, and not at all when it
  // does not name a place.
  if (site && !NOT_A_PLACE.includes(site.toLowerCase())) encounter.location = [{ location: { display: site } }];
  return encounter;
}
