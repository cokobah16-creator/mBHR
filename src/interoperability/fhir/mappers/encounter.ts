// public.visits -> Encounter
//
// A visit is one patient's attendance at an outreach clinic or site: the
// clinical interaction mBHR records. Queue tickets are not encounters and
// are not published. mBHR has no inpatient care, so every visit is
// ambulatory (v3 ActCode AMB). visits.status is free text; only the values
// the app writes are translated, and anything else is "unknown" rather than
// a guess.

import type { Encounter } from "../types/fhir";
import { V3_ACT_CODE } from "../terminology/codeSystems";
import { instant, patientReference, str, versionMeta, type MapContext, type Row } from "./common";

export const VISIT_COLUMNS = ["id", "patient_id", "started_at", "site_name", "status", "updated_at"] as const;

export function mapVisitStatus(status: string | undefined): Encounter["status"] {
  switch ((status ?? "").trim().toLowerCase()) {
    case "open":
    case "in_progress":
    case "in-progress":
    case "active":
      return "in-progress";
    case "closed":
    case "completed":
    case "finished":
      return "finished";
    case "cancelled":
      return "cancelled";
    default:
      return "unknown";
  }
}

export function mapEncounter(row: Row, ctx: MapContext): Encounter | null {
  const id = str(row, "id");
  const subject = patientReference(ctx, row.patient_id);
  if (!id || !subject) return null;

  const encounter: Encounter = {
    resourceType: "Encounter",
    id,
    meta: versionMeta(row),
    status: mapVisitStatus(str(row, "status")),
    class: { system: V3_ACT_CODE, code: "AMB", display: "ambulatory" },
    subject,
  };
  const start = instant(row, "started_at");
  if (start) encounter.period = { start };
  const site = str(row, "site_name");
  // The site is free text in mBHR (no Location record yet), so it is
  // published as a display-only reference.
  if (site) encounter.location = [{ location: { display: site } }];
  return encounter;
}
