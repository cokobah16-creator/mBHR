import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Link } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth';
import { can } from '@/auth/roles';
import { UserPlusIcon, HeartIcon, DocumentTextIcon, BeakerIcon, QueueListIcon, CubeIcon } from '@heroicons/react/24/outline';
export function QuickActions() {
    const { currentUser } = useAuthStore();
    const actions = [
        {
            name: 'Register Patient',
            href: '/register',
            icon: UserPlusIcon,
            color: 'bg-blue-500 hover:bg-blue-600',
            permission: 'register',
            description: 'Add new patient'
        },
        {
            name: 'View Queue',
            href: '/queue',
            icon: QueueListIcon,
            color: 'bg-purple-500 hover:bg-purple-600',
            permission: 'vitals',
            description: 'Patient flow'
        },
        {
            name: 'Record Vitals',
            href: '/vitals',
            icon: HeartIcon,
            color: 'bg-green-500 hover:bg-green-600',
            permission: 'vitals',
            description: 'Take measurements'
        },
        {
            name: 'Consultation',
            href: '/consult',
            icon: DocumentTextIcon,
            color: 'bg-indigo-500 hover:bg-indigo-600',
            permission: 'consult',
            description: 'Medical notes'
        },
        {
            name: 'Pharmacy',
            href: '/pharmacy',
            icon: BeakerIcon,
            color: 'bg-orange-500 hover:bg-orange-600',
            permission: 'dispense',
            description: 'Dispense meds'
        },
        {
            name: 'Inventory',
            href: '/inventory',
            icon: CubeIcon,
            color: 'bg-red-500 hover:bg-red-600',
            permission: 'inventory',
            description: 'Stock management'
        }
    ];
    const userCanAccess = (permission) => {
        return currentUser && can(currentUser.role, permission);
    };
    return (_jsx("div", { className: "grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4", children: actions.map((action) => (userCanAccess(action.permission) && (_jsxs(Link, { to: action.href, className: `${action.color} text-white rounded-lg p-4 text-center transition-colors touch-target group hover:scale-105 transform transition-transform`, children: [_jsx(action.icon, { className: "h-8 w-8 mx-auto mb-2 group-hover:scale-110 transition-transform" }), _jsx("div", { className: "text-sm font-medium", children: action.name }), _jsx("div", { className: "text-xs opacity-90 mt-1", children: action.description })] }, action.name)))) }));
}
