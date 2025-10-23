import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from 'react-router-dom';
import { BeakerIcon, CubeIcon, ClipboardDocumentListIcon, ArrowLeftIcon, } from '@heroicons/react/24/outline';
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
];
export default function PharmacyMenu() {
    return (_jsxs("main", { className: "p-4 sm:p-6 max-w-5xl mx-auto", children: [_jsx("div", { className: "mb-4", children: _jsxs(Link, { to: "/", className: "inline-flex items-center gap-2 text-sm text-gray-700 hover:text-gray-900 focus:outline-none focus:ring", children: [_jsx(ArrowLeftIcon, { className: "h-4 w-4", "aria-hidden": true }), "Back to Dashboard"] }) }), _jsx("h1", { className: "text-2xl font-bold mb-2", children: "Pharmacy" }), _jsx("p", { className: "text-gray-600 mb-6", children: "Choose what you'd like to do." }), _jsx("section", { "aria-label": "Pharmacy options", className: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4", children: cards.map(({ to, title, desc, Icon }) => (_jsxs(Link, { to: to, className: "group rounded-2xl border border-gray-200 p-5 hover:shadow-md focus:outline-none focus:ring focus:ring-primary/30", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "rounded-xl bg-gray-100 p-3", children: _jsx(Icon, { className: "h-6 w-6", "aria-hidden": true }) }), _jsx("h2", { className: "text-lg font-semibold", children: title })] }), _jsx("p", { className: "mt-3 text-sm text-gray-600", children: desc }), _jsxs("span", { className: "sr-only", children: ["Open ", title] })] }, to))) })] }));
}
