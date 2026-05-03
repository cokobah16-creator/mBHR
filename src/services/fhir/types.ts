// Re-export shim. The canonical FHIR R4 type definitions live in
// supabase/functions/_shared/fhir/types.ts so the same shapes drive the
// browser bundle and the Deno edge functions (tefca-ias, tefca-bulk,
// tefca-oauth, _shared/fhir-validation).
//
// Existing browser callers continue to `import { FHIRPatient } from "./types"`
// — Vite resolves the relative path across the project root.

export * from "../../../supabase/functions/_shared/fhir/types";
