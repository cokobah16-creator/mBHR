import { useState } from 'react';
import {
  ArrowDownTrayIcon,
  DocumentTextIcon,
  ShieldCheckIcon,
  ClockIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { supabase } from '../../lib/supabase';
import { getFHIRBaseUrl, TEFCA_ROADMAP } from '../../config/tefca';

interface ExportOptions {
  includePatient: boolean;
  includeVitals: boolean;
  includeMedications: boolean;
  includeEncounters: boolean;
  dateRange: 'all' | '1year' | '2years' | '5years';
  format: 'fhir-json' | 'fhir-bundle';
}

interface Props {
  patientId: string;
}

export function HealthDataExport({ patientId }: Props) {
  const [exporting, setExporting] = useState(false);
  const [exportComplete, setExportComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<ExportOptions>({
    includePatient: true,
    includeVitals: true,
    includeMedications: true,
    includeEncounters: true,
    dateRange: 'all',
    format: 'fhir-bundle',
  });

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    setExportComplete(false);

    try {
      const baseUrl = getFHIRBaseUrl();
      const response = await fetch(`${baseUrl}/Patient/${patientId}/$everything`, {
        headers: {
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          'X-Exchange-Purpose': 'individual-access',
          'X-QHIN-ID': 'patient-portal',
          'Accept': 'application/fhir+json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to export health data');
      }

      const data = await response.json();

      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `health-data-${patientId}-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportComplete(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
            <ArrowDownTrayIcon className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Export Your Health Data</h2>
            <p className="text-gray-600">Download your medical records in FHIR format</p>
          </div>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex gap-3">
            <ShieldCheckIcon className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-blue-900">TEFCA Individual Access Services (IAS)</h3>
              <p className="text-sm text-blue-700 mt-1">
                Your health data is exported in FHIR R4 format, compliant with US Core profiles.
                This standard format allows you to share your records with any healthcare provider
                or health app that supports FHIR.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4 mb-6">
          <h3 className="font-medium text-gray-900">Select data to include:</h3>

          <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
            <input
              type="checkbox"
              checked={options.includePatient}
              onChange={(e) => setOptions({ ...options, includePatient: e.target.checked })}
              className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <span className="font-medium text-gray-900">Demographics</span>
              <p className="text-sm text-gray-600">Name, date of birth, contact information</p>
            </div>
          </label>

          <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
            <input
              type="checkbox"
              checked={options.includeVitals}
              onChange={(e) => setOptions({ ...options, includeVitals: e.target.checked })}
              className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <span className="font-medium text-gray-900">Vital Signs</span>
              <p className="text-sm text-gray-600">Blood pressure, heart rate, temperature, etc.</p>
            </div>
          </label>

          <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
            <input
              type="checkbox"
              checked={options.includeMedications}
              onChange={(e) => setOptions({ ...options, includeMedications: e.target.checked })}
              className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <span className="font-medium text-gray-900">Medications</span>
              <p className="text-sm text-gray-600">Prescriptions and dispensed medications</p>
            </div>
          </label>

          <label className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors">
            <input
              type="checkbox"
              checked={options.includeEncounters}
              onChange={(e) => setOptions({ ...options, includeEncounters: e.target.checked })}
              className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <span className="font-medium text-gray-900">Visits</span>
              <p className="text-sm text-gray-600">Clinic visits and consultations</p>
            </div>
          </label>
        </div>

        <div className="mb-6">
          <h3 className="font-medium text-gray-900 mb-3">Time range:</h3>
          <select
            value={options.dateRange}
            onChange={(e) => setOptions({ ...options, dateRange: e.target.value as ExportOptions['dateRange'] })}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="all">All available records</option>
            <option value="1year">Last 1 year</option>
            <option value="2years">Last 2 years</option>
            <option value="5years">Last 5 years</option>
          </select>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
            <ExclamationTriangleIcon className="w-5 h-5 text-red-600" />
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {exportComplete && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
            <CheckCircleIcon className="w-5 h-5 text-green-600" />
            <p className="text-green-700">Your health data has been downloaded successfully!</p>
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
              Preparing Export...
            </>
          ) : (
            <>
              <ArrowDownTrayIcon className="w-5 h-5" />
              Download Health Data (FHIR)
            </>
          )}
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <DocumentTextIcon className="w-6 h-6 text-gray-600" />
          <h3 className="font-semibold text-gray-900">About FHIR Format</h3>
        </div>
        <p className="text-gray-600 mb-4">
          FHIR (Fast Healthcare Interoperability Resources) is an international standard for
          exchanging healthcare information electronically. Your exported data can be:
        </p>
        <ul className="space-y-2 text-gray-600">
          <li className="flex items-center gap-2">
            <CheckCircleIcon className="w-4 h-4 text-green-600" />
            Shared with other healthcare providers
          </li>
          <li className="flex items-center gap-2">
            <CheckCircleIcon className="w-4 h-4 text-green-600" />
            Imported into personal health apps
          </li>
          <li className="flex items-center gap-2">
            <CheckCircleIcon className="w-4 h-4 text-green-600" />
            Used for insurance or benefits applications
          </li>
          <li className="flex items-center gap-2">
            <CheckCircleIcon className="w-4 h-4 text-green-600" />
            Kept as a personal backup of your records
          </li>
        </ul>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <ClockIcon className="w-6 h-6 text-gray-600" />
          <h3 className="font-semibold text-gray-900">Interoperability Roadmap</h3>
        </div>
        <div className="space-y-4">
          {Object.entries(TEFCA_ROADMAP).map(([key, phase]) => (
            <div key={key} className="border-l-2 border-gray-200 pl-4">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                  phase.status === 'complete' ? 'bg-green-100 text-green-700' :
                  phase.status === 'planned' ? 'bg-blue-100 text-blue-700' :
                  'bg-gray-100 text-gray-700'
                }`}>
                  {phase.status === 'complete' ? 'Complete' : phase.status === 'planned' ? 'Planned' : 'Future'}
                </span>
                <h4 className="font-medium text-gray-900">{phase.name}</h4>
              </div>
              <ul className="mt-2 space-y-1">
                {phase.features.slice(0, 3).map((feature, idx) => (
                  <li key={idx} className="text-sm text-gray-600">
                    {phase.status === 'complete' ? (
                      <CheckCircleIcon className="w-4 h-4 text-green-500 inline mr-1" />
                    ) : null}
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
