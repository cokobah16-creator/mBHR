/**
 * Overall result of a bulk FHIR export from per-patient outcomes.
 *
 * A patient whose export failed is not in the files. The export as a whole
 * only counts as done when at least one patient's records are in the files,
 * or there were no patients to export; otherwise it failed, and says so.
 */

export interface BulkExportTally {
  totalPatients: number;
  exportedPatients: number;
  failedPatients: number;
}

export interface BulkExportOutcome {
  success: boolean;
  /** Set when the export failed as a whole. */
  error?: string;
  /** Set when some, but not all, patients were left out of the files. */
  warning?: string;
}

function patients(n: number): string {
  return `${n.toLocaleString("en-NG")} patient${n === 1 ? "" : "s"}`;
}

export function bulkExportOutcome(tally: BulkExportTally): BulkExportOutcome {
  const { exportedPatients, failedPatients } = tally;

  if (failedPatients > 0 && exportedPatients === 0) {
    return {
      success: false,
      error: `No patient records could be exported (${patients(failedPatients)} failed). No export files were made.`,
    };
  }

  if (failedPatients > 0) {
    return {
      success: true,
      warning: `${patients(failedPatients)} could not be exported and ${failedPatients === 1 ? "is" : "are"} not in the files. ${patients(exportedPatients)} exported.`,
    };
  }

  return { success: true };
}
