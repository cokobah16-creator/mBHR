// Vercel Function behind https://mbhr.app/fhir/R4 (see the rewrites in
// vercel.json). All logic lives in src/interoperability/fhir; this file only
// hands the request over with the server environment. With FHIR_ENABLED
// unset (the default) every request gets a 404 OperationOutcome.

import { handleFhirRequest } from "../src/interoperability/fhir/gateway/handler";

export const config = { runtime: "edge" };

declare const process: { env: Record<string, string | undefined> };

export default function handler(request: Request): Promise<Response> {
  return handleFhirRequest(request, { env: process.env });
}
