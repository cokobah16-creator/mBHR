import React, { useState, useEffect } from 'react'
import { db, User, generateId } from '@/db'
import { useAuthStore } from '@/stores/auth'
import { can } from '@/auth/roles'
import { derivePinHash, newSaltB64 } from '@/utils/pin'
import { getRoleColor, getRoleDisplayName } from '@/auth/roles'
import { 
  UserPlusIcon, 
  PencilIcon, 
  TrashIcon,
  EyeIcon,
  EyeSlashIcon
} from '@heroicons/react/24/outline'

export function UserManagement() {
  const { currentUser } = useAuthStore()
  const [users, setUsers] = useState<User[]>([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [showPins, setShowPins] = useState(false)
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    fullName: '',
    role: 'volunteer' as User['role'],
    email: '',
    phone: '',
    pin: '',
    adminAccess: false,
    adminPermanent: false
  })

  // Only admins can manage users
  if (!currentUser || !can(currentUser.role, 'users')) {
    return null
  }

  useEffect(() => {
    loadUsers()
  }, [])

  const loadUsers = async () => {
    try {
      const allUsers = await db.users.orderBy('createdAt').toArray()
      setUsers(allUsers)
    } catch (error) {
      console.error('Error loading users:', error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.fullName || !formData.pin || formData.pin.length !== 6) {
      alert('Please fill all fields and ensure PIN is 6 digits')
      return
    }

    // Prevent non-admins from granting admin access
    if (formData.adminAccess && currentUser?.role !== 'admin') {
      alert('Only admins can grant admin access')
      return
    }

    // Prevent making users permanent admin unless current user is permanent admin
    if (formData.adminPermanent && !currentUser?.adminPermanent) {
      alert('Only permanent admins can create other permanent admins')
      return
    }
    setLoading(true)
    try {
      const salt = newSaltB64()
      const pinHash = await derivePinHash(formData.pin, salt)
      
      if (editingUser) {
        // Prevent editing permanent admin status unless current user is permanent admin
        if (editingUser.adminPermanent && !currentUser?.adminPermanent) {
          alert('Cannot modify permanent admin users')
          setLoading(false)
          return
        }

        // Update existing user
        await db.users.update(editingUser.id, {
          fullName: formData.fullName,
          role: formData.role,
          email: formData.email || undefined,
          phone: formData.phone || undefined,
          pinHash,
          pinSalt: salt,
          adminAccess: formData.adminAccess,
          adminPermanent: formData.adminPermanent,
          updatedAt: new Date()
        })
      } else {
        // Create new user
        const newUser: User = {
          id: generateId(),
          fullName: formData.fullName,
          role: formData.role,
          email: formData.email || undefined,
          phone: formData.phone || undefined,
          pinHash,
          pinSalt: salt,
          adminAccess: formData.adminAccess,
          adminPermanent: formData.adminPermanent,
          isActive: 1,
          createdAt: new Date(),
          updatedAt: new Date()
        }
        
        await db.users.add(newUser)
      }
      
      await loadUsers()
      resetForm()
    } catch (error) {
      console.error('Error saving user:', error)
      alert('Failed to save user')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setFormData({
      fullName: '',
      role: 'volunteer',
      email: '',
      phone: '',
      pin: '',
      adminAccess: false,
      adminPermanent: false
    })
    setShowAddForm(false)
    setEditingUser(null)
  }

  const startEdit = (user: User) => {
    setFormData({
      fullName: user.fullName,
      role: user.role,
      email: user.email || '',
      phone: user.phone || '',
      pin: '', // Don't pre-fill PIN for security
      adminAccess: user.adminAccess || false,
      adminPermanent: user.adminPermanent || false
    })
    setEditingUser(user)
    setShowAddForm(true)
  }

  const toggleUserStatus = async (user: User) => {
    if (user.id === currentUser?.id) {
      alert('Cannot deactivate your own account')
      return
    }
    
    if (user.adminPermanent) {
      alert('Cannot deactivate permanent admin users')
      return
    }
    
    try {
      await db.users.update(user.id, {
        isActive: user.isActive === 1 ? 0 : 1,
        updatedAt: new Date()
      })
      await loadUsers()
    } catch (error) {
      console.error('Error toggling user status:', error)
    }
  }

  const deleteUser = async (user: User) => {
    if (user.id === currentUser?.id) {
      alert('Cannot delete your own account')
      return
    }
    
    if (user.adminPermanent) {
      alert('Cannot delete permanent admin users')
      return
    }
    
    if (!confirm(`Delete user ${user.fullName}? This cannot be undone.`)) {
      return
    }
    
    try {
      await db.users.delete(user.id)
      await loadUsers()
    } catch (error) {
      console.error('Error deleting user:', error)
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900">User Management</h3>
        <div className="flex space-x-2">
          <button
            onClick={() => setShowPins(!showPins)}
            className="flex items-center space-x-1 text-sm text-gray-600 hover:text-gray-800"
          >
            {showPins ? <EyeSlashIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
            <span>{showPins ? 'Hide' : 'Show'} PINs</span>
          </button>
          <button
            onClick={() => setShowAddForm(true)}
            className="btn-primary inline-flex items-center space-x-2"
          >
            <UserPlusIcon className="h-4 w-4" />
            <span>Add User</span>
          </button>
        </div>
      </div>

      {/* Add/Edit Form */}
      {showAddForm && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <h4 className="text-md font-medium text-gray-900 mb-4">
            {editingUser ? 'Edit User' : 'Add New User'}
          </h4>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  className="input-field"
                  placeholder="Enter full name"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Role *
                </label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as User['role'] })}
                  className="input-field"
                >
                  <option value="volunteer">Volunteer</option>
                  <option value="nurse">Nurse</option>
                  <option value="doctor">Doctor</option>
                  <option value="pharmacist">Pharmacist</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="input-field"
                  placeholder="user@example.com"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone
                </label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="input-field"
                  placeholder="+234..."
                />
              </div>
              
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  PIN (6 digits) *
                </label>
                <input
                  type="password"
                  required
                  value={formData.pin}
                  onChange={(e) => setFormData({ ...formData, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                  className="input-field"
                  placeholder="Enter 6-digit PIN"
                />
              </div>
              
              {/* Admin Access Controls */}
              {currentUser?.role === 'admin' && (
                <div className="md:col-span-2 space-y-4 border-t pt-4">
                  <h4 className="text-sm font-medium text-gray-900">Admin Permissions</h4>
                  
                  <div className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      id="adminAccess"
                      checked={formData.adminAccess}
                      onChange={(e) => setFormData({ ...formData, adminAccess: e.target.checked })}
                      className="h-4 w-4 text-primary focus:ring-primary border-gray-300 rounded"
                    />
                    <label htmlFor="adminAccess" className="text-sm text-gray-700">
                      Grant admin access (can manage users, export data)
                    </label>
                  </div>
                  
                  {currentUser?.adminPermanent && (
                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        id="adminPermanent"
                        checked={formData.adminPermanent}
                        onChange={(e) => setFormData({ ...formData, adminPermanent: e.target.checked })}
                        className="h-4 w-4 text-primary focus:ring-primary border-gray-300 rounded"
                      />
                      <label htmlFor="adminPermanent" className="text-sm text-gray-700">
                        <span className="font-medium text-red-600">Permanent admin</span> (cannot be deleted or demoted)
                      </label>
                    </div>
                  )}
                  
                  <p className="text-xs text-gray-500">
                    Admin access allows user management and data export. Permanent admin status prevents deletion/demotion.
                  </p>
                </div>
              )}
            </div>
            
            <div className="flex space-x-4">
              <button
                type="submit"
                disabled={loading}
                className="btn-primary"
              >
                {loading ? 'Saving...' : editingUser ? 'Update User' : 'Create User'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Users List */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                User
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Role
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Admin Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Contact
              </th>
              {showPins && (
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  PIN
                </th>
              )}
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {users.map((user) => (
              <tr key={user.id} className={user.isActive ? '' : 'opacity-50'}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      {user.fullName}
                      {user.adminPermanent && (
                        <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                          Permanent
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500">
                      ID: {user.id.slice(-8).toUpperCase()}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getRoleColor(user.role)}`}>
                    {getRoleDisplayName(user.role)}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="space-y-1">
                    {user.adminAccess && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                        Admin Access
                      </span>
                    )}
                    {user.adminPermanent && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                        Permanent
                      </span>
                    )}
                    {!user.adminAccess && !user.adminPermanent && (
                      <span className="text-xs text-gray-400">Standard User</span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  <div>{user.email}</div>
                  <div>{user.phone}</div>
                </td>
                {showPins && (
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-600">
                    {/* Show known PINs for seeded users */}
                    {user.fullName === 'Kristopher Okobah' ? '070398' :
                     user.fullName === 'Admin User' ? '123456' :
                     user.fullName === 'Dr. Sarah Johnson' ? '234567' :
                     user.fullName === 'Nurse Mary' ? '345678' :
                     user.fullName === 'Pharmacist John' ? '456789' :
                     user.fullName === 'Volunteer Mike' ? '567890' : '••••••'}
                  </td>
                )}
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    user.isActive === 1
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {user.isActive === 1 ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  <div className="flex space-x-2">
                    <button
                      onClick={() => startEdit(user)}
                      disabled={user.adminPermanent && !currentUser?.adminPermanent}
                      className="text-blue-600 hover:text-blue-800"
                      title={user.adminPermanent && !currentUser?.adminPermanent ? 'Cannot edit permanent admin' : 'Edit user'}
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => toggleUserStatus(user)}
                      className={`${user.isActive === 1 ? 'text-red-600 hover:text-red-800' : 'text-green-600 hover:text-green-800'} ${
                        (user.id === currentUser?.id || user.adminPermanent) ? 'opacity-50 cursor-not-allowed' : ''
                      }`}
                      disabled={user.id === currentUser?.id || user.adminPermanent}
                      title={
                        user.id === currentUser?.id ? 'Cannot deactivate your own account' :
                        user.adminPermanent ? 'Cannot deactivate permanent admin' :
                        user.isActive === 1 ? 'Deactivate user' : 'Activate user'
                      }
                    >
                      {user.isActive === 1 ? 'Deactivate' : 'Activate'}
                    </button>
                    {user.id !== currentUser?.id && !user.adminPermanent && (
                      <button
                        onClick={() => deleteUser(user)}
                        className="text-red-600 hover:text-red-800"
                        title="Delete user"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}