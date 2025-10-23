import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useT } from '@/hooks/useT';
import { db } from '@/db';
import { getMessageService } from '@/services/messaging';
import { BeakerIcon, ExclamationTriangleIcon, ClockIcon, CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
export default function FEFODispenser({ patientId, visitId, onSuccess, onCancel }) {
    const { t } = useT();
    const [medications, setMedications] = useState([]);
    const [batches, setBatches] = useState([]);
    const [selectedMedication, setSelectedMedication] = useState('');
    const [requestedQty, setRequestedQty] = useState(1);
    const [allocation, setAllocation] = useState([]);
    const [dosage, setDosage] = useState('');
    const [directions, setDirections] = useState('');
    const [loading, setLoading] = useState(false);
    useEffect(() => {
        loadMedications();
    }, []);
    useEffect(() => {
        if (selectedMedication) {
            loadBatchesForMedication(selectedMedication);
        }
    }, [selectedMedication]);
    useEffect(() => {
        if (selectedMedication && requestedQty > 0) {
            calculateFEFOAllocation();
        }
    }, [selectedMedication, requestedQty, batches]);
    const loadMedications = async () => {
        try {
            const items = await db.inventory.where('onHandQty').above(0).toArray();
            setMedications(items);
        }
        catch (error) {
            console.error('Error loading medications:', error);
        }
    };
    const loadBatchesForMedication = async (medicationId) => {
        try {
            const stockBatches = await db.stockBatches
                .where('drugId')
                .equals(medicationId)
                .and(batch => batch.qtyOnHand > 0)
                .toArray();
            setBatches(stockBatches);
        }
        catch (error) {
            console.error('Error loading batches:', error);
            setBatches([]);
        }
    };
    const calculateFEFOAllocation = () => {
        if (!batches.length || requestedQty <= 0) {
            setAllocation([]);
            return;
        }
        // Sort by expiry date (First Expired, First Out)
        const sortedBatches = [...batches].sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());
        const allocations = [];
        let remaining = requestedQty;
        for (const batch of sortedBatches) {
            if (remaining <= 0)
                break;
            const allocateQty = Math.min(batch.qtyOnHand, remaining);
            allocations.push({
                batchId: batch.id,
                lotNumber: batch.lotNumber,
                qty: allocateQty,
                expiryDate: batch.expiryDate
            });
            remaining -= allocateQty;
        }
        setAllocation(allocations);
    };
    const getExpiryStatus = (expiryDate) => {
        const now = new Date();
        const expiry = new Date(expiryDate);
        const daysUntilExpiry = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysUntilExpiry < 0) {
            return { status: 'expired', color: 'text-red-600 bg-red-50', icon: XCircleIcon };
        }
        else if (daysUntilExpiry <= 30) {
            return { status: 'expiring', color: 'text-yellow-600 bg-yellow-50', icon: ExclamationTriangleIcon };
        }
        else if (daysUntilExpiry <= 90) {
            return { status: 'warning', color: 'text-orange-600 bg-orange-50', icon: ClockIcon };
        }
        else {
            return { status: 'good', color: 'text-green-600 bg-green-50', icon: CheckCircleIcon };
        }
    };
    const canDispense = () => {
        return selectedMedication &&
            requestedQty > 0 &&
            allocation.length > 0 &&
            allocation.reduce((sum, a) => sum + a.qty, 0) >= requestedQty &&
            dosage.trim() &&
            directions.trim();
    };
    const handleDispense = async () => {
        if (!canDispense())
            return;
        setLoading(true);
        try {
            const medication = medications.find(m => m.id === selectedMedication);
            if (!medication)
                throw new Error('Medication not found');
            // Create dispense record
            const dispense = {
                id: crypto.randomUUID(),
                patientId,
                visitId,
                itemName: medication.itemName,
                qty: requestedQty,
                dosage,
                directions,
                dispensedBy: 'Pharmacist', // In real app, use current user
                dispensedAt: new Date(),
                _dirty: 1
            };
            await db.dispenses.add(dispense);
            // Update batch quantities
            for (const alloc of allocation) {
                const batch = batches.find(b => b.id === alloc.batchId);
                if (batch) {
                    await db.stockBatches.update(alloc.batchId, {
                        qtyOnHand: batch.qtyOnHand - alloc.qty
                    });
                }
            }
            // Update total inventory
            await db.inventory.update(selectedMedication, {
                onHandQty: medication.onHandQty - requestedQty,
                updatedAt: new Date()
            });
            // Queue medication reminder for tomorrow
            try {
                const messageService = getMessageService();
                const reminderDate = new Date();
                reminderDate.setDate(reminderDate.getDate() + 1);
                reminderDate.setHours(9, 0, 0, 0); // 9 AM tomorrow
                await messageService.queueMedicationReminder(patientId, medication.itemName, dosage, directions, reminderDate);
            }
            catch (error) {
                console.warn('Failed to queue reminder:', error);
            }
            onSuccess?.();
        }
        catch (error) {
            console.error('Error dispensing medication:', error);
            alert('Failed to dispense medication');
        }
        finally {
            setLoading(false);
        }
    };
    const totalAvailable = allocation.reduce((sum, a) => sum + a.qty, 0);
    const isShortfall = totalAvailable < requestedQty;
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(BeakerIcon, { className: "h-8 w-8 text-primary" }), _jsxs("div", { children: [_jsx("h2", { className: "text-2xl font-bold text-gray-900", children: "FEFO Medication Dispense" }), _jsx("p", { className: "text-gray-600", children: "First Expired, First Out - automatic batch selection" })] })] }), _jsx("div", { className: "card", children: _jsxs("div", { className: "space-y-6", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-lg font-medium text-gray-700 mb-3", children: "Medication *" }), _jsxs("select", { value: selectedMedication, onChange: (e) => setSelectedMedication(e.target.value), className: "input-field text-lg", children: [_jsx("option", { value: "", children: "Select medication" }), medications.map((med) => (_jsxs("option", { value: med.id, children: [med.itemName, " (", med.onHandQty, " ", med.unit, " available)"] }, med.id)))] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-lg font-medium text-gray-700 mb-3", children: "Quantity *" }), _jsxs("div", { className: "flex items-center space-x-4", children: [_jsx("button", { type: "button", onClick: () => setRequestedQty(Math.max(1, requestedQty - 1)), className: "w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center hover:bg-red-200 touch-target-large", children: _jsx("span", { className: "text-xl font-bold", children: "\u2212" }) }), _jsx("div", { className: "text-center", children: _jsx("input", { type: "number", value: requestedQty, onChange: (e) => setRequestedQty(Math.max(1, parseInt(e.target.value) || 1)), min: "1", className: "w-20 text-2xl font-bold text-center border-2 border-gray-300 rounded-lg py-2" }) }), _jsx("button", { type: "button", onClick: () => setRequestedQty(requestedQty + 1), className: "w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center hover:bg-green-200 touch-target-large", children: _jsx("span", { className: "text-xl font-bold", children: "+" }) })] })] }), allocation.length > 0 && (_jsxs("div", { children: [_jsx("h3", { className: "text-lg font-medium text-gray-700 mb-3", children: "Batch Allocation (FEFO Order)" }), isShortfall && (_jsx("div", { className: "bg-red-50 border border-red-200 rounded-lg p-4 mb-4", children: _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(ExclamationTriangleIcon, { className: "h-5 w-5 text-red-600" }), _jsxs("span", { className: "text-sm text-red-800", children: ["Insufficient stock: ", totalAvailable, " available, ", requestedQty, " requested"] })] }) })), _jsx("div", { className: "space-y-3", children: allocation.map((alloc, index) => {
                                        const expiryStatus = getExpiryStatus(alloc.expiryDate);
                                        const StatusIcon = expiryStatus.icon;
                                        return (_jsx("div", { className: "border rounded-lg p-4", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsxs("div", { className: "font-medium text-gray-900", children: ["Batch ", index + 1, ": ", alloc.lotNumber] }), _jsxs("div", { className: "text-sm text-gray-600", children: ["Quantity: ", alloc.qty, " \u2022 Expires: ", new Date(alloc.expiryDate).toLocaleDateString()] })] }), _jsxs("span", { className: `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${expiryStatus.color}`, children: [_jsx(StatusIcon, { className: "h-3 w-3 mr-1" }), expiryStatus.status] })] }) }, alloc.batchId));
                                    }) })] })), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-6", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-lg font-medium text-gray-700 mb-3", children: "Dosage *" }), _jsx("input", { type: "text", value: dosage, onChange: (e) => setDosage(e.target.value), className: "input-field text-lg", placeholder: "e.g., 1 tablet, 5ml" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-lg font-medium text-gray-700 mb-3", children: "Directions *" }), _jsx("textarea", { value: directions, onChange: (e) => setDirections(e.target.value), className: "input-field text-lg", rows: 3, placeholder: "Take twice daily with food" })] })] }), _jsxs("div", { className: "flex space-x-4 pt-6", children: [_jsx("button", { onClick: handleDispense, disabled: !canDispense() || loading || isShortfall, className: "btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed", children: loading ? 'Dispensing...' : 'Dispense & Set Reminder' }), onCancel && (_jsx("button", { onClick: onCancel, className: "btn-secondary", children: "Cancel" }))] })] }) })] }));
}
