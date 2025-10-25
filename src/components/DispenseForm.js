import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import { formatNigerianDate } from '@/utils/dateFormat';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { db, generateId, createAuditLog } from '@/db';
import { useAuthStore } from '@/stores/auth';
import { BeakerIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
const dispenseSchema = z.object({
    itemName: z.string().min(1, 'Medication name is required'),
    qty: z.number().min(1, 'Quantity must be at least 1'),
    dosage: z.string().min(1, 'Dosage is required'),
    directions: z.string().min(1, 'Directions are required')
});
export function DispenseForm({ patientId, visitId, onSuccess, onCancel }) {
    const { t } = useTranslation();
    const { currentUser } = useAuthStore();
    const [loading, setLoading] = useState(false);
    const [inventory, setInventory] = useState([]);
    const [selectedItem, setSelectedItem] = useState(null);
    const [lowStockWarning, setLowStockWarning] = useState(false);
    const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm({
        resolver: zodResolver(dispenseSchema)
    });
    const watchedItemName = watch('itemName');
    const watchedQty = watch('qty');
    useEffect(() => {
        loadInventory();
    }, []);
    useEffect(() => {
        if (watchedItemName) {
            const item = inventory.find(i => i.itemName === watchedItemName);
            setSelectedItem(item || null);
            if (item && watchedQty) {
                const remainingStock = item.onHandQty - watchedQty;
                setLowStockWarning(remainingStock <= item.reorderThreshold);
            }
        }
    }, [watchedItemName, watchedQty, inventory]);
    const loadInventory = async () => {
        try {
            const items = await db.inventory.orderBy('itemName').toArray();
            setInventory(items);
        }
        catch (error) {
            console.error('Error loading inventory:', error);
        }
    };
    const onSubmit = async (data) => {
        if (!selectedItem) {
            alert('Please select a valid medication from inventory');
            return;
        }
        if (data.qty > selectedItem.onHandQty) {
            alert(`Insufficient stock. Available: ${selectedItem.onHandQty}`);
            return;
        }
        setLoading(true);
        try {
            // Create dispense record
            const dispense = {
                id: generateId(),
                patientId,
                visitId,
                itemName: data.itemName || '',
                qty: data.qty || 0,
                dosage: data.dosage || '',
                directions: data.directions || '',
                dispensedBy: currentUser?.fullName || 'Unknown',
                dispensedAt: new Date()
            };
            await db.dispenses.add(dispense);
            // Update inventory
            const newQty = selectedItem.onHandQty - data.qty;
            await db.inventory.update(selectedItem.id, {
                onHandQty: newQty,
                updatedAt: new Date()
            });
            await createAuditLog(currentUser?.role || 'unknown', 'dispense', 'medication', dispense.id);
            onSuccess?.();
        }
        catch (error) {
            console.error('Error dispensing medication:', error);
        }
        finally {
            setLoading(false);
        }
    };
    return (_jsx("div", { className: "max-w-2xl mx-auto", children: _jsxs("div", { className: "card", children: [_jsxs("div", { className: "flex items-center space-x-3 mb-6", children: [_jsx(BeakerIcon, { className: "h-8 w-8 text-primary" }), _jsx("h2", { className: "text-2xl font-bold text-gray-900", children: "Dispense Medication" })] }), _jsxs("form", { onSubmit: handleSubmit(onSubmit), className: "space-y-6", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Medication *" }), _jsxs("select", { ...register('itemName'), className: "input-field", onChange: (e) => {
                                        setValue('itemName', e.target.value);
                                    }, children: [_jsx("option", { value: "", children: "Select medication" }), inventory.map((item) => (_jsxs("option", { value: item.itemName, children: [item.itemName, " (Available: ", item.onHandQty, " ", item.unit, ")"] }, item.id)))] }), errors.itemName && (_jsx("p", { className: "text-red-600 text-sm mt-1", children: errors.itemName.message }))] }), selectedItem && (_jsx("div", { className: "bg-blue-50 p-4 rounded-lg", children: _jsxs("div", { className: "flex justify-between items-center", children: [_jsxs("div", { children: [_jsxs("p", { className: "text-sm font-medium text-blue-800", children: ["Available Stock: ", selectedItem.onHandQty, " ", selectedItem.unit] }), _jsxs("p", { className: "text-xs text-blue-600", children: ["Reorder threshold: ", selectedItem.reorderThreshold] })] }), selectedItem.onHandQty <= selectedItem.reorderThreshold && (_jsxs("div", { className: "flex items-center text-orange-600", children: [_jsx(ExclamationTriangleIcon, { className: "h-5 w-5 mr-1" }), _jsx("span", { className: "text-sm font-medium", children: "Low Stock" })] }))] }) })), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Quantity to Dispense *" }), _jsx("input", { ...register('qty', { valueAsNumber: true }), type: "number", min: "1", max: selectedItem?.onHandQty || 999, className: "input-field", placeholder: "Enter quantity" }), errors.qty && (_jsx("p", { className: "text-red-600 text-sm mt-1", children: errors.qty.message }))] }), lowStockWarning && (_jsx("div", { className: "bg-yellow-50 border border-yellow-200 rounded-lg p-4", children: _jsxs("div", { className: "flex items-center", children: [_jsx(ExclamationTriangleIcon, { className: "h-5 w-5 text-yellow-600 mr-2" }), _jsxs("p", { className: "text-sm text-yellow-800", children: [_jsx("strong", { children: "Warning:" }), " This dispense will bring stock below reorder threshold."] })] }) })), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Dosage *" }), _jsx("input", { ...register('dosage'), className: "input-field", placeholder: "e.g., 500mg, 10ml, 1 tablet" }), errors.dosage && (_jsx("p", { className: "text-red-600 text-sm mt-1", children: errors.dosage.message }))] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Directions for Use *" }), _jsx("textarea", { ...register('directions'), rows: 3, className: "input-field", placeholder: "e.g., Take 1 tablet twice daily with food for 7 days" }), errors.directions && (_jsx("p", { className: "text-red-600 text-sm mt-1", children: errors.directions.message }))] }), _jsxs("div", { className: "bg-gray-50 p-4 rounded-lg", children: [_jsxs("p", { className: "text-sm text-gray-600", children: [_jsx("strong", { children: "Dispensed by:" }), " ", currentUser?.fullName || 'Unknown'] }), _jsxs("p", { className: "text-sm text-gray-600", children: [_jsx("strong", { children: "Date:" }), " ", formatNigerianDate(new Date())] })] }), _jsxs("div", { className: "flex space-x-4 pt-6", children: [_jsx("button", { type: "submit", disabled: loading || !selectedItem, className: "btn-primary flex-1", children: loading ? 'Dispensing...' : 'Dispense Medication' }), onCancel && (_jsx("button", { type: "button", onClick: onCancel, className: "btn-secondary flex-1", children: "Cancel" }))] })] })] }) }));
}
