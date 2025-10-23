import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
export default function PharmacyReports() {
    return (_jsxs("div", { className: "p-4", children: [_jsxs(Link, { to: "/pharmacy", className: "flex items-center text-blue-600 mb-4", children: [_jsx(ArrowLeftIcon, { className: "w-5 h-5 mr-2" }), "Back to Pharmacy"] }), _jsx("h1", { className: "text-2xl font-bold mb-4", children: "Pharmacy Reports" }), _jsx("p", { className: "text-gray-600", children: "Reports coming soon..." })] }));
}
