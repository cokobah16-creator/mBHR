// Organization <- public.organizations (see mappers/directory.ts for the
// mapping rules).
//
// The organisations registered on the server, as stored: nothing is
// hard-coded or taken from configuration. Row-level security shows a staff
// member only the organisations they are a member of (public.user_org_sites);
// staff without a membership see none. No clinical record names the
// organisation that provided the care, so nothing else in this interface
// references an Organization except Location.managingOrganization.

import { READ_PERMISSIONS } from "../authorization/permissions";
import { ORGANIZATION_COLUMNS, mapOrganization, type Organization } from "../mappers/directory";
import type { Row } from "../mappers/common";
import { parseId, type ParsedSearch } from "../search/params";
import { pgrstQuote } from "../gateway/postgrest";
import { errors } from "../errors/operationOutcome";
import type { AddIssue } from "../validation/validate";
import { emptyResult, type QueryCtx, type QueryResult, type ResourceDefinition, type ResourceModule } from "./module";
import { UUID, keysetPage, likeLiteral, one, type Filters } from "./shared";
import { assertStaff, parseStaffName } from "./practitioner";

export const definition: ResourceDefinition = {
  type: "Organization",
  source: "public.organizations (the organisations registered on the server)",
  idStrategy: "organizations.id (uuid)",
  fields: ["name", "active (from is_active; left out when not recorded)"],
  profiles: [],
  interactions: ["read", "search-type"],
  searchParams: [
    { name: "_id", type: "token", documentation: "Logical id of the resource." },
    {
      name: "name",
      type: "string",
      documentation:
        "Case-insensitive start of the name or of any word in it. 2-64 letters, digits, spaces and . ' - _ % & ( ) /; % and _ match themselves.",
    },
  ],
  requiredSearch: [["_id"], ["name"]],
  writeSupport: false,
  consentClass: "directory",
  readPermissions: READ_PERMISSIONS.Organization,
  patientAccess: false,
  sensitiveSearch: false,
  notes: [
    "Only organisations the signed-in staff member belongs to are returned.",
    "No identifier, type, address or contact details are published: mBHR records none that are stable or verified.",
    "Clinical records do not name the organisation that provided care, so Encounter.serviceProvider is never set.",
    "Staff only; not available to patients.",
  ],
};

/** name=: start of the name or of any word in it; % and _ are literal. */
export function nameFilter(raw: string): Filters {
  const n = likeLiteral(parseStaffName(raw));
  return [["or", `(name.ilike.${pgrstQuote(`${n}*`)},name.ilike.${pgrstQuote(`* ${n}*`)})`]];
}

function mapRows(rows: Row[]): Promise<(Organization | null)[]> {
  return Promise.resolve(rows.map(mapOrganization));
}

async function read(ctx: QueryCtx, id: string): Promise<QueryResult> {
  assertStaff(ctx);
  if (!UUID.test(id)) return emptyResult();
  const rows = await ctx.db.select("organizations", ORGANIZATION_COLUMNS, [["id", `eq.${id}`]], { limit: 1 });
  const org = rows.length ? mapOrganization(rows[0]) : null;
  return org ? { page: { resources: [org], next: null }, owners: [null] } : emptyResult();
}

async function search(ctx: QueryCtx, search: ParsedSearch): Promise<QueryResult> {
  assertStaff(ctx);
  const filters: Filters = [];
  const idParam = one(search, "_id");
  if (idParam !== undefined) {
    const id = parseId(idParam);
    if (!UUID.test(id)) return emptyResult();
    filters.push(["id", `eq.${id}`]);
  }
  const name = one(search, "name");
  if (name !== undefined) filters.push(...nameFilter(name));
  if (!filters.length) {
    throw errors.forbidden("An Organization search must name a specific record: give _id, or name.");
  }
  const { page } = await keysetPage<Organization>({
    db: ctx.db,
    table: "organizations",
    columns: ORGANIZATION_COLUMNS,
    key: "id",
    keyPattern: UUID,
    filters,
    count: search.count,
    cursor: search.cursor,
    map: mapRows,
  });
  return { page, owners: page.resources.map(() => null) };
}

/** Structural rules on top of validation/validate.ts. */
function validate(resource: Record<string, unknown>, add: AddIssue): void {
  // org-1 (a name or an identifier); mBHR publishes the name.
  if (typeof resource.name !== "string" || resource.name.trim() === "") add("name", "required (org-1)");
  if (resource.active !== undefined && typeof resource.active !== "boolean") add("active", "must be a boolean");
  for (const k of ["identifier", "type", "telecom", "address", "partOf", "contact"]) {
    if (resource[k] !== undefined) add(k, "not recorded by mBHR");
  }
}

export const organizationModule: ResourceModule = { definition, read, search, validate };
