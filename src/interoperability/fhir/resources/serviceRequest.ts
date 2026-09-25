// ServiceRequest: PLACEHOLDER, replaced by its work package. Not published until then
// (the registry lists it, but read returns nothing and search is absent).

import { READ_PERMISSIONS } from "../authorization/permissions";
import { emptyResult, type ResourceDefinition, type ResourceModule } from "./module";

export const definition: ResourceDefinition = {
  type: "ServiceRequest",
  source: "(not implemented yet)",
  idStrategy: "(not implemented yet)",
  fields: [],
  profiles: [],
  interactions: ["read"],
  searchParams: [],
  requiredSearch: [["_id"]],
  writeSupport: false,
  consentClass: "laboratory",
  readPermissions: READ_PERMISSIONS.ServiceRequest,
  patientAccess: false,
  sensitiveSearch: false,
};

export const serviceRequestModule: ResourceModule = {
  definition,
  read: async () => emptyResult(),
};
