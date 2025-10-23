import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { db, generateId } from '@/db';
import { useAuthStore } from '@/stores/auth';
import { CubeIcon, PlusIcon, ExclamationTriangleIcon, PencilIcon } from '@heroicons/react/24/outline';
export function Inventory() {
    const { currentUser } = useAuthStore();
    const [inventory, setInventory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddForm, setShowAddForm] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [formData, setFormData] = useState({
        itemName: '',
        unit: '',
        onHandQty: 0,
        reorderThreshold: 0
    });
    useEffect(() => {
        loadInventory();
    }, []);
    const loadInventory = async () => {
        try {
            console.log('Loading inventory...');
            const items = await db.inventory.orderBy('itemName').toArray();
            console.log('Loaded inventory items:', items.length);
            setInventory(items);
        }
        catch (error) {
            console.error('Error loading inventory:', error);
        }
        finally {
            setLoading(false);
        }
    };
    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            if (editingItem) {
                // Update existing item
                await db.inventory.update(editingItem.id, {
                    ...formData,
                    updatedAt: new Date()
                });
            }
            else {
                // Add new item
                const newItem = {
                    id: generateId(),
                    ...formData,
                    updatedAt: new Date()
                };
                await db.inventory.add(newItem);
            }
            await loadInventory();
            resetForm();
        }
        catch (error) {
            console.error('Error saving inventory item:', error);
            alert('Failed to save inventory item. Please try again.');
        }
    };
    const resetForm = () => {
        setFormData({
            itemName: '',
            unit: '',
            onHandQty: 0,
            reorderThreshold: 0
        });
        setShowAddForm(false);
        setEditingItem(null);
    };
    const startEdit = (item) => {
        setFormData({
            itemName: item.itemName,
            unit: item.unit,
            onHandQty: item.onHandQty,
            reorderThreshold: item.reorderThreshold
        });
        setEditingItem(item);
        setShowAddForm(true);
    };
    const lowStockItems = inventory.filter(item => item.onHandQty <= item.reorderThreshold);
    if (loading) {
        return (_jsx("div", { className: "flex items-center justify-center py-12", children: _jsxs("div", { className: "text-center", children: [_jsx("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" }), _jsx("p", { className: "mt-4 text-gray-600", children: "Loading inventory..." })] }) }));
    }
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(CubeIcon, { className: "h-8 w-8 text-primary" }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Inventory" }), _jsx("p", { className: "text-gray-600", children: "Manage medication and supply inventory" })] })] }), _jsxs("button", { onClick: () => setShowAddForm(true), className: "btn-primary inline-flex items-center space-x-2", children: [_jsx(PlusIcon, { className: "h-5 w-5" }), _jsx("span", { children: "Add Item" })] })] }), lowStockItems.length > 0 && (_jsxs("div", { className: "bg-yellow-50 border border-yellow-200 rounded-lg p-4", children: [_jsxs("div", { className: "flex items-center space-x-2 mb-2", children: [_jsx(ExclamationTriangleIcon, { className: "h-5 w-5 text-yellow-600" }), _jsxs("h3", { className: "text-sm font-medium text-yellow-800", children: ["Low Stock Alert (", lowStockItems.length, " items)"] })] }), _jsx("div", { className: "text-sm text-yellow-700", children: lowStockItems.map(item => item.itemName).join(', ') })] })), showAddForm && (_jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: editingItem ? 'Edit Item' : 'Add New Item' }), _jsxs("form", { onSubmit: handleSubmit, className: "space-y-4", children: [_jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Item Name *" }), _jsx("input", { type: "text", required: true, value: formData.itemName, onChange: (e) => setFormData({ ...formData, itemName: e.target.value }), className: "input-field", placeholder: "e.g., Paracetamol 500mg" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Unit *" }), _jsx("input", { type: "text", required: true, value: formData.unit, onChange: (e) => setFormData({ ...formData, unit: e.target.value }), className: "input-field", placeholder: "e.g., tablets, bottles, boxes" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Quantity on Hand *" }), _jsx("input", { type: "number", required: true, min: "0", value: formData.onHandQty, onChange: (e) => setFormData({ ...formData, onHandQty: parseInt(e.target.value) || 0 }), className: "input-field" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Reorder Threshold *" }), _jsx("input", { type: "number", required: true, min: "0", value: formData.reorderThreshold, onChange: (e) => setFormData({ ...formData, reorderThreshold: parseInt(e.target.value) || 0 }), className: "input-field" })] })] }), _jsxs("div", { className: "flex space-x-4", children: [_jsx("button", { type: "submit", className: "btn-primary", children: editingItem ? 'Update Item' : 'Add Item' }), _jsx("button", { type: "button", onClick: resetForm, className: "btn-secondary", children: "Cancel" })] })] })] })), _jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Current Inventory" }), inventory.length === 0 ? (_jsxs("div", { className: "text-center py-8", children: [_jsx(CubeIcon, { className: "h-12 w-12 mx-auto text-gray-400 mb-4" }), _jsx("h3", { className: "text-lg font-medium text-gray-900 mb-2", children: "No inventory items" }), _jsx("p", { className: "text-gray-600 mb-6", children: "Add your first inventory item to get started" }), _jsx("button", { onClick: () => setShowAddForm(true), className: "btn-primary", children: "Add First Item" })] })) : (_jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "min-w-full divide-y divide-gray-200", children: [_jsx("thead", { className: "bg-gray-50", children: _jsxs("tr", { children: [_jsx("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Item Name" }), _jsx("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Unit" }), _jsx("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "On Hand" }), _jsx("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Reorder At" }), _jsx("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Status" }), _jsx("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Actions" })] }) }), _jsx("tbody", { className: "bg-white divide-y divide-gray-200", children: inventory.map((item) => (_jsxs("tr", { className: "hover:bg-gray-50", children: [_jsx("td", { className: "px-6 py-4 whitespace-nowrap", children: _jsx("div", { className: "text-sm font-medium text-gray-900", children: item.itemName }) }), _jsx("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-600", children: item.unit }), _jsx("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-900", children: item.onHandQty }), _jsx("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-600", children: item.reorderThreshold }), _jsx("td", { className: "px-6 py-4 whitespace-nowrap", children: item.onHandQty <= item.reorderThreshold ? (_jsxs("span", { className: "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800", children: [_jsx(ExclamationTriangleIcon, { className: "h-3 w-3 mr-1" }), "Low Stock"] })) : (_jsx("span", { className: "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800", children: "In Stock" })) }), _jsx("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-500", children: _jsxs("button", { onClick: () => startEdit(item), className: "text-primary hover:text-primary/80 inline-flex items-center space-x-1", children: [_jsx(PencilIcon, { className: "h-4 w-4" }), _jsx("span", { children: "Edit" })] }) })] }, item.id))) })] }) }))] })] }));
}
