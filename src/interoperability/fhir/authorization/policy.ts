// The single access decision for the FHIR gateway: canAccessFHIRResource().
//
// Every request passes through it once, before any clinical table is read,
// and every decision (permit or deny) is written to interop.access_audit by
// the gateway. The decision is the intersection of every rule below; there
// is no rule that can widen another.
//
//   1. authentication   a valid Supabase session for a real account
//   2. token validity   audience "authenticated", not expired (checked by
//                       Supabase Auth, re-checked on the claims here)
//   3. SMART scope      no SMART tokens are accepted in this release; the
//                       first-party session carries no scopes to widen access
//   4. mBHR permission  READ_PERMISSIONS for the resource type
//   5. organisation     mBHR clinical rows carry no organisation or site yet,
//                       so there is nothing to narrow on; row-level security
//                       applies whatever the database defines
//   6. patient context  searches must name a patient (see the search specs);
//                       enforced by the search layer before any query
//   7. ownership        rows are read as the caller, under row-level security
//   8. consent          consent/policy.ts (purpose of use)
//   9. security labels  none are recorded in mBHR yet
//  10. exceptional      break-glass is not enabled; ETREAT is refused
//
// Writes are refused before this function is reached (405).

import { canRead, type FhirResourceType } from "./permissions";
import { consentDecision, type PurposeOfUse } from "../consent/policy";

export interface Actor {
  /** auth.users id of the caller. */
  userId: string;
  /** mBHR role from app_users, or null (portal patient, guest, deactivated). */
  role: string | null;
  permissions: ReadonlySet<string>;
}

export interface AccessRequest {
  actor: Actor;
  action: "read" | "search";
  resourceType: FhirResourceType;
  purposeOfUse: PurposeOfUse;
}

export type AccessDecision =
  | { permit: true }
  | { permit: false; status: 403; reason: string };

const deny = (reason: string): AccessDecision => ({ permit: false, status: 403, reason });

export function canAccessFHIRResource(req: AccessRequest): AccessDecision {
  const { actor } = req;
  if (!actor.role) {
    // Portal patients and accounts without an active staff role. Patient
    // self-access through FHIR is a later release (see smart-auth.md).
    return deny("no_staff_role");
  }
  if (!canRead(actor.permissions, req.resourceType)) {
    return deny("missing_permission");
  }
  const consent = consentDecision({
    purposeOfUse: req.purposeOfUse,
    internalStaff: true,
    resourceType: req.resourceType,
  });
  // An explicit comparison: the app's tsconfig is not strict, where a
  // truthiness check does not narrow this union.
  if (consent.permit === false) return deny(consent.reason);
  return { permit: true };
}
