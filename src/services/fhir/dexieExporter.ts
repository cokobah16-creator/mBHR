import { db, createAuditLog } from "../../db";
import type {
  Patient,
  Vital,
  Consultation,
  Dispense,
  Visit,
  PatientAllergy,
  Meta,
} from "../../db";
import type { FHIRResource, FHIRBundle } from "./types";
import {
  adaptDexiePatient,
  adaptDexieVital,
  adaptDexieDispense,
  adaptDexieVisit,
  adaptDexieConsultation,
  adaptDexieAllergy,
} from "./dexieAdapters";
import { generatePatientBundle, generateNDJSON } from "./bundleGenerator";
import {
  validateBundle,
  type BundleValidationResult,
} from "./uscore-validator";

export interface FHIRExportAuditLog {
  id: string;
  timestamp: string;
  exportType: "single-patient" | "bulk";
  patientId?: string;
  resourceTypes: string[];
  resourceCount: number;
  format: "fhir-bundle" | "ndjson";
  validationStatus?: "passed" | "failed" | "skipped";
  validationErrors?: number;
  validationWarnings?: number;
  since?: string;
  dataSource: "dexie-offline";
  success: boolean;
  errorMessage?: string;
}

async function logFHIRExport(auditLog: FHIRExportAuditLog): Promise<void> {
  try {
    await createAuditLog(
      "patient",
      `fhir_export_${auditLog.exportType}`,
      auditLog.patientId ? "patient" : "system",
      auditLog.patientId || "bulk",
    );

    const existingLogs = await db.meta.get("fhir_export_audit_logs");
    const logs: FHIRExportAuditLog[] =
      (existingLogs?.value as FHIRExportAuditLog[]) || [];
    logs.unshift(auditLog);

    const trimmedLogs = logs.slice(0, 100);

    await db.meta.put({
      key: "fhir_export_audit_logs",
      value: trimmedLogs,
      updatedAt: Date.now(),
    });
  } catch (error) {
    console.error("Failed to log FHIR export:", error);
  }
}

export async function getFHIRExportAuditLogs(): Promise<FHIRExportAuditLog[]> {
  try {
    const meta = await db.meta.get("fhir_export_audit_logs");
    return (meta?.value as FHIRExportAuditLog[]) || [];
  } catch {
    return [];
  }
}

export interface ExportOptions {
  includePatient?: boolean;
  includeVitals?: boolean;
  includeMedications?: boolean;
  includeEncounters?: boolean;
  includeConsultations?: boolean;
  includeAllergies?: boolean;
  dateRange?: "all" | "1year" | "2years" | "5years";
  since?: string;
  validate?: boolean;
  format?: "fhir-bundle" | "ndjson";
}

export interface ExportResult {
  success: boolean;
  bundle?: FHIRBundle;
  ndjson?: string;
  validation?: BundleValidationResult;
  metadata: {
    patientId?: string;
    exportedAt: string;
    resourceCounts: Record<string, number>;
    totalResources: number;
    since?: string;
    newSinceToken?: string;
    dataSource: "dexie-offline";
  };
  error?: string;
}

