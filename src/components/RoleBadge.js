import { jsx as _jsx } from "react/jsx-runtime";
export function RoleBadge({ role, className = '' }) {
    const getRoleColor = (role) => {
        switch (role) {
            case 'admin':
                return 'bg-purple-100 text-purple-800';
            case 'doctor':
                return 'bg-blue-100 text-blue-800';
            case 'nurse':
                return 'bg-green-100 text-green-800';
            case 'pharmacist':
                return 'bg-orange-100 text-orange-800';
            case 'volunteer':
                return 'bg-gray-100 text-gray-800';
            default:
                return 'bg-gray-100 text-gray-800';
        }
    };
    return (_jsx("span", { className: `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getRoleColor(role)} ${className}`, children: role.charAt(0).toUpperCase() + role.slice(1) }));
}
