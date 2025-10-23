import { Link } from 'react-router-dom'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'

export default function PharmacyReports() {
  return (
    <div className="p-4">
      <Link to="/pharmacy" className="flex items-center text-blue-600 mb-4">
        <ArrowLeftIcon className="w-5 h-5 mr-2" />
        Back to Pharmacy
      </Link>
      <h1 className="text-2xl font-bold mb-4">Pharmacy Reports</h1>
      <p className="text-gray-600">Reports coming soon...</p>
    </div>
  )
}