export interface BulkExportProgress {
  totalPatients: number;
  processedPatients: number;
  currentPatientId?: string;
  status: "pending" | "in-progress" | "completed" | "error";
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface BulkExportResult {
  success: boolean;
  files: Map<string, string>;
  manifest: Record<string, unknown>;
  progress: BulkExportProgress;
  validation?: BundleValidationResult;
}

const META_KEY_LAST_EXPORT = "fhir_last_export_";

function getDateRangeStart(range: ExportOptions["dateRange"]): Date | null {
  if (!range || range === "all") return null;

  const now = new Date();
  switch (range) {
    case "1year":
      return new Date(now.setFullYear(now.getFullYear() - 1));
    case "2years":
      return new Date(now.setFullYear(now.getFullYear() - 2));
    case "5years":
      return new Date(now.setFullYear(now.getFullYear() - 5));
    default:
      return null;
  }
}

function isWithinDateRange(
  date: Date | string | undefined,
  rangeStart: Date | null,
): boolean {
  if (!rangeStart) return true;
  if (!date) return false;
  const d = date instanceof Date ? date : new Date(date);
  return d >= rangeStart;
}

async function getLastExportTimestamp(
  patientId: string,
): Promise<string | undefined> {
  const meta = await db.meta.get(`${META_KEY_LAST_EXPORT}${patientId}`);
  return meta?.value as string | undefined;
}

async function setLastExportTimestamp(
  patientId: string,
  timestamp: string,
): Promise<void> {
  await db.meta.put({
    key: `${META_KEY_LAST_EXPORT}${patientId}`,
    value: timestamp,
    updatedAt: Date.now(),
  });
}

export async function exportPatientEHI(
  patientId: string,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const {
    includePatient = true,
    includeVitals = true,
    includeMedications = true,
    includeEncounters = true,
    includeConsultations = true,
    includeAllergies = true,
    dateRange = "all",
    since,
    validate = false,
    format = "fhir-bundle",
  } = options;

  try {
    const resources: FHIRResource[] = [];
    const resourceCounts: Record<string, number> = {};
    const dateRangeStart = getDateRangeStart(dateRange);

    const effectiveSince = since || (await getLastExportTimestamp(patientId));
    const sinceDate = effectiveSince ? new Date(effectiveSince) : null;

    const patient = await db.patients.get(patientId);
    if (!patient) {
      return {
        success: false,
        metadata: {
          patientId,
          exportedAt: new Date().toISOString(),
          resourceCounts: {},
          totalResources: 0,
          dataSource: "dexie-offline",
        },
        error: "Patient not found in local database",
      };
    }

    const patientName = `${patient.givenName} ${patient.familyName}`;

    if (includePatient) {
      const shouldInclude =
        !sinceDate ||
        (patient._syncedAt && new Date(patient._syncedAt) > sinceDate) ||
        patient.updatedAt > sinceDate;

      if (shouldInclude) {
        resources.push(adaptDexiePatient(patient));
        resourceCounts["Patient"] = 1;
      }
    }

    if (includeVitals) {
      let vitalsQuery = db.vitals.where("patientId").equals(patientId);
      const vitals = await vitalsQuery.toArray();

      const filteredVitals = vitals.filter((v) => {
        if (!isWithinDateRange(v.takenAt, dateRangeStart)) return false;
        if (sinceDate) {
          const syncedAt = v._syncedAt ? new Date(v._syncedAt) : null;
          return syncedAt && syncedAt > sinceDate;
        }
        return true;
      });

      for (const vital of filteredVitals) {
        const observations = adaptDexieVital(vital, patientName);
        resources.push(...observations);
      }
      resourceCounts["Observation"] =
        (resourceCounts["Observation"] || 0) +
        filteredVitals.reduce((sum, v) => sum + adaptDexieVital(v).length, 0);
    }

    if (includeMedications) {
      const dispenses = await db.dispenses
        .where("patientId")
        .equals(patientId)
        .toArray();

      const filteredDispenses = dispenses.filter((d) => {
        if (!isWithinDateRange(d.dispensedAt, dateRangeStart)) return false;
        if (sinceDate) {
          const syncedAt = d._syncedAt ? new Date(d._syncedAt) : null;
          return syncedAt && syncedAt > sinceDate;
        }
        return true;
      });

      for (const dispense of filteredDispenses) {
        resources.push(adaptDexieDispense(dispense, patientName));
      }
      resourceCounts["MedicationRequest"] = filteredDispenses.length;
    }

    if (includeEncounters) {
      const visits = await db.visits
        .where("patientId")
        .equals(patientId)
        .toArray();

      const filteredVisits = visits.filter((v) => {
        if (!isWithinDateRange(v.startedAt, dateRangeStart)) return false;
        if (sinceDate) {
          const syncedAt = v._syncedAt ? new Date(v._syncedAt) : null;
          return syncedAt && syncedAt > sinceDate;
        }
        return true;
      });

      for (const visit of filteredVisits) {
        resources.push(adaptDexieVisit(visit, patientName));
      }
      resourceCounts["Encounter"] = filteredVisits.length;
    }

    if (includeConsultations) {
      const consultations = await db.consultations
        .where("patientId")
        .equals(patientId)
        .toArray();

      const filteredConsultations = consultations.filter((c) => {
        if (!isWithinDateRange(c.createdAt, dateRangeStart)) return false;
        if (sinceDate) {
          const syncedAt = c._syncedAt ? new Date(c._syncedAt) : null;
          return syncedAt && syncedAt > sinceDate;
        }
        return true;
      });

      for (const consultation of filteredConsultations) {
        resources.push(adaptDexieConsultation(consultation, patientName));
      }
      resourceCounts["DiagnosticReport"] = filteredConsultations.length;
    }

    if (includeAllergies) {
      const allergies = await db.patientAllergies
        .where("patientId")
        .equals(patientId)
        .toArray();

      const filteredAllergies = allergies.filter((a) => {
        if (sinceDate) {
          const syncedAt = a._syncedAt ? new Date(a._syncedAt) : null;
          return syncedAt && syncedAt > sinceDate;
        }
        return true;
      });

      for (const allergy of filteredAllergies) {
        resources.push(adaptDexieAllergy(allergy, patientName));
      }
      resourceCounts["AllergyIntolerance"] = filteredAllergies.length;
    }

    const newSinceToken = new Date().toISOString();
    await setLastExportTimestamp(patientId, newSinceToken);

    let validation: BundleValidationResult | undefined;
    if (validate) {
      validation = validateBundle(resources);
    }

    if (format === "ndjson") {
      return {
        success: true,
        ndjson: generateNDJSON(resources),
        validation,
        metadata: {
          patientId,
          exportedAt: newSinceToken,
          resourceCounts,
          totalResources: resources.length,
          since: effectiveSince,
          newSinceToken,
          dataSource: "dexie-offline",
        },
      };
    }

    const { bundle } = generatePatientBundle(resources, {
      patientId,
      since: effectiveSince,
      includeValidation: validate,
      baseUrl: `urn:uuid:mbhr-patient-${patientId}`,
    });

    await logFHIRExport({
      id: `export-${Date.now()}`,
      timestamp: newSinceToken,
      exportType: "single-patient",
      patientId,
      resourceTypes: Object.keys(resourceCounts),
      resourceCount: resources.length,
      format,
      validationStatus: validate
        ? validation?.valid
          ? "passed"
          : "failed"
        : "skipped",
      validationErrors: validation?.summary.errors,
      validationWarnings: validation?.summary.warnings,
      since: effectiveSince,
      dataSource: "dexie-offline",
      success: true,
    });

    return {
      success: true,
      bundle,
      validation,
      metadata: {
        patientId,
        exportedAt: newSinceToken,
        resourceCounts,
        totalResources: resources.length,
        since: effectiveSince,
        newSinceToken,
        dataSource: "dexie-offline",
      },
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown export error";

    await logFHIRExport({
      id: `export-${Date.now()}`,
      timestamp: new Date().toISOString(),
      exportType: "single-patient",
      patientId,
      resourceTypes: [],
      resourceCount: 0,
      format,
      validationStatus: "skipped",
      dataSource: "dexie-offline",
      success: false,
      errorMessage,
    });

    return {
      success: false,
      metadata: {
        patientId,
        exportedAt: new Date().toISOString(),
        resourceCounts: {},
        totalResources: 0,
        dataSource: "dexie-offline",
      },
      error: errorMessage,
    };
  }
}

export async function exportBulkEHI(
  options: ExportOptions & {
    batchSize?: number;
    onProgress?: (progress: BulkExportProgress) => void;
  } = {},
): Promise<BulkExportResult> {
  const { batchSize = 100, onProgress, ...exportOptions } = options;

  const progress: BulkExportProgress = {
    totalPatients: 0,
    processedPatients: 0,
    status: "pending",
    startedAt: new Date().toISOString(),
  };

  const files = new Map<string, string>();
  const resourcesByType = new Map<string, FHIRResource[]>();

  try {
    const patients = await db.patients.filter((p) => !p.mergeInto).toArray();

    progress.totalPatients = patients.length;
    progress.status = "in-progress";
    onProgress?.(progress);

    for (let i = 0; i < patients.length; i += batchSize) {
      const batch = patients.slice(i, i + batchSize);

      for (const patient of batch) {
        progress.currentPatientId = patient.id;
        progress.processedPatients++;
        onProgress?.(progress);

        const result = await exportPatientEHI(patient.id, {
          ...exportOptions,
          format: "fhir-bundle",
        });

        if (result.success && result.bundle?.entry) {
          for (const entry of result.bundle.entry) {
            if (entry.resource) {
              const type = entry.resource.resourceType;
              if (!resourcesByType.has(type)) {
                resourcesByType.set(type, []);
              }
              resourcesByType.get(type)!.push(entry.resource);
            }
          }
        }
      }
    }

    const output: Array<{ type: string; url: string; count: number }> = [];
    for (const [type, resources] of resourcesByType) {
      const filename = `${type}.ndjson`;
      files.set(filename, generateNDJSON(resources));
      output.push({
        type,
        url: filename,
        count: resources.length,
      });
    }

    progress.status = "completed";
    progress.completedAt = new Date().toISOString();
    onProgress?.(progress);

    const manifest = {
      transactionTime: progress.completedAt,
      request: "GET /$export",
      requiresAccessToken: false,
      output,
      error: [],
    };

    let validation: BundleValidationResult | undefined;
    let totalResourceCount = 0;
    const resourceTypes: string[] = [];

    for (const [type, resources] of resourcesByType) {
      resourceTypes.push(type);
      totalResourceCount += resources.length;
    }

    if (options.validate) {
      const allResources: FHIRResource[] = [];
      for (const resources of resourcesByType.values()) {
        allResources.push(...resources);
      }
      validation = validateBundle(allResources);
    }

    await logFHIRExport({
      id: `bulk-export-${Date.now()}`,
      timestamp: progress.completedAt!,
      exportType: "bulk",
      resourceTypes,
      resourceCount: totalResourceCount,
      format: "ndjson",
      validationStatus: options.validate
        ? validation?.valid
          ? "passed"
          : "failed"
        : "skipped",
      validationErrors: validation?.summary.errors,
      validationWarnings: validation?.summary.warnings,
      dataSource: "dexie-offline",
      success: true,
    });

    return {
      success: true,
      files,
      manifest,
      progress,
      validation,
    };
  } catch (error) {
    progress.status = "error";
    progress.error = error instanceof Error ? error.message : "Unknown error";
    progress.completedAt = new Date().toISOString();
    onProgress?.(progress);

    await logFHIRExport({
      id: `bulk-export-${Date.now()}`,
      timestamp: progress.completedAt,
      exportType: "bulk",
      resourceTypes: [],
      resourceCount: 0,
      format: "ndjson",
      validationStatus: "skipped",
      dataSource: "dexie-offline",
      success: false,
      errorMessage: progress.error,
    });

    return {
      success: false,
      files,
      manifest: {},
      progress,
    };
  }
}

export async function getExportPreview(patientId: string): Promise<{
  resourceCounts: Record<string, number>;
  totalResources: number;
  lastExport?: string;
  estimatedSize: string;
}> {
  const patient = await db.patients.get(patientId);
  if (!patient) {
    return {
      resourceCounts: {},
      totalResources: 0,
      estimatedSize: "0 KB",
    };
  }

  const [vitals, dispenses, visits, consultations, allergies] =
    await Promise.all([
      db.vitals.where("patientId").equals(patientId).count(),
      db.dispenses.where("patientId").equals(patientId).count(),
      db.visits.where("patientId").equals(patientId).count(),
      db.consultations.where("patientId").equals(patientId).count(),
      db.patientAllergies.where("patientId").equals(patientId).count(),
    ]);

  const observationCount = vitals * 6;
  const totalResources =
    1 + observationCount + dispenses + visits + consultations + allergies;

  const estimatedBytes = totalResources * 500;
  const estimatedSize =
    estimatedBytes < 1024
      ? `${estimatedBytes} B`
      : estimatedBytes < 1024 * 1024
        ? `${Math.round(estimatedBytes / 1024)} KB`
        : `${(estimatedBytes / (1024 * 1024)).toFixed(1)} MB`;

  const lastExport = await getLastExportTimestamp(patientId);

  return {
    resourceCounts: {
      Patient: 1,
      Observation: observationCount,
      MedicationRequest: dispenses,
      Encounter: visits,
      DiagnosticReport: consultations,
      AllergyIntolerance: allergies,
    },
    totalResources,
    lastExport,
    estimatedSize,
  };
}

export function downloadBundle(bundle: FHIRBundle, filename: string): void {
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/fhir+json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadNDJSON(ndjson: string, filename: string): void {
  const blob = new Blob([ndjson], {
    type: "application/ndjson",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function downloadBulkExport(
  files: Map<string, string>,
  manifest: Record<string, unknown>,
): Promise<void> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  for (const [filename, content] of files) {
    zip.file(filename, content);
  }

  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `mbhr-bulk-export-${new Date().toISOString().split("T")[0]}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
