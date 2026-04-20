import type {
  FHIRBundle,
  FHIRResource,
  FHIRBundleEntry,
  FHIROperationOutcome,
} from "./types";
import type { BundleValidationResult } from "./uscore-validator";
import { validateBundle } from "./uscore-validator";

export interface BundleOptions {
  type?: "collection" | "searchset";
  baseUrl?: string;
  includeValidation?: boolean;
  since?: string;
  patientId?: string;
  total?: number;
}

export interface GeneratedBundle {
  bundle: FHIRBundle;
  validation?: BundleValidationResult;
  metadata: {
    generatedAt: string;
    resourceCount: number;
    since?: string;
    patientId?: string;
  };
}

export function createFHIRBundle(
  resources: FHIRResource[],
  options: BundleOptions = {},
): FHIRBundle {
  const {
    type = "collection",
    baseUrl = "urn:uuid:mbhr-export",
    total,
  } = options;

  const now = new Date().toISOString();

  const entries: FHIRBundleEntry[] = resources.map((resource) => ({
    fullUrl: resource.id
      ? `${baseUrl}/${resource.resourceType}/${resource.id}`
      : `urn:uuid:${crypto.randomUUID?.() || Math.random().toString(36).substr(2, 9)}`,
    resource,
    search: type === "searchset" ? { mode: "match" } : undefined,
  }));

  const bundle: FHIRBundle = {
    resourceType: "Bundle",
    id: crypto.randomUUID?.() || `bundle-${Date.now()}`,
    meta: {
      lastUpdated: now,
      source: "mBHR-dexie-export",
    },
    type,
    total: total ?? resources.length,
    link: [
      {
        relation: "self",
        url: baseUrl,
      },
    ],
    entry: entries,
  };

  return bundle;
}

export function generatePatientBundle(
  resources: FHIRResource[],
  options: BundleOptions & { includeValidation?: boolean } = {},
): GeneratedBundle {
  const { includeValidation = false, since, patientId } = options;

  const bundle = createFHIRBundle(resources, options);

  let validation: BundleValidationResult | undefined;
  if (includeValidation) {
    validation = validateBundle(resources);

    if (validation.summary.warnings > 0 || validation.summary.errors > 0) {
      const operationOutcome = createValidationOperationOutcome(validation);
      bundle.entry?.unshift({
        fullUrl: "urn:uuid:validation-outcome",
        resource: operationOutcome,
        search: { mode: "outcome" },
      });
    }
  }

  return {
    bundle,
    validation,
    metadata: {
      generatedAt: new Date().toISOString(),
      resourceCount: resources.length,
      since,
      patientId,
    },
  };
}

export function createValidationOperationOutcome(
  validation: BundleValidationResult,
): FHIROperationOutcome {
  const issues: FHIROperationOutcome["issue"] = [];

  for (const [resourceId, result] of validation.resourceResults) {
    for (const error of result.errors) {
      issues.push({
        severity: "error",
        code: "structure",
        diagnostics: `${resourceId}: ${error.path} - ${error.message}`,
      });
    }
    for (const warning of result.warnings) {
      issues.push({
        severity: "warning",
        code: "informational",
        diagnostics: `${resourceId}: ${warning.path} - ${warning.message}`,
      });
    }
  }

  if (issues.length === 0) {
    issues.push({
      severity: "information",
      code: "informational",
      diagnostics: "All resources passed US Core 6.1.0 validation",
    });
  }

  return {
    resourceType: "OperationOutcome",
    id: "validation-result",
    issue: issues,
  };
}

export function generateNDJSON(resources: FHIRResource[]): string {
  return resources.map((r) => JSON.stringify(r)).join("\n");
}

export interface IncrementalExportResult {
  bundle: FHIRBundle;
  newSinceToken: string;
  hasChanges: boolean;
  changesSummary: {
    added: number;
    modified: number;
    total: number;
  };
}

export function filterResourcesSince(
  resources: FHIRResource[],
  since?: string,
): { filtered: FHIRResource[]; hasChanges: boolean } {
  if (!since) {
    return { filtered: resources, hasChanges: resources.length > 0 };
  }

  const sinceDate = new Date(since);
  const filtered = resources.filter((resource) => {
    const lastUpdated = resource.meta?.lastUpdated;
    if (!lastUpdated) return true;
    return new Date(lastUpdated) > sinceDate;
  });

  return { filtered, hasChanges: filtered.length > 0 };
}

export function generateIncrementalBundle(
  resources: FHIRResource[],
  since?: string,
  options: BundleOptions = {},
): IncrementalExportResult {
  const { filtered, hasChanges } = filterResourcesSince(resources, since);

  const newSinceToken = new Date().toISOString();

  const bundle = createFHIRBundle(filtered, {
    ...options,
    type: "searchset",
  });

  if (since) {
    bundle.link?.push({
      relation: "previous",
      url: `${options.baseUrl || "urn:uuid:mbhr-export"}?_since=${since}`,
    });
  }

  bundle.link?.push({
    relation: "next",
    url: `${options.baseUrl || "urn:uuid:mbhr-export"}?_since=${newSinceToken}`,
  });

  return {
    bundle,
    newSinceToken,
    hasChanges,
    changesSummary: {
      added: filtered.length,
      modified: 0,
      total: filtered.length,
    },
  };
}

export function generateBulkExportNDJSON(
  resourcesByType: Map<string, FHIRResource[]>,
): Map<string, string> {
  const result = new Map<string, string>();

  for (const [resourceType, resources] of resourcesByType) {
    if (resources.length > 0) {
      result.set(`${resourceType}.ndjson`, generateNDJSON(resources));
    }
  }

  return result;
}

export function createExportManifest(
  files: Map<string, string>,
  options: {
    transactionTime: string;
    request: string;
    requiresAccessToken: boolean;
    output: Array<{ type: string; url: string; count: number }>;
  },
): Record<string, unknown> {
  return {
    transactionTime: options.transactionTime,
    request: options.request,
    requiresAccessToken: options.requiresAccessToken,
    output: options.output,
    error: [],
  };
}
