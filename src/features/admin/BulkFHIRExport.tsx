import { useState, useEffect } from "react";
import {
  ArrowDownTrayIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { db } from "../../db";
import {
  exportBulkEHI,
  downloadBulkExport,
  type BulkExportProgress,
  type BulkExportResult,
} from "../../services/fhir/dexieExporter";
import { useAuthStore } from "@/stores/auth";
import { can } from "@/auth/roles";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ConfirmDialog } from "@/features/admin/ConfirmDialog";

interface ExportHistory {
  id: string;
  exportedAt: string;
  patientCount: number;
  resourceCount: number;
  status: "completed" | "failed";
  error?: string;
}

type DateRange = "all" | "1year" | "2years" | "5years";

const DATE_RANGES: { id: DateRange; label: string }[] = [
  { id: "all", label: "All records" },
  { id: "1year", label: "Last 1 year" },
  { id: "2years", label: "Last 2 years" },
  { id: "5years", label: "Last 5 years" },
];

const BATCH_SIZES = [
  { value: 50, label: "50 patients per batch (slower, less memory)" },
  { value: 100, label: "100 patients per batch (balanced)" },
  { value: 200, label: "200 patients per batch (faster, more memory)" },
];

function isDateRange(value: string): value is DateRange {
  return DATE_RANGES.some((r) => r.id === value);
}

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString("en-NG", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Exports every patient record stored on this device as FHIR NDJSON files
 * in one ZIP. Works offline: it reads only the local database.
 */
export function BulkFHIRExport() {
  const role = useAuthStore((s) => s.currentUser?.role);
  const canExport = !!role && can(role, "export");

  const [exporting, setExporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<BulkExportProgress | null>(null);
  const [result, setResult] = useState<BulkExportResult | null>(null);
  const [downloadName, setDownloadName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [patientCount, setPatientCount] = useState<number | null>(null);
  const [exportHistory, setExportHistory] = useState<ExportHistory[]>([]);

  const [options, setOptions] = useState({
    includeVitals: true,
    includeMedications: true,
    includeEncounters: true,
    includeConsultations: true,
    includeAllergies: true,
    dateRange: "all" as DateRange,
    validate: true,
    batchSize: 100,
  });

  useEffect(() => {
    async function loadStats() {
      try {
        const count = await db.patients.filter((p) => !p.mergeInto).count();
        setPatientCount(count);
      } catch (err) {
        console.error(
          "Failed to count patients:",
          err instanceof Error ? err.name : err,
        );
        setPatientCount(0);
      }
    }

    async function loadExportHistory() {
      try {
        const meta = await db.meta.get("bulk_export_history");
        if (meta?.value) {
          setExportHistory(meta.value as ExportHistory[]);
        }
      } catch (err) {
        console.error(
          "Failed to load export history:",
          err instanceof Error ? err.name : err,
        );
      }
    }

    loadStats();
    loadExportHistory();
  }, []);

  // History is a convenience: failing to store it must not turn a finished
  // export (whose file already downloaded) into a reported failure.
  async function saveExportHistory(entry: ExportHistory) {
    const history = [entry, ...exportHistory].slice(0, 10);
    setExportHistory(history);
    try {
      await db.meta.put({
        key: "bulk_export_history",
        value: history,
        updatedAt: Date.now(),
      });
    } catch (err) {
      console.error(
        "Failed to save export history:",
        err instanceof Error ? err.name : err,
      );
    }
  }

  const handleExport = async () => {
    setConfirming(false);
    if (!canExport) {
      setError("Your role cannot export data. Ask an administrator.");
      return;
    }
    setExporting(true);
    setError(null);
    setResult(null);
    setProgress(null);
    setDownloadName("");
    // `progress` state is stale inside this handler; track the count here.
    let processedSoFar = 0;

    try {
      const exportResult = await exportBulkEHI({
        ...options,
        includePatient: true,
        format: "fhir-bundle",
        onProgress: (p) => {
          processedSoFar = p.processedPatients;
          setProgress({ ...p });
        },
      });

      setResult(exportResult);

      if (exportResult.success) {
        await downloadBulkExport(exportResult.files, exportResult.manifest);
        setDownloadName(
          `mbhr-bulk-export-${new Date().toISOString().split("T")[0]}.zip`,
        );

        await saveExportHistory({
          id: Date.now().toString(),
          exportedAt: new Date().toISOString(),
          patientCount: exportResult.progress.processedPatients,
          resourceCount: Array.from(exportResult.files.values()).reduce(
            (sum, content) => sum + content.split("\n").length,
            0,
          ),
          status: "completed",
        });
      } else {
        await saveExportHistory({
          id: Date.now().toString(),
          exportedAt: new Date().toISOString(),
          patientCount: exportResult.progress.processedPatients,
          resourceCount: 0,
          status: "failed",
          error: exportResult.progress.error,
        });
        setError(exportResult.progress.error || "Export failed");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Export failed";
      setError(errorMessage);
      setResult(null);
      await saveExportHistory({
        id: Date.now().toString(),
        exportedAt: new Date().toISOString(),
        patientCount: processedSoFar,
        resourceCount: 0,
        status: "failed",
        error: errorMessage,
      });
    } finally {
      setExporting(false);
    }
  };

  const progressPercent =
    progress && progress.totalPatients > 0
      ? Math.round((progress.processedPatients / progress.totalPatients) * 100)
      : 0;

  const checkbox = (
    key:
      | "includeVitals"
      | "includeMedications"
      | "includeEncounters"
      | "includeConsultations"
      | "includeAllergies"
      | "validate",
    label: string,
  ) => (
    <label
      htmlFor={`fhir-${key}`}
      className="flex min-h-touch-target cursor-pointer items-center gap-3 rounded-md px-2 text-body text-ink hover:bg-surface-hover"
    >
      <input
        id={`fhir-${key}`}
        type="checkbox"
        checked={options[key]}
        disabled={exporting}
        onChange={(e) => setOptions({ ...options, [key]: e.target.checked })}
        className="h-5 w-5 rounded border-line-strong text-primary focus:ring-primary"
      />
      {label}
    </label>
  );

  const count = patientCount ?? 0;

  return (
    <div className="space-y-4">
      <section className="panel" aria-labelledby="fhir-export-title">
        <div className="panel-header">
          <h2 id="fhir-export-title" className="panel-title">
            Export options
          </h2>
          <span className="text-caption text-ink-muted tabular-nums">
            {patientCount === null
              ? "Counting patients…"
              : `${count.toLocaleString("en-NG")} patient${count === 1 ? "" : "s"} on this device`}
          </span>
        </div>

        <div className="panel-body space-y-5">
          <div className="banner banner-warning">
            <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">This file contains patient records</p>
              <p className="mt-1">
                The ZIP holds the health records of every patient on this device.
                Anyone who has the file can read it. Store it securely and delete
                it when you no longer need it. Each export is recorded in this
                device's audit log.
              </p>
            </div>
          </div>

          <p className="text-body text-ink-secondary">
            Creates one NDJSON file per FHIR resource type plus a manifest,
            packed in a ZIP. Works offline: it uses only the records stored on
            this device.
          </p>

          {!canExport && (
            <div className="banner banner-warning" role="status">
              Your role cannot export data. Ask an administrator.
            </div>
          )}

          <fieldset>
            <legend className="field-label">Include</legend>
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {checkbox("includeVitals", "Vital signs")}
              {checkbox("includeMedications", "Medications")}
              {checkbox("includeEncounters", "Encounters")}
              {checkbox("includeConsultations", "Clinical notes")}
              {checkbox("includeAllergies", "Allergies")}
              {checkbox("validate", "Check against US Core rules")}
            </div>
            <p className="field-hint">
              Patient details are always included. The US Core check uses rules
              built into this app and reports how many resources pass; it is not
              a certification.
            </p>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="fhir-date-range" className="field-label">
                Time range
              </label>
              <select
                id="fhir-date-range"
                value={options.dateRange}
                disabled={exporting}
                onChange={(e) => {
                  const next: string = e.target.value;
                  if (isDateRange(next)) setOptions({ ...options, dateRange: next });
                }}
                className="input-field"
              >
                {DATE_RANGES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="fhir-batch-size" className="field-label">
                Batch size
              </label>
              <select
                id="fhir-batch-size"
                value={options.batchSize}
                disabled={exporting}
                onChange={(e) =>
                  setOptions({
                    ...options,
                    batchSize: parseInt(e.target.value, 10),
                  })
                }
                className="input-field"
              >
                {BATCH_SIZES.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div aria-live="polite" className="space-y-3">
            {progress && exporting && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-label text-ink">
                  <span>
                    Processing {progress.processedPatients.toLocaleString("en-NG")} of{" "}
                    {progress.totalPatients.toLocaleString("en-NG")} patients
                  </span>
                  <span className="tabular-nums">{progressPercent}%</span>
                </div>
                <div
                  className="h-2 overflow-hidden rounded-full bg-surface-sunken"
                  role="progressbar"
                  aria-label="Export progress"
                  aria-valuemin={0}
                  aria-valuemax={progress.totalPatients}
                  aria-valuenow={progress.processedPatients}
                >
                  <div
                    className="h-full bg-primary transition-[width]"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                {progress.currentPatientId && (
                  <p className="text-caption text-ink-muted">
                    Current record ID: {progress.currentPatientId}
                  </p>
                )}
              </div>
            )}

            {error && (
              <div className="banner banner-danger" role="alert">
                <ExclamationTriangleIcon className="h-5 w-5 shrink-0" aria-hidden />
                <p>
                  The export did not finish: {error}. No file was saved. Try
                  again; if it keeps failing, try a smaller batch size.
                </p>
              </div>
            )}

            {result?.success && !error && (
              <div className="banner banner-success" role="status">
                <div className="space-y-1">
                  <p className="font-medium">
                    Export finished. Download started
                    {downloadName ? `: ${downloadName}` : ""}.
                  </p>
                  <p>
                    {result.progress.processedPatients.toLocaleString("en-NG")}{" "}
                    patients processed · {result.files.size} file
                    {result.files.size === 1 ? "" : "s"} created (plus the
                    manifest).
                  </p>
                  {result.validation && (
                    <p>
                      US Core check: {result.validation.validResources} of{" "}
                      {result.validation.totalResources} resources passed
                      {result.validation.valid ? "." : ". Some resources have problems; open the files to review them."}
                    </p>
                  )}
                  <p className="text-caption">
                    If nothing downloaded, check that your browser allows
                    downloads from this app and run the export again.
                  </p>
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={exporting || count === 0 || !canExport}
            className="btn-primary w-full sm:w-auto"
          >
            <ArrowDownTrayIcon className="h-5 w-5" aria-hidden />
            {exporting
              ? `Exporting ${count.toLocaleString("en-NG")} patients…`
              : "Export all patient records"}
          </button>
          {count === 0 && patientCount !== null && (
            <p className="text-caption text-ink-muted">
              There are no patient records on this device to export.
            </p>
          )}
        </div>
      </section>

      {exportHistory.length > 0 && (
        <section className="panel" aria-labelledby="fhir-history-title">
          <div className="panel-header">
            <h2 id="fhir-history-title" className="panel-title">
              Export history
            </h2>
            <span className="text-caption text-ink-muted">
              Last {exportHistory.length} on this device
            </span>
          </div>
          <ul className="divide-y divide-line">
            {exportHistory.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge
                    tone={entry.status === "completed" ? "success" : "danger"}
                    icon
                  >
                    {entry.status === "completed" ? "Completed" : "Failed"}
                  </StatusBadge>
                  <span className="text-body text-ink tabular-nums">
                    {formatDate(entry.exportedAt)}
                  </span>
                </div>
                <span className="text-caption text-ink-muted tabular-nums">
                  {entry.patientCount.toLocaleString("en-NG")} patients,{" "}
                  {entry.resourceCount.toLocaleString("en-NG")} resources
                </span>
                {entry.error && (
                  <p className="text-caption text-danger-fg sm:basis-full">
                    {entry.error}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={confirming}
        title={`Export records for ${count.toLocaleString("en-NG")} patient${count === 1 ? "" : "s"}?`}
        confirmLabel="Export and download"
        onConfirm={handleExport}
        onCancel={() => setConfirming(false)}
      >
        <p>
          A ZIP file with the selected health records of every patient on this
          device is saved to this device's downloads.
        </p>
        <p>
          Anyone with the file can read it. Only export when you need to, keep
          the file secure and delete it after use.
        </p>
        <p>The export is recorded in this device's audit log.</p>
      </ConfirmDialog>
    </div>
  );
}
