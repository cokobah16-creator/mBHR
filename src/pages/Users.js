import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useAuthStore } from '@/stores/auth';
import { can } from '@/auth/roles';
import { UserManagement } from '@/components/UserManagement';
import { UsersIcon } from '@heroicons/react/24/outline';
export function Users() {
    const { currentUser } = useAuthStore();
    // Only admins can access user management
    if (!currentUser || !can(currentUser.role, 'users')) {
        return (_jsxs("div", { className: "text-center py-12", children: [_jsx(UsersIcon, { className: "h-12 w-12 mx-auto text-gray-400 mb-4" }), _jsx("h3", { className: "text-lg font-medium text-gray-900 mb-2", children: "Access Denied" }), _jsx("p", { className: "text-gray-600", children: "You don't have permission to manage users." })] }));
    }
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(UsersIcon, { className: "h-8 w-8 text-primary" }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "User Management" }), _jsx("p", { className: "text-gray-600", children: "Manage system users and permissions" })] })] }), _jsx(UserManagement, {})] }));
}
