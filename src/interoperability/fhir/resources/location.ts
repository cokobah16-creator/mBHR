// Location <- public.sites, the server's site registry (see
// mappers/directory.ts for the mapping rules).
//
// Only registered sites are Locations. Visits do not point at this
// registry: they carry the name of a site chosen on the tablet (a list kept
// on each device, never synced), so Encounter.location stays a display-only
// name and never references a Location, and the tablet's placeholders
// ("Mobile Clinic" when no site was chosen, "Portal entry" for a note typed
// in from the staff dashboard) are never published as places, even if a
// registry row carried one of those names. Row-level security shows every
// signed-in user the active sites (they are also listed publicly) and
// members of the owning organisation the inactive ones too.

import { READ_PERMISSIONS } from "../authorization/permissions";
import { LOCATION_COLUMNS, LOCATION_STATUS, mapLocation, type Location } from "../mappers/directory";
import type { Row } from "../mappers/common";
import { parseId, type ParsedSearch } from "../search/params";
import { errors } from "../errors/operationOutcome";
import type { AddIssue } from "../validation/validate";
import { isObj } from "../validation/validate";
import { emptyResult, type QueryCtx, type QueryResult, type ResourceDefinition, type ResourceModule } from "./module";
import { UUID, keysetPage, one, type Filters } from "./shared";
import { assertStaff } from "./practitioner";
import { nameFilter } from "./organization";

export const definition: ResourceDefinition = {
  type: "Location",
  source: "public.sites (the server's site registry; not the site names typed on tablets)",
  idStrategy: "sites.id (uuid)",
  fields: [
    "status (from is_active: active or inactive; left out when not recorded)",
    "name",
    "mode (instance: each row is one place)",
    "address (text, district = LGA, state; no country is recorded)",
    "managingOrganization (sites.org_id)",
  ],
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
  readPermissions: READ_PERMISSIONS.Location,
  patientAccess: false,
  sensitiveSearch: false,
  notes: [
    "Visits record a site name typed on the tablet, not a registered site, so no Encounter references a Location.",
    "'Mobile Clinic' and 'Portal entry' are placeholders, not places, and are never published as Locations.",
    "No type, position, site code, opening hours or contact details are published: none is recorded in a verified form.",
    "Staff only; not available to patients.",
  ],
};

function mapRows(rows: Row[]): Promise<(Location | null)[]> {
  return Promise.resolve(rows.map(mapLocation));
}

async function read(ctx: QueryCtx, id: string): Promise<QueryResult> {
  assertStaff(ctx);
  if (!UUID.test(id)) return emptyResult();
  const rows = await ctx.db.select("sites", LOCATION_COLUMNS, [["id", `eq.${id}`]], { limit: 1 });
  const location = rows.length ? mapLocation(rows[0]) : null;
  return location ? { page: { resources: [location], next: null }, owners: [null] } : emptyResult();
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
  if (!filters.length) throw errors.forbidden("A Location search must name a specific record: give _id, or name.");
  const { page } = await keysetPage<Location>({
    db: ctx.db,
    table: "sites",
    columns: LOCATION_COLUMNS,
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
  if (resource.status !== undefined && !LOCATION_STATUS.allowed.includes(resource.status as never)) {
    add("status", "not a location-status code");
  }
  if (typeof resource.name !== "string" || resource.name.trim() === "") add("name", "required (a registered site has a name)");
  if (resource.mode !== undefined && resource.mode !== "instance" && resource.mode !== "kind") add("mode", "invalid");
  const org = resource.managingOrganization;
  if (org !== undefined && (!isObj(org) || typeof org.reference !== "string" || !org.reference.startsWith("Organization/"))) {
    add("managingOrganization", "must reference an Organization");
  }
  for (const k of ["type", "physicalType", "position", "identifier", "telecom", "hoursOfOperation", "operationalStatus", "partOf"]) {
    if (resource[k] !== undefined) add(k, "not recorded by mBHR");
  }
}

export const locationModule: ResourceModule = { definition, read, search, validate };
