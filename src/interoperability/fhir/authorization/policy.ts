// Phase 1 entry point, kept as a name: the access decision now lives in
// authorize.ts (authorizeFhirRequest), which every endpoint calls.

export { authorizeFhirRequest, type Actor, type FhirAuthorizationDecision, type FhirAuthorizationRequest } from "./authorize";
