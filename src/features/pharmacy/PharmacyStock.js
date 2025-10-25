import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { formatNigerianDate } from '@/utils/dateFormat';
import { db as mbhrDb, ulid } from '@/db/mbhr';
import { useAuthStore } from '@/stores/auth';
import { can } from '@/auth/roles';
import { BeakerIcon, ExclamationTriangleIcon, PlusIcon, MagnifyingGlassIcon, TrashIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
export default function PharmacyStock() {
    const { currentUser } = useAuthStore();
    const [items, setItems] = useState([]);
    const [filteredItems, setFilteredItems] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [showAddItem, setShowAddItem] = useState(false);
    const [showAddBatch, setShowAddBatch] = useState(null);
    const [editingItem, setEditingItem] = useState(null);
    const [selectedItem, setSelectedItem] = useState(null);
    const [filterType, setFilterType] = useState('all');
    // Form states
    const [itemForm, setItemForm] = useState({
        medName: '',
        form: 'tablet',
        strength: '',
        unit: 'tablets',
        reorderThreshold: 50,
        isControlled: false
    });
    const [batchForm, setBatchForm] = useState({
        lotNumber: '',
        qtyOnHand: 0,
        expiryDate: '',
        supplier: ''
        // Only pharmacists and admins can access
        ,
        // Only pharmacists and admins can access
        if(, currentUser) { }
    } || !can(currentUser.role, 'dispense')), { return:  };
    (_jsxs("div", { className: "text-center py-12", children: [_jsx(ExclamationTriangleIcon, { className: "h-12 w-12 mx-auto text-gray-400 mb-4" }), _jsx("h3", { className: "text-lg font-medium text-gray-900 mb-2", children: "Access Restricted" }), _jsx("p", { className: "text-gray-600", children: "Only pharmacists and administrators can access pharmacy stock." })] }));
}
useEffect(() => {
    loadData();
}, []);
filterItems();
[items, searchQuery, filterType];
const loadData = async () => {
    setLoading(true);
    try {
        const [itemsData, batchesData] = await Promise.all([
            mbhrDb.pharmacy_items.orderBy('medName').toArray(),
            mbhrDb.pharmacy_batches.toArray()
        ]);
        const itemsWithBatches = itemsData.map(item => {
            const itemBatches = batchesData.filter(batch => batch.itemId === item.id);
            const now = new Date();
            const sixMonthsFromNow = new Date(now.getTime() + (6 * 30 * 24 * 60 * 60 * 1000));
            const expiredBatches = itemBatches.filter(batch => new Date(batch.expiryDate) < now).length;
            const expiringSoonBatches = itemBatches.filter(batch => {
                const expiryDate = new Date(batch.expiryDate);
                return expiryDate >= now && expiryDate <= sixMonthsFromNow;
            }).length;
            const earliestExpiry = itemBatches
                .filter(batch => batch.qtyOnHand > 0)
                .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime())[0]?.expiryDate;
            return {
                ...item,
                batches: itemBatches.sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()),
                totalBatches: itemBatches.length,
                earliestExpiry,
                expiredBatches,
                expiringSoonBatches
            };
        });
        setItems(itemsWithBatches);
    }
    catch (error) {
        console.error('Error loading pharmacy data:', error);
    }
    finally {
        setLoading(false);
    }
    const filterItems = () => {
        let filtered = items;
        // Apply search filter
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(item => item.medName.toLowerCase().includes(query) ||
                item.strength.toLowerCase().includes(query) ||
                item.form.toLowerCase().includes(query));
            // Apply type filter
            switch (filterType) {
                case 'low_stock':
                    filtered = filtered.filter(item => item.onHandQty <= item.reorderThreshold);
                    break;
                case 'expired':
                    filtered = filtered.filter(item => item.expiredBatches > 0);
                case 'expiring_soon':
                    filtered = filtered.filter(item => item.expiringSoonBatches > 0);
                    setFilteredItems(filtered);
                    const handleAddItem = async (e) => {
                        e.preventDefault();
                        if (!itemForm.medName.trim()) {
                            alert('Please enter medication name');
                            return;
                            const newItem = {
                                id: ulid(),
                                medName: itemForm.medName.trim(),
                                form: itemForm.form,
                                strength: itemForm.strength.trim(),
                                unit: itemForm.unit,
                                onHandQty: 0,
                                reorderThreshold: itemForm.reorderThreshold,
                                isControlled: itemForm.isControlled,
                                updatedAt: new Date().toISOString()
                            };
                            await mbhrDb.pharmacy_items.add(newItem);
                            await loadData();
                            setShowAddItem(false);
                            resetItemForm();
                            console.error('Error adding item:', error);
                            alert('Failed to add medication');
                            const handleAddBatch = async (e) => {
                                if (!showAddBatch || !batchForm.lotNumber.trim() || !batchForm.expiryDate || batchForm.qtyOnHand <= 0) {
                                    alert('Please fill all required fields');
                                    await mbhrDb.transaction('rw', mbhrDb.pharmacy_batches, mbhrDb.pharmacy_items, async () => {
                                        // Add batch
                                        await mbhrDb.pharmacy_batches.add({
                                            id: ulid(),
                                            itemId: showAddBatch,
                                            lotNumber: batchForm.lotNumber.trim(),
                                            expiryDate: batchForm.expiryDate,
                                            qtyOnHand: batchForm.qtyOnHand,
                                            receivedAt: new Date().toISOString(),
                                            supplier: batchForm.supplier.trim() || undefined
                                        });
                                        // Update item total quantity
                                        const item = await mbhrDb.pharmacy_items.get(showAddBatch);
                                        if (item) {
                                            await mbhrDb.pharmacy_items.update(showAddBatch, {
                                                onHandQty: item.onHandQty + batchForm.qtyOnHand,
                                                updatedAt: new Date().toISOString()
                                            });
                                            setShowAddBatch(null);
                                            resetBatchForm();
                                            console.error('Error adding batch:', error);
                                            alert('Failed to add batch');
                                            const handleDeleteItem = async (itemId) => {
                                                if (!confirm('Are you sure you want to delete this medication? This will also delete all associated batches.')) {
                                                    await mbhrDb.transaction('rw', mbhrDb.pharmacy_items, mbhrDb.pharmacy_batches, async () => {
                                                        await mbhrDb.pharmacy_batches.where('itemId').equals(itemId).delete();
                                                        await mbhrDb.pharmacy_items.delete(itemId);
                                                        console.error('Error deleting item:', error);
                                                        alert('Failed to delete medication');
                                                        const resetItemForm = () => {
                                                            setItemForm({
                                                                medName: '',
                                                                form: 'tablet',
                                                                strength: '',
                                                                unit: 'tablets',
                                                                reorderThreshold: 50,
                                                                isControlled: false
                                                            });
                                                            setEditingItem(null);
                                                            const resetBatchForm = () => {
                                                                setBatchForm({
                                                                    lotNumber: '',
                                                                    qtyOnHand: 0,
                                                                    expiryDate: '',
                                                                    supplier: '',
                                                                    const: getStockStatus = (item) => {
                                                                        if (item.onHandQty === 0) {
                                                                            return { label: 'Out of Stock', color: 'bg-red-100 text-red-800', icon: XCircleIcon };
                                                                            if (item.onHandQty <= item.reorderThreshold) {
                                                                                return { label: 'Low Stock', color: 'bg-yellow-100 text-yellow-800', icon: ExclamationTriangleIcon };
                                                                                return { label: 'In Stock', color: 'bg-green-100 text-green-800', icon: CheckCircleIcon };
                                                                                const getExpiryStatus = (expiryDate) => {
                                                                                    const now = new Date();
                                                                                    const expiry = new Date(expiryDate);
                                                                                    const sixMonthsFromNow = new Date(now.getTime() + (6 * 30 * 24 * 60 * 60 * 1000));
                                                                                    if (expiry < now) {
                                                                                        return { label: 'Expired', color: 'text-red-600 bg-red-50' };
                                                                                        if (expiry <= sixMonthsFromNow) {
                                                                                            return { label: 'Expiring Soon', color: 'text-yellow-600 bg-yellow-50' };
                                                                                            return { label: 'Good', color: 'text-green-600 bg-green-50' };
                                                                                            if (loading) {
                                                                                                _jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(BeakerIcon, { className: "h-8 w-8 text-primary" }), _jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-bold text-gray-900", children: "Pharmacy Stock" }), _jsx("p", { className: "text-gray-600", children: "Loading pharmaceutical inventory..." })] })] }), _jsxs("div", { className: "flex items-center justify-center py-12", children: [_jsx("div", { className: "animate-spin rounded-full h-12 w-12 border-b-2 border-primary" }), "return (", _jsx("div", { className: "space-y-6", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsx("p", { className: "text-gray-600", children: "Manage pharmaceutical inventory and batches" }), _jsxs("button", { onClick: () => setShowAddItem(true), className: "btn-primary inline-flex items-center space-x-2", children: [_jsx(PlusIcon, { className: "h-5 w-5" }), _jsx("span", { children: "Add Medication" })] }), _jsx("div", { className: "grid grid-cols-1 md:grid-cols-4 gap-4", children: _jsxs("div", { className: "card bg-blue-50 border-blue-200", children: [_jsx("div", { className: "text-sm text-blue-600", children: "Total Medications" }), _jsx("div", { className: "text-2xl font-bold text-blue-800", children: items.length }), _jsxs("div", { className: "card bg-yellow-50 border-yellow-200", children: [_jsx("div", { className: "text-sm text-yellow-600", children: "Low Stock Items" }), _jsxs("div", { className: "text-2xl font-bold text-yellow-800", children: [items.filter(item => item.onHandQty <= item.reorderThreshold).length, _jsxs("div", { className: "card bg-red-50 border-red-200", children: [_jsx("div", { className: "text-sm text-red-600", children: "Expired Batches" }), _jsxs("div", { className: "text-2xl font-bold text-red-800", children: [items.reduce((sum, item) => sum + item.expiredBatches, 0), _jsxs("div", { className: "card bg-orange-50 border-orange-200", children: [_jsx("div", { className: "text-sm text-orange-600", children: "Expiring Soon" }), _jsxs("div", { className: "text-2xl font-bold text-orange-800", children: [items.reduce((sum, item) => sum + item.expiringSoonBatches, 0), _jsx("div", { className: "card", children: _jsx("div", { className: "flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0", children: _jsxs("div", { className: "relative flex-1 max-w-md", children: [_jsx("div", { className: "absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none", children: _jsx(MagnifyingGlassIcon, { className: "h-5 w-5 text-gray-400" }) }), _jsx("input", { type: "text", value: searchQuery, onChange: (e) => setSearchQuery(e.target.value), className: "input-field pl-10", placeholder: "Search medications..." }), _jsxs("div", { className: "flex space-x-2", children: [[
                                                                                                                                                                                                                    { key: 'all', label: 'All Items' },
                                                                                                                                                                                                                    { key: 'low_stock', label: 'Low Stock' },
                                                                                                                                                                                                                    { key: 'expired', label: 'Expired' },
                                                                                                                                                                                                                    { key: 'expiring_soon', label: 'Expiring Soon' }
                                                                                                                                                                                                                ].map(filter => (_jsx("button", { onClick: () => setFilterType(filter.key), className: `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${filterType === filter.key
                                                                                                                                                                                                                        ? 'bg-primary text-white'
                                                                                                                                                                                                                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`, children: filter.label }, filter.key))), _jsx("div", { className: "overflow-x-auto", children: _jsx("table", { className: "min-w-full divide-y divide-gray-200", children: _jsx("thead", { className: "bg-gray-50", children: _jsxs("tr", { children: [_jsx("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Medication" }), _jsxs("th", { className: "px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider", children: ["Stock Status Batches Next Expiry", _jsx("th", { className: "px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Actions" })] }), _jsx("tbody", { className: "bg-white divide-y divide-gray-200", children: filteredItems.map((item) => {
                                                                                                                                                                                                                                            const status = getStockStatus(item);
                                                                                                                                                                                                                                            const StatusIcon = status.icon;
                                                                                                                                                                                                                                            return (_jsxs("tr", { className: "hover:bg-gray-50", children: [_jsx("td", { className: "px-6 py-4 whitespace-nowrap", children: _jsxs("div", { children: [_jsxs("div", { className: "text-sm font-medium text-gray-900", children: [item.medName, " ", item.strength] }), _jsxs("div", { className: "text-sm text-gray-500", children: [item.form, " \u2022 ", item.unit, item.isControlled && (_jsx("span", { className: "ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800", children: "Controlled" }))] })] }) }), _jsxs("td", { className: "px-6 py-4 whitespace-nowrap text-center", children: [_jsx("div", { className: "text-sm font-medium text-gray-900", children: item.onHandQty }), _jsxs("div", { className: "text-xs text-gray-500", children: ["Reorder at ", item.reorderThreshold] }), _jsxs("span", { className: `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${status.color}`, children: [_jsx(StatusIcon, { className: "h-3 w-3 mr-1" }), status.label] }), _jsx("div", { className: "text-sm text-gray-900", children: item.totalBatches }), (item.expiredBatches > 0 || item.expiringSoonBatches > 0) && (_jsxs("div", { className: "text-xs space-x-1", children: [item.expiredBatches > 0 && (_jsxs("span", { className: "text-red-600", children: [item.expiredBatches, " expired"] })), item.expiringSoonBatches > 0 && (_jsxs("span", { className: "text-yellow-600", children: [item.expiringSoonBatches, " expiring"] })), item.earliestExpiry ? (_jsxs("div", { children: [_jsx("div", { className: "text-sm text-gray-900", children: formatNigerianDate(item.earliestExpiry) }), _jsx("span", { className: `inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getExpiryStatus(item.earliestExpiry).color}`, children: getExpiryStatus(item.earliestExpiry).label }), ") : (", _jsx("span", { className: "text-gray-400", children: "\u2014" }), _jsxs("td", { className: "px-6 py-4 whitespace-nowrap text-right text-sm space-x-2", children: [_jsx("button", { onClick: () => setShowAddBatch(item.id), className: "text-primary hover:text-primary/80", title: "Add Batch", children: _jsx(PlusIcon, { className: "h-4 w-4" }) }), "onClick=", () => setSelectedItem(selectedItem === item.id ? null : item.id), "className=\"text-blue-600 hover:text-blue-800\" title=\"View Batches\"", _jsx(MagnifyingGlassIcon, { className: "h-4 w-4" }), "onClick=", () => handleDeleteItem(item.id), "className=\"text-red-600 hover:text-red-800\" title=\"Delete Item\"", _jsx(TrashIcon, { className: "h-4 w-4" })] }), ") })}"] }))
                                                                                                                                                                                                                                                                        :
                                                                                                                                                                                                                                                                ] })), filteredItems.length === 0 && (_jsxs("div", { className: "text-center py-12", children: [_jsx(BeakerIcon, { className: "h-12 w-12 mx-auto text-gray-400 mb-4" }), _jsx("h3", { className: "text-lg font-medium text-gray-900 mb-2", children: "No medications found" }), _jsx("p", { className: "text-gray-600", children: searchQuery ? 'Try adjusting your search terms' : 'Add your first medication to get started' }), ")}", selectedItem && (_jsxs("div", { className: "card", children: [_jsxs("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: ["Batch Details - ", items.find(i => i.id === selectedItem)?.medName] }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "min-w-full divide-y divide-gray-200", children: [_jsx("thead", { className: "bg-gray-50", children: _jsxs("tr", { children: [_jsx("th", { className: "px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Lot Number" }), _jsx("th", { className: "px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider", children: "Quantity Expiry Date Status Supplier" })] }) }), _jsx("tbody", { className: "bg-white divide-y divide-gray-200", children: items.find(i => i.id === selectedItem)?.batches.map((batch) => {
                                                                                                                                                                                                                                                                                                const expiryStatus = getExpiryStatus(batch.expiryDate);
                                                                                                                                                                                                                                                                                                return (_jsxs("tr", { children: [_jsx("td", { className: "px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900", children: batch.lotNumber }), _jsxs("td", { className: "px-6 py-4 whitespace-nowrap text-center text-sm text-gray-900", children: [batch.qtyOnHand, formatNigerianDate(batch.expiryDate), _jsxs("td", { className: "px-6 py-4 whitespace-nowrap text-center", children: [_jsx("span", { className: `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${expiryStatus.color}`, children: expiryStatus.label }), _jsx("td", { className: "px-6 py-4 whitespace-nowrap text-sm text-gray-500", children: batch.supplier || '—' }), ") })}"] })] }), ")}", showAddItem && (_jsx("div", { className: "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50", children: _jsxs("div", { className: "bg-white rounded-lg p-6 w-full max-w-md", children: [_jsx("h2", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Add New Medication" }), _jsxs("form", { onSubmit: handleAddItem, className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Medication Name *" }), _jsx("input", { type: "text", required: true, value: itemForm.medName, onChange: (e) => setItemForm({ ...itemForm, medName: e.target.value }), className: "input-field", placeholder: "e.g., Paracetamol" })] }), _jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Form" }), _jsxs("select", { value: itemForm.form, onChange: (e) => setItemForm({ ...itemForm, form: e.target.value }), className: "input-field", children: [_jsx("option", { value: "tablet", children: "Tablet" }), _jsx("option", { value: "capsule", children: "Capsule" }), _jsx("option", { value: "syrup", children: "Syrup" }), _jsx("option", { value: "injection", children: "Injection" }), _jsx("option", { value: "cream", children: "Cream" }), _jsx("option", { value: "drops", children: "Drops" })] })] }), "Strength", _jsx("input", { type: "text", value: itemForm.strength, onChange: (e) => setItemForm({ ...itemForm, strength: e.target.value }), placeholder: "e.g., 500mg" }), "Unit value=", itemForm.unit, "onChange=", (e) => setItemForm({ ...itemForm, unit: e.target.value }), _jsx("option", { value: "tablets", children: "Tablets" }), _jsx("option", { value: "capsules", children: "Capsules" }), _jsx("option", { value: "bottles", children: "Bottles" }), _jsx("option", { value: "vials", children: "Vials" }), _jsx("option", { value: "tubes", children: "Tubes" }), _jsx("option", { value: "boxes", children: "Boxes" }), "Reorder Threshold type=\"number\" min=\"0\" value=", itemForm.reorderThreshold, "onChange=", (e) => setItemForm({ ...itemForm, reorderThreshold: parseInt(e.target.value) || 0 }), _jsxs("div", { className: "flex items-center space-x-3", children: ["type=\"checkbox\" id=\"isControlled\" checked=", itemForm.isControlled, "onChange=", (e) => setItemForm({ ...itemForm, isControlled: e.target.checked }), "className=\"h-4 w-4 text-primary focus:ring-primary border-gray-300 rounded\"", _jsxs("label", { htmlFor: "isControlled", className: "text-sm text-gray-700", children: ["Controlled substance", _jsxs("div", { className: "flex space-x-4 pt-4", children: [_jsx("button", { type: "submit", className: "btn-primary flex-1", children: "Add Medication" }), _jsx("button", { type: "button", onClick: () => {
                                                                                                                                                                                                                                                                                                                                                                    setShowAddItem(false);
                                                                                                                                                                                                                                                                                                                                                                    resetItemForm();
                                                                                                                                                                                                                                                                                                                                                                }, className: "btn-secondary flex-1", children: "Cancel" }), showAddBatch && (_jsxs("h2", { className: "text-lg font-semibold text-gray-900 mb-4", children: ["Add New Batch - ", items.find(i => i.id === showAddBatch)?.medName] })
                                                                                                                                                                                                                                                                                                                                                                ,
                                                                                                                                                                                                                                                                                                                                                                    _jsxs("form", { onSubmit: handleAddBatch, className: "space-y-4", children: ["Lot Number * value=", batchForm.lotNumber, "onChange=", (e) => setBatchForm({ ...batchForm, lotNumber: e.target.value }), "placeholder=\"Batch/Lot number\" Quantity * type=\"number\" min=\"1\" value=", batchForm.qtyOnHand, "onChange=", (e) => setBatchForm({ ...batchForm, qtyOnHand: parseInt(e.target.value) || 0 }), "placeholder=\"Quantity received\" Expiry Date * type=\"date\" value=", batchForm.expiryDate, "onChange=", (e) => setBatchForm({ ...batchForm, expiryDate: e.target.value }), "Supplier value=", batchForm.supplier, "onChange=", (e) => setBatchForm({ ...batchForm, supplier: e.target.value }), "placeholder=\"Supplier name\" Add Batch setShowAddBatch(null) resetBatchForm()"] }))] })] })] })] })] })] }) }))] }, batch.id));
                                                                                                                                                                                                                                                                                            }) })] }) })] }))] }))] })] }, item.id));
                                                                                                                                                                                                                                        }) })] }) }) }) })] })] }) }) })] })] })] })] })] })] })] }) })] }) })] })] });
                                                                                            }
                                                                                        }
                                                                                    }
                                                                                };
                                                                            }
                                                                        }
                                                                    }
                                                                });
                                                            };
                                                        };
                                                    });
                                                }
                                            };
                                        }
                                    });
                                }
                            };
                        }
                    };
            }
        }
    };
};
