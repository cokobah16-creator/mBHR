import { Link } from "react-router-dom";
import {
  BeakerIcon,
  ClipboardDocumentListIcon,
  ArrowLeftIcon,
  CubeIcon,
} from "@heroicons/react/24/outline";

type Card = { title: string; desc: string; to: string; Icon: React.ElementType };

const cards: Card[] = [
  { title: "Dispense", desc: "Record prescriptions & counsel patients.", to: "/rx/dispense", Icon: BeakerIcon },
  { title: "Inventory", desc: "Stock counts, restock & FEFO tracking.", to: "/rx/stock", Icon: CubeIcon },
  { title: "New Stock", desc: "Receive deliveries / add new items.", to: "/rx/new", Icon: ClipboardDocumentListIcon },
  { title: "Reports", desc: "Daily summary & controlled log.", to: "/pharmacy/reports", Icon: ClipboardDocumentListIcon },
];

export default function PharmacyMenu() {
  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6">
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
        {cards.map(({ title, desc, to, Icon }) => (
          <Link
            key={to}
            to={to}
            className="group rounded-2xl border border-gray-200 p-5 hover:shadow-md focus:outline-none focus:ring focus:ring-primary-300"
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
  );
}