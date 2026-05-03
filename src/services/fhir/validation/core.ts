// Re-export shim. The portable US Core 7.0 validator lives at
// supabase/functions/_shared/fhir-validation/core.ts so the same
// implementation drives the browser bundle and the Deno edge functions.
//
// Phase D-3 relocation. Existing callers (src/services/fhir/uscore-validator.ts
// and any direct importers of "./validation/core") continue to work because
// Vite + tsc resolve the relative path across the project root.

export * from "../../../../supabase/functions/_shared/fhir-validation/core";
