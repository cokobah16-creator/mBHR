import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownTrayIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import * as logger from "@/lib/logger";
import { formatNigerianDateTime } from "@/utils/dateFormat";
import { US_CORE_VERSION } from "../../config/tefca";
import {
  exportPatientEHI,
  getExportPreview,
  downloadBundle,
  downloadNDJSON,
  type ExportOptions,
  type ExportResult,
} from "../../services/fhir/dexieExporter";
import {
  exportErrorMessage,
  exportFileBase,
  type ExportOutcome,
  type ExportSectionKey,
} from "./account/exportSummary";
import {
  ExportAboutDetails,
  ExportContentOptions,
  ExportPrivacyNotice,
  ExportResultPanel,
} from "./account/ExportParts";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { errorName } from "./account/portalSession";

interface Props {
  patientId: string;
}

type DateRange = "all" | "1year" | "2years" | "5years";
type Format = "fhir-bundle" | "ndjson";

const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: "all", label: "Everything available" },
  { value: "1year", label: "The last year" },
  { value: "2years", label: "The last 2 years" },
  { value: "5years", label: "The last 5 years" },
];

const FORMATS: { value: Format; label: string; hint: string }[] = [
  {
    value: "fhir-bundle",
    label: "FHIR bundle (.json)",
    hint: "One file. The best choice for most people.",
  },
  {
    value: "ndjson",
    label: "NDJSON (.ndjson)",
    hint: "One record per line, for bulk import into another system.",
  },
];

function isDateRange(v: string): v is DateRange {
  return DATE_RANGES.some((r) => r.value === v);
}

function isFormat(v: string): v is Format {
  return FORMATS.some((f) => f.value === v);
}

/**
 * Health-record export that always works from the records saved on this
 * device (no network needed).
 */
