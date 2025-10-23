// Role-based access control system
// Role permission matrix
const ROLE_PERMISSIONS = {
    volunteer: {
        register: true,
        vitals: true,
        consult: false,
        dispense: false,
        inventory: false,
        export: false,
        users: false
    },
    nurse: {
        register: true,
        vitals: true,
        consult: false,
        dispense: false,
        inventory: false,
        export: false,
        users: false
    },
    doctor: {
        register: true,
        vitals: true,
        consult: true,
        dispense: false,
        inventory: false,
        export: false,
        users: false
    },
    pharmacist: {
        register: false,
        vitals: false,
        consult: false,
        dispense: true,
        inventory: true,
        export: false,
        users: false
    },
    admin: {
        register: true,
        vitals: true,
        consult: true,
        dispense: true,
        inventory: true,
        export: true,
        users: true
    }
};
export function can(role, permission) {
    return ROLE_PERMISSIONS[role]?.[permission] ?? false;
}
export function getRoleColor(role) {
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
}
export function getRoleDisplayName(role) {
    return role.charAt(0).toUpperCase() + role.slice(1);
}
