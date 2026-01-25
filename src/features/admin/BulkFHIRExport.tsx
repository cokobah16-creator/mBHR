import { useState, useEffect } from 'react';
import {
  ArrowDownTrayIcon,
  DocumentDuplicateIcon,
  ShieldCheckIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';
import { db } from '../../db';
import {
  exportBulkEHI,
  downloadBulkExport,
  type BulkExportProgress,
  type BulkExportResult,
} from '../../services/fhir/dexieExporter';
import type { BundleValidationResult } from '../../services/fhir/uscore-validator';

interface ExportHistory {
  id: string;
  exportedAt: string;
  patientCount: number;
  resourceCount: number;
  status: 'completed' | 'failed';
  error?: string;
}

export function BulkFHIRExport() {
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<BulkExportProgress | null>(null);
  const [result, setResult] = useState<BulkExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [patientCount, setPatientCount] = useState(0);
  const [exportHistory, setExportHistory] = useState<ExportHistory[]>([]);

  const [options, setOptions] = useState({
    includeVitals: true,
    includeMedications: true,
    includeEncounters: true,
    includeConsultations: true,
    includeAllergies: true,
    dateRange: 'all' as 'all' | '1year' | '2years' | '5years',
    validate: true,
    batchSize: 100,
  });

  useEffect(() => {
    loadStats();
    loadExportHistory();
  }, []);

  async function loadStats() {
    const count = await db.patients.filter(p => !p.mergeInto).count();
    setPatientCount(count);
  }

  async function loadExportHistory() {
    try {
      const meta = await db.meta.get('bulk_export_history');
      if (meta?.value) {
        setExportHistory(meta.value as ExportHistory[]);
      }
    } catch (err) {
      console.error('Failed to load export history:', err);
    }
  }

  async function saveExportHistory(entry: ExportHistory) {
    const history = [entry, ...exportHistory].slice(0, 10);
    setExportHistory(history);
    await db.meta.put({
      key: 'bulk_export_history',
      value: history,
      updatedAt: Date.now(),
    });
  }

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    setResult(null);
    setProgress(null);

    try {
      const exportResult = await exportBulkEHI({
        ...options,
        includePatient: true,
        format: 'fhir-bundle',
        onProgress: (p) => setProgress({ ...p }),
      });

      setResult(exportResult);

      if (exportResult.success) {
        await downloadBulkExport(exportResult.files, exportResult.manifest);

        await saveExportHistory({
          id: Date.now().toString(),
          exportedAt: new Date().toISOString(),
          patientCount: exportResult.progress.processedPatients,
          resourceCount: Array.from(exportResult.files.values())
            .reduce((sum, content) => sum + content.split('\n').length, 0),
          status: 'completed',
        });
      } else {
        await saveExportHistory({
          id: Date.now().toString(),
          exportedAt: new Date().toISOString(),
          patientCount: exportResult.progress.processedPatients,
          resourceCount: 0,
          status: 'failed',
          error: exportResult.progress.error,
        });
        setError(exportResult.progress.error || 'Export failed');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Export failed';
      setError(errorMessage);
      await saveExportHistory({
        id: Date.now().toString(),
        exportedAt: new Date().toISOString(),
        patientCount: progress?.processedPatients || 0,
        resourceCount: 0,
        status: 'failed',
        error: errorMessage,
      });
    } finally {
      setExporting(false);
    }
  };

  const progressPercent = progress
    ? Math.round((progress.processedPatients / progress.totalPatients) * 100)
    : 0;

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-teal-100 rounded-xl flex items-center justify-center">
            <DocumentDuplicateIcon className="w-6 h-6 text-teal-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Bulk FHIR Export</h2>
            <p className="text-gray-600">Export all patient records for population-level analysis</p>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <div className="flex gap-3">
            <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-amber-900">Administrative Operation</h3>
              <p className="text-sm text-amber-700 mt-1">
                This export includes data for all {patientCount.toLocaleString()} patients.
                Only authorized administrators should perform bulk exports.
                All exports are logged for compliance auditing.
              </p>
            </div>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex gap-3">
            <ShieldCheckIcon className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-blue-900">Certification Criterion 170.315(b)(10)</h3>
              <p className="text-sm text-blue-700 mt-1">
                Bulk export complies with EHI Export requirements. Data is exported in NDJSON format
                with US Core 6.1.0 validation, supporting population health analytics and data migration.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-gray-50 rounded-lg p-4 text-center">
            <UserGroupIcon className="w-8 h-8 text-gray-600 mx-auto mb-2" />
            <div className="text-2xl font-bold text-gray-900">{patientCount.toLocaleString()}</div>
            <div className="text-sm text-gray-600">Total Patients</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-4 text-center">
            <ClockIcon className="w-8 h-8 text-gray-600 mx-auto mb-2" />
            <div className="text-2xl font-bold text-gray-900">
              ~{Math.ceil(patientCount / options.batchSize / 2)} min
            </div>
            <div className="text-sm text-gray-600">Estimated Time</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-4 text-center">
            <DocumentDuplicateIcon className="w-8 h-8 text-gray-600 mx-auto mb-2" />
            <div className="text-2xl font-bold text-gray-900">6</div>
            <div className="text-sm text-gray-600">Resource Types</div>
          </div>
        </div>

        <div className="space-y-4 mb-6">
          <h3 className="font-medium text-gray-900">Export Options:</h3>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <label className="flex items-center gap-2 p-2 rounded hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={options.includeVitals}
                onChange={(e) => setOptions({ ...options, includeVitals: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
              />
              <span className="text-sm text-gray-700">Vital Signs</span>
            </label>

            <label className="flex items-center gap-2 p-2 rounded hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={options.includeMedications}
                onChange={(e) => setOptions({ ...options, includeMedications: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
              />
              <span className="text-sm text-gray-700">Medications</span>
            </label>

            <label className="flex items-center gap-2 p-2 rounded hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={options.includeEncounters}
                onChange={(e) => setOptions({ ...options, includeEncounters: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
              />
              <span className="text-sm text-gray-700">Encounters</span>
            </label>

            <label className="flex items-center gap-2 p-2 rounded hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={options.includeConsultations}
                onChange={(e) => setOptions({ ...options, includeConsultations: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
              />
              <span className="text-sm text-gray-700">Clinical Notes</span>
            </label>

            <label className="flex items-center gap-2 p-2 rounded hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={options.includeAllergies}
                onChange={(e) => setOptions({ ...options, includeAllergies: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
              />
              <span className="text-sm text-gray-700">Allergies</span>
            </label>

            <label className="flex items-center gap-2 p-2 rounded hover:bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                checked={options.validate}
                onChange={(e) => setOptions({ ...options, validate: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
              />
              <span className="text-sm text-gray-700">US Core Validation</span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Time Range</label>
              <select
                value={options.dateRange}
                onChange={(e) => setOptions({ ...options, dateRange: e.target.value as typeof options.dateRange })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              >
                <option value="all">All records</option>
                <option value="1year">Last 1 year</option>
                <option value="2years">Last 2 years</option>
                <option value="5years">Last 5 years</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Batch Size</label>
              <select
                value={options.batchSize}
                onChange={(e) => setOptions({ ...options, batchSize: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              >
                <option value={50}>50 patients/batch (slower, less memory)</option>
                <option value={100}>100 patients/batch (balanced)</option>
                <option value={200}>200 patients/batch (faster, more memory)</option>
              </select>
            </div>
          </div>
        </div>

        {progress && (
          <div className="mb-6">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="font-medium text-gray-700">
                Processing: {progress.processedPatients.toLocaleString()} / {progress.totalPatients.toLocaleString()} patients
              </span>
              <span className="text-gray-500">{progressPercent}%</span>
            </div>
            <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-teal-600 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {progress.currentPatientId && (
              <p className="text-xs text-gray-500 mt-1">
                Current: {progress.currentPatientId}
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
            <ExclamationTriangleIcon className="w-5 h-5 text-red-600 flex-shrink-0" />
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {result?.success && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center gap-3">
              <CheckCircleIcon className="w-5 h-5 text-green-600" />
              <p className="text-green-700 font-medium">Bulk export completed successfully!</p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-600">Patients exported:</span>
                <span className="ml-2 font-medium">{result.progress.processedPatients.toLocaleString()}</span>
              </div>
              <div>
                <span className="text-gray-600">Files created:</span>
                <span className="ml-2 font-medium">{result.files.size}</span>
              </div>
            </div>
            {result.validation && (
              <div className="mt-3 text-sm">
                <span className="text-gray-600">Validation:</span>
                <span className={`ml-2 font-medium ${result.validation.valid ? 'text-green-600' : 'text-amber-600'}`}>
                  {result.validation.validResources}/{result.validation.totalResources} resources passed
                </span>
              </div>
            )}
          </div>
        )}

        <button
          onClick={handleExport}
          disabled={exporting || patientCount === 0}
          className="w-full py-4 bg-teal-600 text-white font-semibold rounded-xl hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          {exporting ? (
            <>
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Exporting {patientCount.toLocaleString()} patients...
            </>
          ) : (
            <>
              <ArrowDownTrayIcon className="w-5 h-5" />
              Start Bulk Export
            </>
          )}
        </button>
      </div>

      {exportHistory.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="font-semibold text-gray-900 mb-4">Export History</h3>
          <div className="space-y-3">
            {exportHistory.map((entry) => (
              <div
                key={entry.id}
                className={`p-3 rounded-lg border ${
                  entry.status === 'completed'
                    ? 'bg-green-50 border-green-200'
                    : 'bg-red-50 border-red-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {entry.status === 'completed' ? (
                      <CheckCircleIcon className="w-4 h-4 text-green-600" />
                    ) : (
                      <ExclamationTriangleIcon className="w-4 h-4 text-red-600" />
                    )}
                    <span className="font-medium text-gray-900">
                      {formatDate(entry.exportedAt)}
                    </span>
                  </div>
                  <span className="text-sm text-gray-600">
                    {entry.patientCount.toLocaleString()} patients, {entry.resourceCount.toLocaleString()} resources
                  </span>
                </div>
                {entry.error && (
                  <p className="text-sm text-red-600 mt-1">{entry.error}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
