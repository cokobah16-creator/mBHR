// PractitionerRole <- the mBHR access role of each staff account, read
// through public.fhir_staff_directory (see mappers/directory.ts and
// resources/practitioner.ts).
//
// One PractitionerRole per staff account, with the same published id as
// its Practitioner. It says which mBHR access role the account holds, as a
// local code, and nothing else: roles are global in mBHR (not per
// organisation or site), and no specialty, period or availability is
// recorded. Organisation and site memberships (public.user_org_sites) are
// visible only to the member and to user administrators, and exist only
// where the seed created them, so they are not published.

import { errors } from "../errors/operationOutcome";
import { READ_PERMISSIONS } from "../authorization/permissions";
import { STAFF_ROLE_SYSTEM, isStaffRole, mapPractitionerRole, type PractitionerRole } from "../mappers/directory";
import { parseId, parseReferenceId, parseToken, type ParsedSearch } from "../search/params";
import type { AddIssue } from "../validation/validate";
import { isObj } from "../validation/validate";
import { emptyResult, type QueryCtx, type QueryResult, type ResourceDefinition, type ResourceModule } from "./module";
import { one } from "./shared";
import { assertStaff, readStaff, staffDirectoryPage, type StaffSelector } from "./practitioner";

export const definition: ResourceDefinition = {
  type: "PractitionerRole",
  source:
    "The access role (public.app_users.role) of each mBHR staff account whose role is one of the 8 staff roles, read through public.fhir_staff_directory",
  idStrategy: "The same published id as the account's Practitioner (one role per account)",
  fields: [
    "practitioner (the account's Practitioner, with the name as display)",
    "code (the mBHR access role as a local code, https://mbhr.app/codes/staff-role)",
    "active (only when the account records it; otherwise left out)",
  ],
  profiles: [],
  interactions: ["read", "search-type"],
  searchParams: [
    { name: "_id", type: "token", documentation: "Logical id of the resource (the same as the Practitioner's)." },
    { name: "practitioner", type: "reference", documentation: "Practitioner/[id]." },
    {
      name: "role",
      type: "token",
      documentation:
        "An mBHR access role (https://mbhr.app/codes/staff-role): admin, doctor, nurse, pharmacist, volunteer, auditor, lead_clinician or registration_lead.",
    },
  ],
  requiredSearch: [["_id"], ["practitioner"], ["role"]],
  writeSupport: false,
  consentClass: "directory",
  readPermissions: READ_PERMISSIONS.PractitionerRole,
  patientAccess: false,
  sensitiveSearch: false,
  notes: [
    "The code is the mBHR access role an admin assigned (what the account may do in the app), not a qualification, licence or specialty. No SNOMED CT or HL7 v2 practitioner codes are claimed.",
    "No organization, location, specialty or period: mBHR roles are global and record none of these.",
    "Guest and legacy roles are never published.",
    "Staff only; not available to patients.",
  ],
};

/** role=: an mBHR staff role in the local system (or with no system). null: can match nothing. */
function parseRole(raw: string): string | null {
  const t = parseToken(raw, "role");
  if (t.system !== null && t.system !== STAFF_ROLE_SYSTEM) return null;
  return isStaffRole(t.code) ? t.code : null;
}

async function read(ctx: QueryCtx, id: string): Promise<QueryResult> {
  const row = await readStaff(ctx, id);
  const role = row ? mapPractitionerRole(row) : null;
  return role ? { page: { resources: [role], next: null }, owners: [null] } : emptyResult();
}

async function search(ctx: QueryCtx, search: ParsedSearch): Promise<QueryResult> {
  assertStaff(ctx);
  const idParam = one(search, "_id");
  const practitionerParam = one(search, "practitioner");
  const roleParam = one(search, "role");

  // _id and practitioner name the same account id; both given and
  // different match nothing.
  const ids = new Set<string>();
  if (idParam !== undefined) ids.add(parseId(idParam));
  if (practitionerParam !== undefined) ids.add(parseReferenceId(practitionerParam, "Practitioner", "practitioner"));
  if (ids.size > 1) return emptyResult();
  let role: string | null | undefined;
  if (roleParam !== undefined) {
    role = parseRole(roleParam);
    // A role that is not one of the 8 staff roles (guest, a typo): no match.
    if (role === null) return emptyResult();
  }

  // The database applies one selector (the id when given, else the role);
  // the role is checked here too when both are given.
  let selector: StaffSelector;
  if (ids.size) selector = { fhirIds: [...ids] };
  else if (role) selector = { role };
  else throw errors.forbidden("A PractitionerRole search must name a specific record: give _id, practitioner or role.");

  const { resources, next } = await staffDirectoryPage<PractitionerRole>({
    db: ctx.db,
    selector,
    count: search.count,
    cursor: search.cursor,
    map: (row) => (role && row.role !== role ? null : mapPractitionerRole(row)),
  });
  return { page: { resources, next }, owners: resources.map(() => null) };
}

/** Structural rules on top of validation/validate.ts. */
function validate(resource: Record<string, unknown>, add: AddIssue): void {
  const p = resource.practitioner;
  if (!isObj(p) || p.reference !== `Practitioner/${String(resource.id)}`) {
    add("practitioner", "must reference the account's own Practitioner");
  }
  const code = resource.code;
  const coding = Array.isArray(code) && code.length === 1 && isObj(code[0]) ? code[0].coding : undefined;
  if (
    !Array.isArray(coding) ||
    coding.length !== 1 ||
    !isObj(coding[0]) ||
    coding[0].system !== STAFF_ROLE_SYSTEM ||
    !isStaffRole(coding[0].code)
  ) {
    add("code", "one mBHR staff role in the local system is required");
  }
  if (resource.active !== undefined && typeof resource.active !== "boolean") add("active", "must be a boolean");
  // No verified link to an organisation or site exists, and nothing else is recorded.
  for (const k of ["organization", "location", "specialty", "period", "telecom", "identifier", "availableTime"]) {
    if (resource[k] !== undefined) add(k, "not recorded by mBHR");
  }
}

export const practitionerRoleModule: ResourceModule = { definition, read, search, validate };
