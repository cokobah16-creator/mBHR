// Writes the FHIR gateway's example output to a directory, one JSON file per
// resource, for the HL7 FHIR Validator (see .github/workflows/interop-fhir.yml).
//   npx tsx scripts/fhir-r4-examples.ts out/fhir-examples

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { conformanceExamples } from "../src/interoperability/fhir/conformance/examples";

const dir = process.argv[2] ?? "fhir-examples";
mkdirSync(dir, { recursive: true });
const examples = conformanceExamples();
for (const [name, resource] of Object.entries(examples)) {
  writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(resource, null, 2)}\n`);
}
console.log(`wrote ${Object.keys(examples).length} examples to ${dir}`);
