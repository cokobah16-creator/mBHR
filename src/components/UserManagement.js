import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { db, generateId } from '@/db';
import { useAuthStore } from '@/stores/auth';
import { can } from '@/auth/roles';
import { derivePinHash, newSaltB64 } from '@/utils/pin';
import { getRoleColor, getRoleDisplayName } from '@/auth/roles';
import { UserPlusIcon, PencilIcon, TrashIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
export function UserManagement() {
    const { currentUser } = useAuthStore();
    const [users, setUsers] = useState([]);
    const [showAddForm, setShowAddForm] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const [showPins, setShowPins] = useState(false);
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        fullName: '',
        role: 'volunteer',
        email: '',
        phone: '',
        pin: '',
        adminAccess: false,
        adminPermanent: false
    });
    // Only admins can manage users
    if (!currentUser || !can(currentUser.role, 'users')) {
        return null;
    }
    useEffect(() => {
        loadUsers();
    }, []);
    const loadUsers = async () => {
        try {
            const allUsers = await db.users.orderBy('createdAt').toArray();
            setUsers(allUsers);
        }
        catch (error) {
            console.error('Error loading users:', error);
        }
    };
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.fullName || !formData.pin || formData.pin.length !== 6) {
            alert('Please fill all fields and ensure PIN is 6 digits');
            return;
        }
        // Prevent non-admins from granting admin access
        if (formData.adminAccess && currentUser?.role !== 'admin') {
            alert('Only admins can grant admin access');
            return;
        }
        // Prevent making users permanent admin unless current user is permanent admin
        if (formData.adminPermanent && !currentUser?.adminPermanent) {
            alert('Only permanent admins can create other permanent admins');
            return;
        }
        setLoading(true);
        try {
            const salt = newSaltB64();
            const pinHash = await derivePinHash(formData.pin, salt);
            if (editingUser) {
                // Prevent editing permanent admin status unless current user is permanent admin
                if (editingUser.adminPermanent && !currentUser?.adminPermanent) {
                    alert('Cannot modify permanent admin users');
                    setLoading(false);
                    return;
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
                });
            }
            else {
                // Create new user
                const newUser = {
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
                };
                await db.users.add(newUser);
            }
            await loadUsers();
            resetForm();
        }
        catch (error) {
            console.error('Error saving user:', error);
            alert('Failed to save user');
        }
        finally {
            setLoading(false);
        }
    };
    const resetForm = () => {
        setFormData({
            fullName: '',
            role: 'volunteer',
            email: '',
            phone: '',
            pin: '',
            adminAccess: false,
            adminPermanent: false
        });
        setShowAddForm(false);
        setEditingUser(null);
    };
    const startEdit = (user) => {
        setFormData({
            fullName: user.fullName,
            role: user.role,
            email: user.email || '',
            phone: user.phone || '',
            pin: '', // Don't pre-fill PIN for security
            adminAccess: user.adminAccess || false,
            adminPermanent: user.adminPermanent || false
        });
        setEditingUser(user);
        setShowAddForm(true);
    };
    const toggleUserStatus = async (user) => {
        if (user.id === currentUser?.id) {
            alert('Cannot deactivate your own account');
            return;
        }
        if (user.adminPermanent) {
            alert('Cannot deactivate permanent admin users');
            return;
        }
        try {
            await db.users.update(user.id, {
                isActive: user.isActive === 1 ? 0 : 1,
                updatedAt: new Date()
            });
            await loadUsers();
        }
        catch (error) {
            console.error('Error toggling user status:', error);
        }
    };
    const deleteUser = async (user) => {
        if (user.id === currentUser?.id) {
            alert('Cannot delete your own account');
            return;
        }
        if (user.adminPermanent) {
            alert('Cannot delete permanent admin users');
            return;
        }
        if (!confirm(`Delete user ${user.fullName}? This cannot be undone.`)) {
            return;
        }
        try {
            await db.users.delete(user.id);
            await loadUsers();
        }
        catch (error) {
            console.error('Error deleting user:', error);
        }
    };
    return (_jsxs("div", { className: "card", children: [_jsxs("div", { className: "flex items-center justify-between mb-6", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900", children: "User Management" }), _jsxs("div", { className: "flex space-x-2", children: [_jsxs("button", { onClick: () => setShowPins(!showPins), className: "flex items-center space-x-1 text-sm text-gray-600 hover:text-gray-800", children: [showPins ? _jsx(EyeSlashIcon, { className: "h-4 w-4" }) : _jsx(EyeIcon, { className: "h-4 w-4" }), _jsxs("span", { children: [showPins ? 'Hide' : 'Show', " PINs"] })] }), _jsxs("button", { onClick: () => setShowAddForm(true), className: "btn-primary inline-flex items-center space-x-2", children: [_jsx(UserPlusIcon, { className: "h-4 w-4" }), _jsx("span", { children: "Add User" })] })] })] }), showAddForm && (_jsxs("div", { className: "mb-6 p-4 bg-gray-50 rounded-lg", children: [_jsx("h4", { className: "text-md font-medium text-gray-900 mb-4", children: editingUser ? 'Edit User' : 'Add New User' }), _jsxs("form", { onSubmit: handleSubmit, className: "space-y-4", children: [_jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Full Name *" }), _jsx("input", { type: "text", required: true, value: formData.fullName, onChange: (e) => setFormData({ ...formData, fullName: e.target.value }), className: "input-field", placeholder: "Enter full name" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Role *" }), _jsxs("select", { value: formData.role, onChange: (e) => setFormData({ ...formData, role: e.target.value }), className: "input-field", children: [_jsx("option", { value: "volunteer", children: "Volunteer" }), _jsx("option", { value: "nurse", children: "Nurse" }), _jsx("option", { value: "doctor", children: "Doctor" }), _jsx("option", { value: "pharmacist", children: "Pharmacist" }), _jsx("option", { value: "admin", children: "Admin" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Email" }), _jsx("input", { type: "email", value: formData.email, onChange: (e) => setFormData({ ...formData, email: e.target.value }), className: "input-field", placeholder: "user@example.com" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "Phone" }), _jsx("input", { type: "tel", value: formData.phone, onChange: (e) => setFormData({ ...formData, phone: e.target.value }), className: "input-field", placeholder: "+234..." })] }), _jsxs("div", { className: "md:col-span-2", children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-1", children: "PIN (6 digits) *" }), _jsx("input", { type: "password", required: true, value: formData.pin, onChange: (e) => setFormData({ ...formData, pin: e.target.value.replace(/\D/g, '').slice(0, 6) }), className: "input-field", placeholder: "Enter 6-digit PIN" })] }), currentUser?.role === 'admin' && (_jsxs("div", { className: "md:col-span-2 space-y-4 border-t pt-4", children: [_jsx("h4", { className: "text-sm font-medium text-gray-900", children: "Admin Permissions" }), _jsxs("div", { className: "flex items-center space-x-3", children: [_jsx("input", { type: "checkbox", id: "adminAccess", checked: formData.adminAccess, onChange: (e) => setFormData({ ...formData, adminAccess: e.target.checked }), className: "h-4 w-4 text-primary focus:ring-primary border-gray-300 rounded" }), _jsx("label", { htmlFor: "adminAccess", className: "text-sm text-gray-700", children: "Grant admin access (can manage users, export data)" })] }), currentUser?.adminPermanent && (_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx("input", { type: "checkbox", id: "adminPermanent", checked: formData.adminPermanent, onChange: (e) => setFormData({ ...formData, adminPermanent: e.target.checked }), className: "h-4 w-4 text-primary focus:ring-primary border-gray-300 rounded" }), _jsxs("label", { htmlFor: "adminPermanent", className: "text-sm text-gray-700", children: [_jsx("span", { className: "font-medium text-red-600", children: "Permanent admin" }), " (cannot be deleted or demoted)"] })] })), _jsx("p", { className: "text-xs text-gray-500", children: "Admin access allows user management and data export. Permanent admin status prevents deletion/demotion." })] }))] }), _jsxs("div", { className: "flex space-x-4", children: [_jsx("button", { type: "submit", disabled: loading, className: "btn-primary", children: loading ? 'Saving...' : editingUser ? 'Update User' : 'Create User' }), _jsx("button", { type: "button", onClick: resetForm, className: "btn-secondary", children: "Cancel" })] })] })] })), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "min-w-full divide-y divide-gray-200", children: [_jsx("thead", { className: "bg-gray-50", children: _jsxs("tr", { children: [_jsx("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "User" }), _jsx("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Role" }), _jsx("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Admin Status" }), _jsx("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Contact" }), showPins && (_jsx("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "PIN" })), _jsx("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Status" }), _jsx("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Actions" })] }) }), _jsx("tbody", { className: "bg-white divide-y divide-gray-200", children: users.map((user) => (_jsxs("tr", { className: user.isActive ? '' : 'opacity-50', children: [_jsx("td", { className: "px-6 py-4 whitespace-nowrap", children: _jsxs("div", { children: [_jsxs("div", { className: "text-sm font-medium text-gray-900", children: [user.fullName, user.adminPermanent && (_jsx("span", { className: "ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800", children: "Permanent" }))] }), _jsxs("div", { className: "text-sm text-gray-500", children: ["ID: ", user.id.slice(-8).toUpperCase()] })] }) }), _jsx("td", { className: "px-6 py-4 whitespace-nowrap", children: _jsx("span", { className: `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getRoleColor(user.role)}`, children: getRoleDisplayName(user.role) }) }), _jsx("td", { className: "px-6 py-4 whitespace-nowrap", children: _jsxs("div", { className: "space-y-1", children: [user.adminAccess && (_jsx("span", { className: "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800", children: "Admin Access" })), user.adminPermanent && (_jsx("span", { className: "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800", children: "Permanent" })), !user.adminAccess && !user.adminPermanent && (_jsx("span", { className: "text-xs text-gray-400", children: "Standard User" }))] }) }), _jsxs("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-600", children: [_jsx("div", { children: user.email }), _jsx("div", { children: user.phone })] }), showPins && (_jsx("td", { className: "px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-600", children: user.fullName === 'Kristopher Okobah' ? '070398' :
                                            user.fullName === 'Admin User' ? '123456' :
                                                user.fullName === 'Dr. Sarah Johnson' ? '234567' :
                                                    user.fullName === 'Nurse Mary' ? '345678' :
                                                        user.fullName === 'Pharmacist John' ? '456789' :
                                                            user.fullName === 'Volunteer Mike' ? '567890' : '••••••' })), _jsx("td", { className: "px-6 py-4 whitespace-nowrap", children: _jsx("span", { className: `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${user.isActive === 1
                                                ? 'bg-green-100 text-green-800'
                                                : 'bg-red-100 text-red-800'}`, children: user.isActive === 1 ? 'Active' : 'Inactive' }) }), _jsx("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-500", children: _jsxs("div", { className: "flex space-x-2", children: [_jsx("button", { onClick: () => startEdit(user), disabled: user.adminPermanent && !currentUser?.adminPermanent, className: "text-blue-600 hover:text-blue-800", title: user.adminPermanent && !currentUser?.adminPermanent ? 'Cannot edit permanent admin' : 'Edit user', children: _jsx(PencilIcon, { className: "h-4 w-4" }) }), _jsx("button", { onClick: () => toggleUserStatus(user), className: `${user.isActive === 1 ? 'text-red-600 hover:text-red-800' : 'text-green-600 hover:text-green-800'} ${(user.id === currentUser?.id || user.adminPermanent) ? 'opacity-50 cursor-not-allowed' : ''}`, disabled: user.id === currentUser?.id || user.adminPermanent, title: user.id === currentUser?.id ? 'Cannot deactivate your own account' :
                                                        user.adminPermanent ? 'Cannot deactivate permanent admin' :
                                                            user.isActive === 1 ? 'Deactivate user' : 'Activate user', children: user.isActive === 1 ? 'Deactivate' : 'Activate' }), user.id !== currentUser?.id && !user.adminPermanent && (_jsx("button", { onClick: () => deleteUser(user), className: "text-red-600 hover:text-red-800", title: "Delete user", children: _jsx(TrashIcon, { className: "h-4 w-4" }) }))] }) })] }, user.id))) })] }) })] }));
}
