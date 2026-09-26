// Staff directory and places -> Practitioner, PractitionerRole, Organization
// and Location.
//
// These four types are reference data, not patient data: who works in mBHR
// (name and access role only) and the organisations and sites registered on
// the server. The rules this file keeps:
//
//   - Staff are published under a random id minted once per account
//     (public.fhir_staff_directory keeps it in interop.resource_links). The
//     account id (the sign-in id, or a device id for staff added offline),
//     email, phone and any credential column are never published, not even
//     as an identifier.
//   - A staff name is published as recorded, as text only: names may carry
//     titles ("Dr. ...") and are typed by an admin, so they are not split
//     into given and family names.
//   - The mBHR role is an access role (a bundle of app permissions an admin
//     assigns), not a qualification or licence. It is published only as a
//     local code on PractitionerRole, never as Practitioner.qualification or
//     a SNOMED/v2 practitioner code.
//   - Only the 8 staff roles are staff. guest, legacy roles and anything
//     unrecognised are never published.
//   - active / status come only from a recorded flag. A missing flag is
//     unknown and the element is left out; it never becomes active.
//   - Organisations and sites come from the server registry only
//     (public.organizations, public.sites); nothing is hard-coded. The
//     tablet's local site names ("Mobile Clinic", "Portal entry" and the
//     like on visits) are not places in that registry and never become
//     Locations.
//
// Mappers are pure: rows in, FHIR JSON out (see mappers/common.ts).

import type { Address, CodeableConcept, HumanName, Reference, Resource } from "../types/fhir";
import { MBHR_CODES } from "../terminology/codeSystems";
import { applyStatusMap } from "../terminology/statusMaps";
import { LOCATION_STATUS } from "../terminology/status/directory";
import { FHIR_ID } from "../search/params";
import { UUID } from "../resources/shared";
import { NOT_A_PLACE } from "./encounter";
import { str, versionMeta, type Row } from "./common";

// ---------------------------------------------------------------------------
// FHIR shapes (only the elements these mappers fill)
// ---------------------------------------------------------------------------

export interface Practitioner extends Resource {
  resourceType: "Practitioner";
  active?: boolean;
  name?: HumanName[];
}

export interface PractitionerRole extends Resource {
  resourceType: "PractitionerRole";
  active?: boolean;
  practitioner: Reference;
  code: CodeableConcept[];
}

export interface Organization extends Resource {
  resourceType: "Organization";
  active?: boolean;
  name: string;
}

import type { LocationStatus } from "../terminology/status/directory";
export type { LocationStatus };

export interface Location extends Resource {
  resourceType: "Location";
  status?: LocationStatus;
  name: string;
  mode: "instance";
  address?: Address;
  managingOrganization?: Reference;
}

// ---------------------------------------------------------------------------
// Staff roles (PractitionerRole.code)
// ---------------------------------------------------------------------------

/** mBHR's own code system for staff access roles. */
export const STAFF_ROLE_SYSTEM = `${MBHR_CODES}/staff-role`;

/**
 * The 8 staff roles (app_users.role CHECK, public.app_is_staff()) and how
 * each is shown. The displays are the app's own role names in plain words.
 * An access role says what the account may do in mBHR, not what the person
 * is qualified to do: an admin can also consult, and a nurse can start a
 * prescription in the app.
 */
export const STAFF_ROLES: Readonly<Record<string, string>> = {
  admin: "Administrator",
  doctor: "Doctor",
  nurse: "Nurse",
  pharmacist: "Pharmacist",
  volunteer: "Volunteer",
  auditor: "Auditor",
  lead_clinician: "Lead clinician",
  registration_lead: "Registration lead",
};

export function isStaffRole(role: unknown): role is string {
  return typeof role === "string" && Object.prototype.hasOwnProperty.call(STAFF_ROLES, role);
}

/** The role as a local code. Only the 8 staff roles; anything else is null (never guessed). */
export function staffRoleConcept(role: unknown): CodeableConcept | null {
  if (!isStaffRole(role)) return null;
  const display = STAFF_ROLES[role];
  return {
    coding: [{ system: STAFF_ROLE_SYSTEM, code: role, display }],
    // Said in words so a receiver does not read the role as a credential.
    text: `mBHR access role: ${display}`,
  };
}

// Location.status <- public.sites.is_active: terminology/status/directory.ts
export { LOCATION_STATUS, DIRECTORY_STATUS_MAPS } from "../terminology/status/directory";

/**
 * A boolean column as the text the status maps compare. Only a real
 * boolean is a recorded flag: NULL, and anything else a boolean column
 * cannot hold (a string, a number), is treated as not recorded.
 */
function flagText(v: unknown): string | null {
  return typeof v === "boolean" ? String(v) : null;
}

/** A recorded true/false flag; anything else (NULL, a string, a number) is unknown: undefined. */
export function recordedFlag(v: unknown): boolean | undefined {
  return v === true || v === false ? v : undefined;
}

// ---------------------------------------------------------------------------
// Practitioner / PractitionerRole <- public.fhir_staff_directory(...)
// ---------------------------------------------------------------------------

/**
 * Columns public.fhir_staff_directory returns. source_id (the account id)
 * comes back only when the caller looked staff up by account id; the
 * mappers never read it.
 */
export const STAFF_DIRECTORY_COLUMNS = ["fhir_id", "full_name", "role", "active", "created_at", "updated_at"] as const;

/** The published id of a directory row, or null when it is not a valid FHIR id. */
function staffId(row: Row): string | null {
  const id = row.fhir_id;
  return typeof id === "string" && FHIR_ID.test(id) ? id : null;
}

