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
    pin: ''
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

    setLoading(true)
    try {
      const salt = newSaltB64()
      const pinHash = await derivePinHash(formData.pin, salt)
      
      if (editingUser) {
        // Update existing user
        await db.users.update(editingUser.id, {
          fullName: formData.fullName,
          role: formData.role,
          email: formData.email || undefined,
          phone: formData.phone || undefined,
          pinHash,
          pinSalt: salt,
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
          isActive: true,
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
      pin: ''
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
      pin: '' // Don't pre-fill PIN for security
    })
    setEditingUser(user)
    setShowAddForm(true)
  }

  const toggleUserStatus = async (user: User) => {
    if (user.id === currentUser?.id) {
      alert('Cannot deactivate your own account')
      return
    }
    
    try {
      await db.users.update(user.id, {
        isActive: !user.isActive,
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
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                  <div>{user.email}</div>
                  <div>{user.phone}</div>
                </td>
                {showPins && (
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-600">
                    {/* Show test PINs for seeded users */}
                    {user.id.includes('admin') ? '123456' :
                     user.id.includes('doc') ? '234567' :
                     user.id.includes('nurse') ? '345678' :
                     user.id.includes('pharm') ? '456789' :
                     user.id.includes('vol') ? '567890' : '••••••'}
                  </td>
                )}
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    user.isActive 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {user.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  <div className="flex space-x-2">
                    <button
                      onClick={() => startEdit(user)}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => toggleUserStatus(user)}
                      className={user.isActive ? 'text-red-600 hover:text-red-800' : 'text-green-600 hover:text-green-800'}
                      disabled={user.id === currentUser?.id}
                    >
                      {user.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    {user.id !== currentUser?.id && (
                      <button
                        onClick={() => deleteUser(user)}
                        className="text-red-600 hover:text-red-800"
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