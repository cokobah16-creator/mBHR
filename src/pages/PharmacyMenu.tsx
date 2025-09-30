import { Link } from 'react-router-dom'
import {
  BeakerIcon,
  CubeIcon,
  ClipboardDocumentListIcon,
  ArrowLeftIcon,
} from '@heroicons/react/24/outline'

const cards = [
  {
    to: '/rx/dispense',
    title: 'Dispense',
    desc: 'Record prescriptions & counsel patients',
    Icon: BeakerIcon,
  },
  {
    to: '/rx/stock', 
    title: 'Inventory',
    desc: 'Stock counts, restock & FEFO tracking',
    Icon: CubeIcon,
  },
  {
    to: '/rx/new',
    title: 'New Stock', 
    desc: 'Receive deliveries / add new items',
    Icon: ClipboardDocumentListIcon,
  },
  {
    to: '/pharmacy/reports',
    title: 'Reports',
    desc: 'Daily summary & controlled log', 
    Icon: ClipboardDocumentListIcon,
  },
]

export default function PharmacyMenu() {
  return (
    <main className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="mb-4">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-gray-700 hover:text-gray-900 focus:outline-none focus:ring"
        >
          <ArrowLeftIcon className="h-4 w-4" aria-hidden />
          Back to Dashboard
        </Link>
      </div>

      <h1 className="text-2xl font-bold mb-2">Pharmacy</h1>
      <p className="text-gray-600 mb-6">Choose what you'd like to do.</p>

      <section
        aria-label="Pharmacy options"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        {cards.map(({ to, title, desc, Icon }) => (
          <Link
            key={to}
            to={to}
            className="group rounded-2xl border border-gray-200 p-5 hover:shadow-md focus:outline-none focus:ring focus:ring-primary/30"
          >
            <div className="flex items-center gap-3">
              <span className="rounded-xl bg-gray-100 p-3">
                <Icon className="h-6 w-6" aria-hidden />
              </span>
              <h2 className="text-lg font-semibold">{title}</h2>
            </div>
            <p className="mt-3 text-sm text-gray-600">{desc}</p>
            <span className="sr-only">Open {title}</span>
          </Link>
        ))}
      </section>
    </main>
  )
}