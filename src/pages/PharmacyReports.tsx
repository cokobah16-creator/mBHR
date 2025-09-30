import { Link } from "react-router-dom";
import { ArrowLeftIcon, ClipboardDocumentListIcon } from "@heroicons/react/24/outline";

export default function PharmacyReports() {
  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6">
      <div className="mb-4">
        <Link
          to="/pharmacy"
          className="inline-flex items-center gap-2 text-sm text-gray-700 hover:text-gray-900 focus:outline-none focus:ring"
        >
          <ArrowLeftIcon className="h-4 w-4" aria-hidden />
          Back to Pharmacy Menu
        </Link>
      </div>

      <div className="flex items-center space-x-3 mb-6">
        <ClipboardDocumentListIcon className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pharmacy Reports</h1>
          <p className="text-gray-600">Daily summary, controlled substances log, and analytics</p>
        </div>
      </div>

      <div className="card">
        <div className="text-center py-12">
          <ClipboardDocumentListIcon className="h-12 w-12 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Reports Coming Soon</h3>
          <p className="text-gray-600">
            This section will include daily dispensing summaries, controlled substances logs, 
            inventory reports, and compliance documentation.
          </p>
        </div>
      </div>
    </main>
  );
}