import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownTrayIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { supabase, isSupabaseEnabled } from "@/lib/supabaseClient";
import * as logger from "@/lib/logger";
import { formatNigerianDateTime } from "@/utils/dateFormat";
import {
  getFHIRBaseUrl,
  TEFCA_ROADMAP,
  US_CORE_VERSION,
} from "../../config/tefca";
import {
  exportPatientEHI,
  getExportPreview,
  downloadBundle,
  type ExportResult,
} from "../../services/fhir/dexieExporter";
import {
  countBundleResources,
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

interface ExportOptions {
  includePatient: boolean;
  includeVitals: boolean;
  includeMedications: boolean;
  includeEncounters: boolean;
  includeConsultations: boolean;
  includeAllergies: boolean;
  dateRange: "all" | "1year" | "2years" | "5years";
  format: "fhir-json" | "fhir-bundle";
  validate: boolean;
}

interface Props {
  patientId: string;
}

interface Preview {
  resourceCounts: Record<string, number>;
  totalResources: number;
  lastExport?: string;
  estimatedSize: string;
}

type Phase = "idle" | "cloud" | "local" | "fallback";

const PHASE_TEXT: Record<Exclude<Phase, "idle">, string> = {
  cloud: "Getting your record from the online service…",
  local: "Making your file from records saved on this device…",
  fallback:
    "The online service did not respond. Making your file from records saved on this device instead…",
};

const DATE_RANGES: { value: ExportOptions["dateRange"]; label: string }[] = [
  { value: "all", label: "Everything available" },
  { value: "1year", label: "The last year" },
  { value: "2years", label: "The last 2 years" },
  { value: "5years", label: "The last 5 years" },
];

/** How long to wait for the online record before using this device instead. */
const ONLINE_EXPORT_TIMEOUT_MS = 30_000;

function isDateRange(v: string): v is ExportOptions["dateRange"] {
  return DATE_RANGES.some((r) => r.value === v);
}

export function HealthDataExport({ patientId }: Props) {
  const isOnline = useOnlineStatus();
  const cloudAvailable = isSupabaseEnabled && isOnline;
  const [dataSource, setDataSource] = useState<"cloud" | "local">("cloud");
  const source = cloudAvailable ? dataSource : "local";

  const [phase, setPhase] = useState<Phase>("idle");
  const exporting = phase !== "idle";
  const [outcome, setOutcome] = useState<ExportOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  const [options, setOptions] = useState<ExportOptions>({
    includePatient: true,
    includeVitals: true,
    includeMedications: true,
    includeEncounters: true,
    includeConsultations: true,
    includeAllergies: true,
    dateRange: "all",
    format: "fhir-bundle",
    validate: true,
  });

  const loadPreview = useCallback(async () => {
    if (!patientId) return;
    try {
      const previewData = await getExportPreview(patientId);
      setPreview(previewData);
      setPreviewFailed(false);
    } catch (err) {
      logger.error("[HealthDataExport] preview failed:", errorName(err));
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

  const exportFromDevice = async (fellBack: boolean) => {
    setPhase(fellBack ? "fallback" : "local");
    try {
      const result: ExportResult = await exportPatientEHI(patientId, {
        ...options,
        format: "fhir-bundle",
      });

      if (!result.success || !result.bundle) {
        setError(exportErrorMessage(result.error, { fellBack }));
        return;
      }

      const fileName = `${exportFileBase(patientId)}.json`;
      downloadBundle(result.bundle, fileName);

      setOutcome({
        fileName,
        source: "device",
        fellBack,
        counts: result.metadata.resourceCounts,
        since: result.metadata.since,
        validation: result.validation,
      });
      void loadPreview();
    } catch (err) {
      logger.error("[HealthDataExport] device export failed:", errorName(err));
      setError(exportErrorMessage(undefined, { fellBack }));
    }
  };

  const exportFromCloud = async () => {
    setPhase("cloud");
    // Never wait forever on a slow connection: give up after a while and
    // make the file from this device instead (the result says so).
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => controller.abort(),
      ONLINE_EXPORT_TIMEOUT_MS,
    );
    try {
      if (!supabase) throw new Error("Supabase unavailable");
      const baseUrl = getFHIRBaseUrl();
      const response = await fetch(
        `${baseUrl}/Patient/${patientId}/$everything`,
        {
          headers: {
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            "X-Exchange-Purpose": "individual-access",
            Accept: "application/fhir+json",
          },
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        window.clearTimeout(timer);
        setDataSource("local");
        await exportFromDevice(true);
        return;
      }

      const data: unknown = await response.json();
      window.clearTimeout(timer);

      const fileName = `${exportFileBase(patientId)}.json`;
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setOutcome({
        fileName,
        source: "online",
        counts: countBundleResources(data),
      });
    } catch (err) {
      window.clearTimeout(timer);
      logger.warn("[HealthDataExport] online export failed:", errorName(err));
      setDataSource("local");
      await exportFromDevice(true);
    }
  };

  const handleExport = async () => {
    if (!patientId) return;
    setError(null);
    setOutcome(null);
    try {
      if (source === "cloud") {
        await exportFromCloud();
      } else {
        await exportFromDevice(false);
      }
    } finally {
      setPhase("idle");
    }
  };

  const toggleSection = (key: ExportSectionKey, checked: boolean) =>
    setOptions((o) => ({ ...o, [key]: checked }));

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <PageHeader
        title="Download your health record"
        description="Save a copy of your health record as a file you can keep or give to another doctor."
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

      <section className="panel" aria-labelledby="export-source-title">
        <div className="panel-header">
          <h2 id="export-source-title" className="panel-title">
            Where the file comes from
          </h2>
          <StatusBadge tone={isOnline ? "success" : "neutral"} icon>
            {isOnline ? "Online" : "Offline"}
          </StatusBadge>
        </div>
        <div className="panel-body">
          {cloudAvailable ? (
            <fieldset>
              <legend className="sr-only">Choose where the file comes from</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <label
                  htmlFor="export-source-cloud"
                  className="flex min-h-touch-target cursor-pointer items-start gap-3 rounded-md border border-line p-3 hover:bg-surface-hover"
                >
                  <input
                    id="export-source-cloud"
                    type="radio"
                    name="dataSource"
                    checked={dataSource === "cloud"}
                    onChange={() => setDataSource("cloud")}
                    disabled={exporting}
                    className="mt-0.5 h-5 w-5 shrink-0 text-primary focus:ring-primary"
                  />
                  <span>
                    <span className="block text-body font-medium text-ink">
                      Your online record
                    </span>
                    <span className="block text-caption text-ink-muted">
                      The most up to date. Needs an internet connection.
                    </span>
                  </span>
                </label>
                <label
                  htmlFor="export-source-local"
                  className="flex min-h-touch-target cursor-pointer items-start gap-3 rounded-md border border-line p-3 hover:bg-surface-hover"
                >
                  <input
                    id="export-source-local"
                    type="radio"
                    name="dataSource"
                    checked={dataSource === "local"}
                    onChange={() => setDataSource("local")}
                    disabled={exporting}
                    className="mt-0.5 h-5 w-5 shrink-0 text-primary focus:ring-primary"
                  />
                  <span>
                    <span className="block text-body font-medium text-ink">
                      Records saved on this device
                    </span>
                    <span className="block text-caption text-ink-muted">
                      Works without internet. May miss recent visits.
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>
          ) : (
            <p className="flex items-start gap-2 text-body text-ink-secondary">
              <InformationCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
              <span>
                {isSupabaseEnabled
                  ? "You are offline, so the file will be made from records saved on this device. It may not include your most recent visits."
                  : "The file will be made from records saved on this device."}
              </span>
            </p>
          )}
          {preview?.lastExport && (
            <p className="mt-3 text-caption text-ink-muted">
              Last file made on this device:{" "}
              {formatNigerianDateTime(preview.lastExport)}.
              {source === "local"
                ? " A new file made on this device will only include records that changed since then, so keep your earlier file."
                : ""}
            </p>
          )}
        </div>
      </section>

      <section className="panel" aria-labelledby="export-content-title">
        <div className="panel-header">
          <h2 id="export-content-title" className="panel-title">
            Choose what goes in the file
          </h2>
        </div>
        <div className="panel-body space-y-5">
          <ExportContentOptions
            idPrefix="hde"
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
              <label htmlFor="hde-range" className="field-label">
                Time period
              </label>
              <select
                id="hde-range"
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
              <p className="field-label">File format</p>
              <p className="text-body text-ink">FHIR R4, saved as a .json file</p>
              <p className="field-hint">
                A standard format for health records.
                {preview?.estimatedSize
                  ? ` Expected size about ${preview.estimatedSize}.`
                  : ""}
              </p>
            </div>
          </div>

          <label
            htmlFor="hde-validate"
            className="flex min-h-touch-target cursor-pointer items-start gap-3"
          >
            <input
              id="hde-validate"
              type="checkbox"
              checked={options.validate}
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
                Only for files made on this device. Tells you if any item may
                not be accepted by other health systems.
              </span>
            </span>
          </label>
        </div>
      </section>

      <div aria-live="polite" className="space-y-3">
        {phase !== "idle" && (
          <p role="status" className="flex items-center gap-2 text-body text-ink-secondary">
            <span
              className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent"
              aria-hidden
            />
            {PHASE_TEXT[phase]}
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

      <ExportAboutDetails>
        <div className="space-y-3 border-t border-line pt-3">
          <p className="section-label">Record sharing: what is ready and what is planned</p>
          {Object.entries(TEFCA_ROADMAP).map(([key, phaseInfo]) => (
            <div key={key}>
              <p className="flex flex-wrap items-center gap-2 text-body font-medium text-ink">
                {phaseInfo.name}
                <StatusBadge
                  tone={phaseInfo.status === "complete" ? "success" : "neutral"}
                  icon
                >
                  {phaseInfo.status === "complete"
                    ? "Ready"
                    : phaseInfo.status === "planned"
                      ? "Planned"
                      : phaseInfo.status === "in-progress"
                        ? "In progress"
                        : "Future"}
                </StatusBadge>
              </p>
              <ul className="mt-1 space-y-0.5 text-caption text-ink-muted">
                {phaseInfo.features.slice(0, 3).map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-1.5">
                    {phaseInfo.status === "complete" && (
                      <CheckCircleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    )}
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </ExportAboutDetails>
    </div>
  );
}
