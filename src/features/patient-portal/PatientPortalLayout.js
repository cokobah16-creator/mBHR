import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { HomeIcon, CalendarIcon, ClipboardDocumentListIcon, EnvelopeIcon, BeakerIcon, UserCircleIcon, ArrowLeftOnRectangleIcon, Bars3Icon, XMarkIcon, } from "@heroicons/react/24/outline";
import { useState } from "react";
const navItems = [
    { path: "/patient/dashboard", label: "Dashboard", icon: HomeIcon },
    { path: "/patient/appointments", label: "Appointments", icon: CalendarIcon },
    {
        path: "/patient/medical-history",
        label: "Medical History",
        icon: ClipboardDocumentListIcon,
    },
    { path: "/patient/messages", label: "Messages", icon: EnvelopeIcon },
    { path: "/patient/lab-results", label: "Lab Results", icon: BeakerIcon },
    { path: "/patient/account", label: "Account", icon: UserCircleIcon },
];
export function PatientPortalLayout({ children }) {
    const location = useLocation();
    const navigate = useNavigate();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const handleLogout = () => {
        localStorage.removeItem("patient_session_token");
        localStorage.removeItem("patient_portal_user");
        navigate("/patient");
    };
    const portalUser = localStorage.getItem("patient_portal_user");
    const userName = portalUser
        ? JSON.parse(portalUser).givenName || "Patient"
        : "Patient";
    return (_jsxs("div", { className: "min-h-screen bg-gray-50", children: [_jsxs("header", { className: "bg-white shadow-sm sticky top-0 z-50", children: [_jsx("div", { className: "max-w-7xl mx-auto px-4", children: _jsxs("div", { className: "flex items-center justify-between h-16", children: [_jsx("div", { className: "flex items-center gap-4", children: _jsxs(Link, { to: "/patient/dashboard", className: "flex items-center gap-2", children: [_jsx("div", { className: "w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center", children: _jsx("span", { className: "text-white font-bold text-sm", children: "mB" }) }), _jsx("span", { className: "font-semibold text-gray-900 hidden sm:block", children: "Patient Portal" })] }) }), _jsx("nav", { className: "hidden md:flex items-center gap-1", children: navItems.slice(0, 4).map((item) => {
                                        const Icon = item.icon;
                                        const isActive = location.pathname === item.path;
                                        return (_jsxs(Link, { to: item.path, className: `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isActive
                                                ? "bg-blue-100 text-blue-700"
                                                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"}`, children: [_jsx(Icon, { className: "w-5 h-5" }), _jsx("span", { children: item.label })] }, item.path));
                                    }) }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsxs("div", { className: "hidden sm:flex items-center gap-2 text-sm text-gray-600", children: [_jsx(UserCircleIcon, { className: "w-5 h-5" }), _jsx("span", { children: userName })] }), _jsxs("button", { onClick: handleLogout, className: "hidden md:flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors", children: [_jsx(ArrowLeftOnRectangleIcon, { className: "w-5 h-5" }), _jsx("span", { children: "Logout" })] }), _jsx("button", { onClick: () => setMobileMenuOpen(!mobileMenuOpen), className: "md:hidden p-2 text-gray-600 hover:bg-gray-100 rounded-lg", children: mobileMenuOpen ? (_jsx(XMarkIcon, { className: "w-6 h-6" })) : (_jsx(Bars3Icon, { className: "w-6 h-6" })) })] })] }) }), mobileMenuOpen && (_jsx("div", { className: "md:hidden border-t border-gray-200 bg-white", children: _jsxs("nav", { className: "px-4 py-3 space-y-1", children: [navItems.map((item) => {
                                    const Icon = item.icon;
                                    const isActive = location.pathname === item.path;
                                    return (_jsxs(Link, { to: item.path, onClick: () => setMobileMenuOpen(false), className: `flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors ${isActive
                                            ? "bg-blue-100 text-blue-700"
                                            : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"}`, children: [_jsx(Icon, { className: "w-5 h-5" }), _jsx("span", { children: item.label })] }, item.path));
                                }), _jsx("hr", { className: "my-2" }), _jsxs("button", { onClick: () => {
                                        setMobileMenuOpen(false);
                                        handleLogout();
                                    }, className: "flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 w-full transition-colors", children: [_jsx(ArrowLeftOnRectangleIcon, { className: "w-5 h-5" }), _jsx("span", { children: "Logout" })] })] }) }))] }), _jsx("main", { className: "pb-20 md:pb-8", children: children }), _jsx("nav", { className: "md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40", children: _jsx("div", { className: "flex justify-around py-2", children: navItems.slice(0, 5).map((item) => {
                        const Icon = item.icon;
                        const isActive = location.pathname === item.path;
                        return (_jsxs(Link, { to: item.path, className: `flex flex-col items-center gap-1 px-3 py-2 rounded-lg ${isActive ? "text-blue-600" : "text-gray-500"}`, children: [_jsx(Icon, { className: "w-6 h-6" }), _jsx("span", { className: "text-xs", children: item.label.split(" ")[0] })] }, item.path));
                    }) }) })] }));
}
