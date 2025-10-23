import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useAuthStore } from '@/stores/auth';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
export default function RequireRoles({ roles, children }) {
    const { currentUser } = useAuthStore();
    const userRole = currentUser?.role;
    if (!currentUser || !userRole || !roles.includes(userRole)) {
        return (_jsx("div", { className: "min-h-screen flex items-center justify-center bg-gray-50", children: _jsx("div", { className: "max-w-md w-full bg-white rounded-lg shadow-lg p-6", children: _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-red-100", children: _jsx(ExclamationTriangleIcon, { className: "h-6 w-6 text-red-600" }) }), _jsx("h3", { className: "mt-4 text-lg font-medium text-gray-900", children: "Access Restricted" }), _jsx("p", { className: "mt-2 text-sm text-gray-500", children: "You do not have permission to view this page." }), _jsxs("p", { className: "mt-1 text-xs text-gray-400", children: ["Required roles: ", roles.join(', ')] }), _jsxs("p", { className: "mt-1 text-xs text-gray-400", children: ["Your role: ", userRole || 'none'] })] }) }) }));
    }
    return _jsx(_Fragment, { children: children });
}