export function FHIRExportOffline({ patientId }: Props) {
  const isOnline = useOnlineStatus();
  const [exporting, setExporting] = useState(false);
  const [outcome, setOutcome] = useState<ExportOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [preview, setPreview] = useState<{
    resourceCounts: Record<string, number>;
    totalResources: number;
    lastExport?: string;
    estimatedSize: string;
  } | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  const [options, setOptions] = useState<ExportOptions>({
    includePatient: true,
    includeVitals: true,
    includeMedications: true,
    includeEncounters: true,
    includeConsultations: true,
    includeAllergies: true,
    dateRange: "all" as DateRange,
    validate: true,
    format: "fhir-bundle",
  });

  const [useIncremental, setUseIncremental] = useState(false);

  const loadPreview = useCallback(async () => {
    if (!patientId) return;
    try {
      const previewData = await getExportPreview(patientId);
      setPreview(previewData);
      setPreviewFailed(false);
    } catch (err) {
      logger.error("[FHIRExportOffline] preview failed:", errorName(err));
      setPreviewFailed(true);
    }
  }, [patientId]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  const nothingSelected = !(
    options.includePatient ||
    options.includeVitals ||
    options.includeMedications ||
    options.includeEncounters ||
    options.includeConsultations ||
    options.includeAllergies
  );

  const handleExport = async () => {
    if (!patientId) return;
    setExporting(true);
    setError(null);
    setOutcome(null);

    try {
      const result: ExportResult = await exportPatientEHI(patientId, {
        ...options,
        since: useIncremental ? preview?.lastExport : undefined,
      });

      if (!result.success) {
        setError(exportErrorMessage(result.error));
        return;
      }

      const filename = exportFileBase(patientId);
      let fileName: string;
      if (result.bundle) {
        fileName = `${filename}.json`;
        downloadBundle(result.bundle, fileName);
      } else if (result.ndjson !== undefined) {
        fileName = `${filename}.ndjson`;
        downloadNDJSON(result.ndjson, fileName);
      } else {
        setError(exportErrorMessage(undefined));
        return;
      }

      setOutcome({
        fileName,
        source: "device",
        counts: result.metadata.resourceCounts,
        since: result.metadata.since,
        validation: result.validation,
      });
      void loadPreview();
    } catch (err) {
      logger.error("[FHIRExportOffline] export failed:", errorName(err));
      setError(exportErrorMessage(undefined));
    } finally {
      setExporting(false);
    }
  };

  const toggleSection = (key: ExportSectionKey, checked: boolean) =>
    setOptions((o) => ({ ...o, [key]: checked }));

  const format: Format = options.format ?? FORMATS[0].value;

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <PageHeader
        title="Download your health record"
        description="Make a file of the health records saved on this device. No internet needed."
      />

      <ExportPrivacyNotice />

      {!patientId && (
        <div className="banner banner-danger" role="alert">
          <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <p>
            We could not find your patient record. Log out, log in again, then
            try once more.
          </p>
        </div>
      )}

      <section className="panel" aria-labelledby="fxo-source-title">
        <div className="panel-header">
          <h2 id="fxo-source-title" className="panel-title">
            Where the file comes from
          </h2>
          <StatusBadge tone={isOnline ? "success" : "neutral"} icon>
            {isOnline ? "Online" : "Offline"}
          </StatusBadge>
        </div>
        <div className="panel-body space-y-2">
          <p className="flex items-start gap-2 text-body text-ink-secondary">
            <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
            <span>
              The file is made from records saved on this device. Visits that
              have not reached this device yet will not be in it.
            </span>
          </p>
          {preview && (
            <p className="text-caption text-ink-muted tabular-nums">
              About {preview.totalResources} items saved on this device · file
              size about {preview.estimatedSize} · last file made:{" "}
              {preview.lastExport
                ? formatNigerianDateTime(preview.lastExport)
                : "never"}
            </p>
          )}
        </div>
      </section>

      <section className="panel" aria-labelledby="fxo-content-title">
        <div className="panel-header">
          <h2 id="fxo-content-title" className="panel-title">
            Choose what goes in the file
          </h2>
        </div>
        <div className="panel-body space-y-5">
          <ExportContentOptions
            idPrefix="fxo"
            values={options}
            onToggle={toggleSection}
            counts={preview?.resourceCounts}
            disabled={exporting}
          />
          {previewFailed && (
            <p className="text-caption text-ink-muted">
              We could not count the records saved on this device. You can still
              make the file.
            </p>
          )}
          {nothingSelected && (
            <p className="field-error" role="alert">
              Choose at least one kind of record to include.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="fxo-range" className="field-label">
                Time period
              </label>
              <select
                id="fxo-range"
                value={options.dateRange}
                onChange={(e) => {
                  const v = e.target.value;
                  if (isDateRange(v)) setOptions((o) => ({ ...o, dateRange: v }));
                }}
                disabled={exporting}
                className="input-field"
              >
                {DATE_RANGES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="fxo-format" className="field-label">
                File format
              </label>
              <select
                id="fxo-format"
                value={format}
                onChange={(e) => {
                  const v = e.target.value;
                  if (isFormat(v)) setOptions((o) => ({ ...o, format: v }));
                }}
                disabled={exporting}
                aria-describedby="fxo-format-hint"
                className="input-field"
              >
                {FORMATS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <p id="fxo-format-hint" className="field-hint">
                {FORMATS.find((f) => f.value === format)?.hint}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="fxo-validate"
              className="flex min-h-touch-target cursor-pointer items-start gap-3"
            >
              <input
                id="fxo-validate"
                type="checkbox"
                checked={!!options.validate}
                onChange={(e) =>
                  setOptions((o) => ({ ...o, validate: e.target.checked }))
                }
                disabled={exporting}
                className="mt-0.5 h-5 w-5 shrink-0 rounded border-line-strong text-primary focus:ring-primary"
              />
              <span>
                <span className="block text-body text-ink">
                  Check the file against the US Core {US_CORE_VERSION} standard
                </span>
                <span className="block text-caption text-ink-muted">
                  Tells you if any item may not be accepted by other health
                  systems.
                </span>
              </span>
            </label>

            {preview?.lastExport && (
              <label
                htmlFor="fxo-incremental"
                className="flex min-h-touch-target cursor-pointer items-start gap-3"
              >
                <input
                  id="fxo-incremental"
                  type="checkbox"
                  checked={useIncremental}
                  onChange={(e) => setUseIncremental(e.target.checked)}
                  disabled={exporting}
                  className="mt-0.5 h-5 w-5 shrink-0 rounded border-line-strong text-primary focus:ring-primary"
                />
                <span>
                  <span className="block text-body text-ink">
                    Only include changes since my last file (
                    {formatNigerianDateTime(preview.lastExport)})
                  </span>
                  <span className="block text-caption text-ink-muted">
                    Files made on this device after the first one include only
                    changes since the last file, even when this is not ticked.
                    Keep your earlier files. The result below always says
                    whether a file only has recent changes.
                  </span>
                </span>
              </label>
            )}
          </div>
        </div>
      </section>

      <div aria-live="polite" className="space-y-3">
        {exporting && (
          <p role="status" className="flex items-center gap-2 text-body text-ink-secondary">
            <span
              className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent"
              aria-hidden
            />
            Making your file from records saved on this device…
          </p>
        )}
        {error && (
          <div className="banner banner-danger" role="alert">
            <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <p>{error}</p>
          </div>
        )}
        {outcome && (
          <ExportResultPanel outcome={outcome} usCoreVersion={US_CORE_VERSION} />
        )}
      </div>

      <button
        type="button"
        onClick={handleExport}
        disabled={exporting || !patientId || nothingSelected}
        className="btn-primary w-full"
      >
        <ArrowDownTrayIcon className="h-5 w-5" aria-hidden />
        {exporting ? "Making your file…" : "Download my health record"}
      </button>

      <ExportAboutDetails />
    </div>
  );
}
