import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { db as mbhrDb, ulid } from '@/db/mbhr';
import { DocumentTextIcon } from '@heroicons/react/24/outline';
export default function RxForm() {
    const [items, setItems] = useState([]);
    const [form, setForm] = useState({
        patientId: '',
        itemId: '',
        dosage: '',
        frequency: '',
        durationDays: 7,
        qty: 10,
        notes: ''
    });
    const [loading, setLoading] = useState(false);
    useEffect(() => {
        mbhrDb.pharmacy_items.orderBy('medName').toArray().then(setItems);
    }, []);
    async function save() {
        if (!form.itemId || !form.dosage || !form.frequency) {
            alert('Please fill in all required fields');
            return;
        }
        setLoading(true);
        try {
            const rxId = ulid();
            await mbhrDb.prescriptions.add({
                id: rxId,
                visitId: ulid(), // In real app, this would come from current visit
                patientId: form.patientId || 'demo-patient',
                prescriberId: 'doctor-1', // In real app, this would be current user
                createdAt: new Date().toISOString(),
                status: 'open',
                lines: [{
                        itemId: form.itemId,
                        dosage: form.dosage,
                        frequency: form.frequency,
                        durationDays: form.durationDays,
                        qty: form.qty,
                        notes: form.notes || undefined
                    }]
            });
            // Reset form
            setForm({
                patientId: '',
                itemId: '',
                dosage: '',
                frequency: '',
                durationDays: 7,
                qty: 10,
                notes: ''
            });
            alert('✅ Prescription saved successfully!');
        }
        catch (error) {
            console.error('Error saving prescription:', error);
            alert('Failed to save prescription');
        }
        finally {
            setLoading(false);
        }
    }
    const selectedItem = items.find(item => item.id === form.itemId);
    return (_jsxs("div", { className: "p-4 space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(DocumentTextIcon, { className: "h-8 w-8 text-primary" }), _jsx("h2", { className: "text-2xl font-bold text-gray-900", children: "New Prescription" })] }), _jsx("div", { className: "card max-w-2xl", children: _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Patient ID (Optional)" }), _jsx("input", { className: "input-field", placeholder: "Leave blank for demo patient", value: form.patientId, onChange: e => setForm({ ...form, patientId: e.target.value }) })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Medication *" }), _jsxs("select", { className: "input-field", value: form.itemId, onChange: e => setForm({ ...form, itemId: e.target.value }), children: [_jsx("option", { value: "", children: "Select medication\u2026" }), items.map((item) => (_jsxs("option", { value: item.id, children: [item.medName, " ", item.strength, " (", item.form, ") - ", item.onHandQty, " ", item.unit, " available"] }, item.id)))] })] }), selectedItem && selectedItem.onHandQty <= selectedItem.reorderThreshold && (_jsx("div", { className: "bg-yellow-50 border border-yellow-200 rounded-lg p-3", children: _jsxs("div", { className: "text-sm text-yellow-800", children: ["\u26A0\uFE0F ", _jsx("strong", { children: "Low Stock:" }), " Only ", selectedItem.onHandQty, " ", selectedItem.unit, " remaining"] }) })), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Dosage *" }), _jsx("input", { className: "input-field", placeholder: "e.g., 1 tablet, 5ml", value: form.dosage, onChange: e => setForm({ ...form, dosage: e.target.value }) })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Frequency *" }), _jsx("input", { className: "input-field", placeholder: "e.g., twice daily, q8h", value: form.frequency, onChange: e => setForm({ ...form, frequency: e.target.value }) })] })] }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Duration (days)" }), _jsx("input", { className: "input-field", type: "number", min: "1", max: "90", value: form.durationDays, onChange: e => setForm({ ...form, durationDays: Number(e.target.value) }) })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Total Quantity" }), _jsx("input", { className: "input-field", type: "number", min: "1", value: form.qty, onChange: e => setForm({ ...form, qty: Number(e.target.value) }) })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-gray-700 mb-2", children: "Special Instructions" }), _jsx("textarea", { className: "input-field", rows: 3, placeholder: "e.g., Take with food, avoid alcohol", value: form.notes, onChange: e => setForm({ ...form, notes: e.target.value }) })] }), _jsxs("div", { className: "flex space-x-4 pt-4", children: [_jsx("button", { className: "btn-primary flex-1", disabled: !form.itemId || !form.dosage || !form.frequency || loading, onClick: save, children: loading ? 'Saving...' : 'Save Prescription' }), _jsx("button", { className: "btn-secondary", onClick: () => setForm({
                                        patientId: '',
                                        itemId: '',
                                        dosage: '',
                                        frequency: '',
                                        durationDays: 7,
                                        qty: 10,
                                        notes: ''
                                    }), children: "Clear Form" })] })] }) })] }));
}
