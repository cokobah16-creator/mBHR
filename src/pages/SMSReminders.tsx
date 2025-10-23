import { Link } from 'react-router-dom'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { SMSReminderManager } from '@/features/pharmacy/SMSReminderManager'

export default function SMSReminders() {

  return (
    <main className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-4">
        <Link
          to="/pharmacy"
          className="inline-flex items-center gap-2 text-sm text-gray-700 hover:text-gray-900 focus:outline-none focus:ring"
        >
          <ArrowLeftIcon className="h-4 w-4" aria-hidden />
          Back to Pharmacy Menu
        </Link>
      </div>

      <h1 className="text-2xl font-bold mb-2">SMS Medication Reminders</h1>
      <p className="text-gray-600 mb-6">
        Manage and track medication reminders sent to patients
      </p>

      <SMSReminderManager />
    </main>
  )
}
