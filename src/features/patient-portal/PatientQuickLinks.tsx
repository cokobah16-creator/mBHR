import { Link } from 'react-router-dom'
import {
  CalendarIcon,
  CreditCardIcon,
  DocumentCheckIcon,
  BellAlertIcon,
  VideoCameraIcon,
  HeartIcon,
  UserIcon,
  ClipboardDocumentListIcon
} from '@heroicons/react/24/outline'

export function PatientQuickLinks() {
  const features = [
    {
      name: 'Appointment Scheduling',
      description: 'Schedule and manage your appointments',
      icon: CalendarIcon,
      href: '/patient/appointments',
      color: 'bg-blue-100 text-blue-600',
      bgColor: 'bg-blue-50'
    },
    {
      name: 'Viewing Bills and Making Payments',
      description: 'View bills and make secure payments',
      icon: CreditCardIcon,
      href: '/patient/billing',
      color: 'bg-green-100 text-green-600',
      bgColor: 'bg-green-50'
    },
    {
      name: 'Filling Out Pre-Visit Forms',
      description: 'Complete forms before your visit',
      icon: DocumentCheckIcon,
      href: '/patient/forms',
      color: 'bg-purple-100 text-purple-600',
      bgColor: 'bg-purple-50'
    },
    {
      name: 'Prescription Refill Alerts',
      description: 'Manage prescriptions and refills',
      icon: BellAlertIcon,
      href: '/patient/prescriptions',
      color: 'bg-yellow-100 text-yellow-600',
      bgColor: 'bg-yellow-50'
    },
    {
      name: 'Patient Account and Dashboard',
      description: 'View your health information',
      icon: UserIcon,
      href: '/patient/dashboard',
      color: 'bg-indigo-100 text-indigo-600',
      bgColor: 'bg-indigo-50'
    },
    {
      name: 'Telehealth',
      description: 'Virtual video consultations',
      icon: VideoCameraIcon,
      href: '/patient/telehealth',
      color: 'bg-red-100 text-red-600',
      bgColor: 'bg-red-50'
    },
    {
      name: 'Easy Access to Patient Info',
      description: 'View medical history and records',
      icon: ClipboardDocumentListIcon,
      href: '/patient/medical-history',
      color: 'bg-teal-100 text-teal-600',
      bgColor: 'bg-teal-50'
    },
    {
      name: 'Easy Payments',
      description: 'Quick and secure payment options',
      icon: CreditCardIcon,
      href: '/patient/billing',
      color: 'bg-pink-100 text-pink-600',
      bgColor: 'bg-pink-50'
    }
  ]

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-xl font-bold text-gray-900">Quick Access</h2>
        <p className="text-gray-600 text-sm mt-1">Access all your patient portal features</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-6">
        {features.map((feature) => {
          const Icon = feature.icon

          return (
            <Link
              key={feature.name}
              to={feature.href}
              className={`${feature.bgColor} rounded-lg p-4 hover:shadow-md transition-all border border-gray-200 hover:border-gray-300`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 ${feature.color} rounded-lg flex items-center justify-center flex-shrink-0`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 text-sm">{feature.name}</h3>
                  <p className="text-xs text-gray-600 mt-1">{feature.description}</p>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
