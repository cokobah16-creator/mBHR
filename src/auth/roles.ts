// Role-based access control system

export type Role = 'admin' | 'doctor' | 'nurse' | 'pharmacist' | 'volunteer'

export type Permission = 
  | 'register'     // Register new patients
  | 'vitals'       // Record vital signs
  | 'consult'      // Perform consultations
  | 'dispense'     // Dispense medications
  | 'inventory'    // Manage inventory
  | 'export'       // Export data
  | 'users'        // Manage users

// Role permission matrix
const ROLE_PERMISSIONS: Record<Role, Record<Permission, boolean>> = {
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
}

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.[permission] ?? false
}

export function getRoleColor(role: Role): string {
  switch (role) {
    case 'admin':
      return 'bg-purple-100 text-purple-800'
    case 'doctor':
      return 'bg-blue-100 text-blue-800'
    case 'nurse':
      return 'bg-green-100 text-green-800'
    case 'pharmacist':
      return 'bg-orange-100 text-orange-800'
    case 'volunteer':
      return 'bg-gray-100 text-gray-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}

export function getRoleDisplayName(role: Role): string {
  return role.charAt(0).toUpperCase() + role.slice(1)
}