/**
 * One staff account -> Practitioner. Name (text only) and, when the account
 * records it, active. null (withheld) for a row that is not a staff role or
 * has no valid published id or no name.
 */
export function mapPractitioner(row: Row): Practitioner | null {
  const id = staffId(row);
  const name = str(row, "full_name");
  if (!id || !name || !isStaffRole(row.role)) return null;
  const practitioner: Practitioner = {
    resourceType: "Practitioner",
    id,
    meta: versionMeta(row),
    name: [{ text: name }],
  };
  const active = recordedFlag(row.active);
  if (active !== undefined) practitioner.active = active;
  return practitioner;
}

/**
 * One staff account -> PractitionerRole (same id as its Practitioner: ids
 * are unique per resource type). The role as a local code; no organisation,
 * location, specialty or period (mBHR roles are global and record none of
 * these). null (withheld) whenever the account's Practitioner is withheld
 * (not one of the 8 staff roles, no valid id, no name), so a role never
 * points at a Practitioner that is not published.
 */
export function mapPractitionerRole(row: Row): PractitionerRole | null {
  const id = staffId(row);
  const code = staffRoleConcept(row.role);
  const name = str(row, "full_name");
  if (!id || !code || !name) return null;
  const practitioner: Reference = { reference: `Practitioner/${id}`, display: name };
  const role: PractitionerRole = {
    resourceType: "PractitionerRole",
    id,
    meta: versionMeta(row),
    practitioner,
    code: [code],
  };
  const active = recordedFlag(row.active);
  if (active !== undefined) role.active = active;
  return role;
}

// ---------------------------------------------------------------------------
// Organization <- public.organizations
// ---------------------------------------------------------------------------

/**
 * Named columns only. Not read: slug (editable by any member, so not an
 * identifier), logo_url, settings, subscription_tier (internal).
 */
export const ORGANIZATION_COLUMNS = ["id", "name", "is_active", "created_at", "updated_at"] as const;

export function mapOrganization(row: Row): Organization | null {
  const id = str(row, "id");
  const name = str(row, "name");
  // org-1: an Organization needs a name or an identifier; mBHR records no identifier.
  if (!id || !UUID.test(id) || !name) return null;
  const org: Organization = {
    resourceType: "Organization",
    id,
    meta: versionMeta(row),
    name,
  };
  const active = recordedFlag(row.is_active);
  if (active !== undefined) org.active = active;
  return org;
}

// ---------------------------------------------------------------------------
// Location <- public.sites
// ---------------------------------------------------------------------------

/**
 * Named columns only. Not read: site_code (unique only within one
 * organisation, and no official facility registry is recorded),
 * coordinates (never written, datum not recorded), capacity and
 * typical_patient_volume (planning figures).
 */
export const LOCATION_COLUMNS = [
  "id",
  "org_id",
  "name",
  "address",
  "lga",
  "state",
  "is_active",
  "created_at",
  "updated_at",
] as const;

/** A site name that is not a place (the tablet's defaults; see mappers/encounter.ts). */
export function isNotAPlace(name: string): boolean {
  return NOT_A_PLACE.includes(name.trim().toLowerCase());
}

export function mapLocation(row: Row): Location | null {
  const id = str(row, "id");
  const name = str(row, "name");
  if (!id || !UUID.test(id) || !name || isNotAPlace(name)) return null;
  const location: Location = {
    resourceType: "Location",
    id,
    meta: versionMeta(row),
    name,
    // Each registry row is one specific place, not a kind of place.
    mode: "instance",
  };
  const status = applyStatusMap(LOCATION_STATUS, flagText(row.is_active));
  if (status) location.status = status;
  // As on Patient: the one-line address as text, the LGA as district, the
  // state. No country, city or postal code is recorded, so none is added.
  const line = str(row, "address");
  const lga = str(row, "lga");
  const state = str(row, "state");
  if (line || lga || state) {
    location.address = {
      ...(line ? { text: line } : {}),
      ...(lga ? { district: lga } : {}),
      ...(state ? { state } : {}),
    };
  }
  // sites.org_id is a NOT NULL foreign key to organizations: a verified link.
  const org = str(row, "org_id");
  if (org && UUID.test(org)) location.managingOrganization = { reference: `Organization/${org}` };
  return location;
}

// ---------------------------------------------------------------------------
// Name search (all four types)
// ---------------------------------------------------------------------------

/**
 * The words a name search may contain: letters, digits, spaces and
 * . ' ’ - _ % & ( ) /. % and _ are matched literally (never as wildcards).
 * * and \ are refused: PostgREST treats * as a wildcard that cannot be
 * escaped.
 */
const NAME_SEARCH = /^[\p{L}\p{M}\p{N} .'’()&/_%-]{2,64}$/u;

/**
 * Normalise a name search value: NFC, trimmed, runs of spaces as one space,
 * 2 to 64 characters from NAME_SEARCH. null when it is not acceptable (the
 * caller answers 400).
 */
export function normaliseNameSearch(raw: string): string | null {
  const v = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  return NAME_SEARCH.test(v) ? v : null;
}

/**
 * Whether `name` matches a normalised search value the way the database
 * does: case-insensitive prefix of the whole name or of any word in it
 * (after runs of spaces are made one). Used where a search combines name
 * with a selector the database applies instead (e.g. _id).
 */
export function nameMatches(name: unknown, search: string): boolean {
  if (typeof name !== "string") return false;
  const hay = name.replace(/\s+/g, " ").toLowerCase();
  const needle = search.toLowerCase();
  return hay.startsWith(needle) || hay.includes(` ${needle}`);
}
