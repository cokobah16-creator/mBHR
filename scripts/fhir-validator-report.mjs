// Reads the HL7 FHIR Validator's -output file (an OperationOutcome, or a
// Bundle of them) and fails when any issue is an error or fatal. Warnings
// and information (for example mBHR's local code systems, which the
// validator cannot resolve) are listed but do not fail the job.
//   node scripts/fhir-validator-report.mjs validation.json

import { readFileSync } from "node:fs";

const report = JSON.parse(readFileSync(process.argv[2] ?? "validation.json", "utf8"));
const outcomes =
  report.resourceType === "Bundle" ? (report.entry ?? []).map((e) => e.resource) : [report];

let errors = 0;
for (const oo of outcomes) {
  const file =
    (oo.extension ?? []).find((e) => String(e.url).endsWith("operationoutcome-file"))?.valueString ?? "(file)";
  for (const issue of oo.issue ?? []) {
    const where = (issue.expression ?? issue.location ?? []).join(", ");
    const line = `${issue.severity.padEnd(11)} ${file} ${where} ${issue.details?.text ?? issue.diagnostics ?? ""}`;
    if (issue.severity === "error" || issue.severity === "fatal") {
      errors++;
      console.error(line);
    } else {
      console.log(line);
    }
  }
}
console.log(`${outcomes.length} files validated, ${errors} error(s)`);
process.exit(errors > 0 ? 1 : 0);
