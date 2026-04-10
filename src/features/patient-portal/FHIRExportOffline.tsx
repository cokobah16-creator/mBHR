import { useState, useEffect } from "react";
import {
  ArrowDownTrayIcon,
  ShieldCheckIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  CloudIcon,
  ServerIcon,
  ClockIcon,
  DocumentCheckIcon,
} from "@heroicons/react/24/outline";
import {
  exportPatientEHI,
  getExportPreview,
  downloadBundle,
  downloadNDJSON,
  type ExportOptions,
  type ExportResult,
} from "../../services/fhir/dexieExporter";
import type { BundleValidationResult } from "../../services/fhir/uscore-validator";

interface Props {
  patientId: string;
}

type DateRange = "all" | "1year" | "2years" | "5years";

export function FHIRExportOffline({ patientId }: Props) {
  const [exporting, setExporting] = useState(false);
  const [exportComplete, setExportComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [validation, setValidation] = useState<BundleValidationResult | null>(
    null,
  );

  const [preview, setPreview] = useState<{
    resourceCounts: Record<string, number>;
    totalResources: number;
    lastExport?: string;
    estimatedSize: string;
  } | null>(null);

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

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    loadPreview();
  }, [patientId]);

  async function loadPreview() {
    try {
      const previewData = await getExportPreview(patientId);
      setPreview(previewData);
    } catch (err) {
      console.error("Failed to load export preview:", err);
    }
  }

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    setExportComplete(false);
    setValidation(null);

    try {
      const result: ExportResult = await exportPatientEHI(patientId, {
        ...options,
        since: useIncremental ? preview?.lastExport : undefined,
      });

      if (!result.success) {
        throw new Error(result.error || "Export failed");
      }

      if (result.validation) {
        setValidation(result.validation);
      }

      const dateStr = new Date().toISOString().split("T")[0];
      const filename = `health-data-${patientId}-${dateStr}`;

      if (result.bundle) {
        downloadBundle(result.bundle, `${filename}.json`);
      } else if (result.ndjson) {
        downloadNDJSON(result.ndjson, `${filename}.ndjson`);
      }

      setExportComplete(true);
      loadPreview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
              <ArrowDownTrayIcon className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                Export Health Data
              </h2>
              <p className="text-gray-600">
                Download your medical records in FHIR format
              </p>
            </div>
          </div>

          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
              isOnline
                ? "bg-green-100 text-green-700"
                : "bg-amber-100 text-amber-700"
            }`}
          >
            {isOnline ? (
              <>
                <CloudIcon className="w-4 h-4" />
                Online
              </>
            ) : (
              <>
                <ServerIcon className="w-4 h-4" />
                Offline Mode
              </>
            )}
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex gap-3">
            <ShieldCheckIcon className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-blue-900">
                US Core 6.1.0 Compliant Export
              </h3>
              <p className="text-sm text-blue-700 mt-1">
                Your health data is exported in FHIR R4 format validated against
                US Core 6.1.0 profiles. This format is accepted by healthcare
                providers and apps that support TEFCA Individual Access
                Services.
              </p>
            </div>
          </div>
        </div>

        {preview && (
          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <h3 className="font-medium text-gray-900 mb-3">Export Preview</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Object.entries(preview.resourceCounts).map(([type, count]) => (
                <div
                  key={type}
                  className="bg-white rounded-lg p-3 border border-gray-200"
                >
                  <div className="text-2xl font-bold text-gray-900">
                    {count}
                  </div>
                  <div className="text-sm text-gray-600">{type}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
              <div className="flex items-center gap-4">
                <span>Total: {preview.totalResources} resources</span>
                <span>Size: ~{preview.estimatedSize}</span>
              </div>
              <div className="flex items-center gap-2">
                <ClockIcon className="w-4 h-4" />
                <span>Last export: {formatDate(preview.lastExport)}</span>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4 mb-6">
          <h3 className="font-medium text-gray-900">Select data to include:</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
              <input
                type="checkbox"
                checked={options.includePatient}
                onChange={(e) =>
                  setOptions({ ...options, includePatient: e.target.checked })
                }
                className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <span className="font-medium text-gray-900">Demographics</span>
                <p className="text-sm text-gray-600">Name, DOB, contact info</p>
              </div>
            </label>

            <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
              <input
                type="checkbox"
                checked={options.includeVitals}
                onChange={(e) =>
                  setOptions({ ...options, includeVitals: e.target.checked })
                }
                className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <span className="font-medium text-gray-900">Vital Signs</span>
                <p className="text-sm text-gray-600">
                  BP, heart rate, temp, etc.
                </p>
              </div>
            </label>

            <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
              <input
                type="checkbox"
                checked={options.includeMedications}
                onChange={(e) =>
                  setOptions({
                    ...options,
                    includeMedications: e.target.checked,
                  })
                }
                className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <span className="font-medium text-gray-900">Medications</span>
                <p className="text-sm text-gray-600">
                  Prescriptions & dispenses
                </p>
              </div>
            </label>

            <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
              <input
                type="checkbox"
                checked={options.includeEncounters}
                onChange={(e) =>
                  setOptions({
                    ...options,
                    includeEncounters: e.target.checked,
                  })
                }
                className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <span className="font-medium text-gray-900">Visits</span>
                <p className="text-sm text-gray-600">Clinic encounters</p>
              </div>
            </label>

            <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
              <input
                type="checkbox"
                checked={options.includeConsultations}
                onChange={(e) =>
                  setOptions({
                    ...options,
                    includeConsultations: e.target.checked,
                  })
                }
                className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <span className="font-medium text-gray-900">
                  Clinical Notes
                </span>
                <p className="text-sm text-gray-600">SOAP notes & diagnoses</p>
              </div>
            </label>

            <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
              <input
                type="checkbox"
                checked={options.includeAllergies}
                onChange={(e) =>
                  setOptions({ ...options, includeAllergies: e.target.checked })
                }
                className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <span className="font-medium text-gray-900">Allergies</span>
                <p className="text-sm text-gray-600">
                  Known allergies & reactions
                </p>
              </div>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <h3 className="font-medium text-gray-900 mb-3">Time range:</h3>
            <select
              value={options.dateRange}
              onChange={(e) =>
                setOptions({
                  ...options,
                  dateRange: e.target.value as DateRange,
                })
              }
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="all">All available records</option>
              <option value="1year">Last 1 year</option>
              <option value="2years">Last 2 years</option>
              <option value="5years">Last 5 years</option>
            </select>
          </div>

          <div>
            <h3 className="font-medium text-gray-900 mb-3">Export format:</h3>
            <select
              value={options.format}
              onChange={(e) =>
                setOptions({
                  ...options,
                  format: e.target.value as "fhir-bundle" | "ndjson",
                })
              }
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="fhir-bundle">FHIR Bundle (JSON)</option>
              <option value="ndjson">NDJSON (for bulk import)</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 mb-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={options.validate}
              onChange={(e) =>
                setOptions({ ...options, validate: e.target.checked })
              }
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">
              Validate against US Core 6.1.0
            </span>
          </label>

          {preview?.lastExport && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={useIncremental}
                onChange={(e) => setUseIncremental(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">
                Incremental export (only changes since{" "}
                {formatDate(preview.lastExport)})
              </span>
            </label>
          )}
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
            <ExclamationTriangleIcon className="w-5 h-5 text-red-600" />
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {exportComplete && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center gap-3">
              <CheckCircleIcon className="w-5 h-5 text-green-600" />
              <p className="text-green-700 font-medium">
                Your health data has been exported successfully!
              </p>
            </div>
            {validation && (
              <div className="mt-3 text-sm">
                <div className="flex items-center gap-2">
                  <DocumentCheckIcon className="w-4 h-4 text-green-600" />
                  <span className="text-green-700">
                    Validation: {validation.validResources}/
                    {validation.totalResources} resources passed US Core 6.1.0
                  </span>
                </div>
                {validation.summary.warnings > 0 && (
                  <p className="text-amber-600 mt-1">
                    {validation.summary.warnings} warnings (non-blocking)
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <button
          onClick={handleExport}
          disabled={exporting}
          className="w-full py-4 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          {exporting ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Exporting from {isOnline ? "Cloud" : "Local Device"}...
            </>
          ) : (
            <>
              <ArrowDownTrayIcon className="w-5 h-5" />
              Download Health Data (FHIR)
            </>
          )}
        </button>

        {!isOnline && (
          <p className="mt-3 text-sm text-center text-amber-600">
            Exporting from local device storage. Some records may not be fully
            synced.
          </p>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">
          What can you do with your FHIR export?
        </h3>
        <ul className="space-y-3">
          <li className="flex items-start gap-3">
            <CheckCircleIcon className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <span className="text-gray-700">
              Share with other healthcare providers for continuity of care
            </span>
          </li>
          <li className="flex items-start gap-3">
            <CheckCircleIcon className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <span className="text-gray-700">
              Import into personal health apps (Apple Health, CommonHealth)
            </span>
          </li>
          <li className="flex items-start gap-3">
            <CheckCircleIcon className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <span className="text-gray-700">
              Use for insurance claims or benefits applications
            </span>
          </li>
          <li className="flex items-start gap-3">
            <CheckCircleIcon className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <span className="text-gray-700">
              Keep as a personal backup of your medical records
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
