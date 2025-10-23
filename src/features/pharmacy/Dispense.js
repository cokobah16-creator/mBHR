import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { db as mbhrDb, ulid } from '@/db/mbhr';
import { BeakerIcon, ExclamationTriangleIcon, CheckCircleIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
export default function Dispense() {
    const [rx, setRx] = useState([]);
    const [batches, setBatches] = useState([]);
    const [items, setItems] = useState([]);
    const [selected, setSelected] = useState('');
    const [loading, setLoading] = useState(false);
    useEffect(() => {
        loadData();
    }, []);
    const loadData = async () => {
        try {
            const [rxData, batchesData, itemsData] = await Promise.all([
                mbhrDb.prescriptions.where('status').equals('open').toArray(),
                mbhrDb.pharmacy_batches.toArray(),
                mbhrDb.pharmacy_items.toArray()
            ]);
            setRx(rxData);
            setBatches(batchesData);
            setItems(itemsData);
        }
        catch (error) {
            console.error('Error loading dispense data:', error);
        }
    };
    const chosen = rx.find(r => r.id === selected);
    const chosenLine = chosen?.lines[0];
    const chosenItem = chosenLine ? items.find(i => i.id === chosenLine.itemId) : null;
    const availableBatches = useMemo(() => {
        if (!chosenLine)
            return [];
        return batches
            .filter(b => b.itemId === chosenLine.itemId && b.qtyOnHand > 0)
            .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)); // FEFO - First Expired, First Out
    }, [chosenLine, batches]);
    async function doDispense() {
        if (!chosen || !chosenLine || !chosenItem)
            return;
        const batch = availableBatches[0];
        if (!batch) {
            alert('❌ No available batches for this medication');
            return;
        }
        if (new Date(batch.expiryDate) < new Date()) {
            alert('❌ Selected batch has expired');
            return;
        }
        if (batch.qtyOnHand < chosenLine.qty) {
            alert(`❌ Insufficient stock. Available: ${batch.qtyOnHand}, Required: ${chosenLine.qty}`);
            return;
        }
        setLoading(true);
        try {
            const now = new Date().toISOString();
            await mbhrDb.transaction('rw', mbhrDb.pharmacy_batches, mbhrDb.dispenses, mbhrDb.pharmacy_items, mbhrDb.stock_moves_rx, mbhrDb.prescriptions, async () => {
                // Record dispense
                await mbhrDb.dispenses.add({
                    id: ulid(),
                    prescriptionId: chosen.id,
                    patientId: chosen.patientId,
                    itemId: chosenLine.itemId,
                    batchId: batch.id,
                    qty: chosenLine.qty,
                    dispensedBy: 'pharmacist-1', // In real app, use current user
                    dispensedAt: now
                });
                // Update batch quantity
                await mbhrDb.pharmacy_batches.update(batch.id, {
                    qtyOnHand: batch.qtyOnHand - chosenLine.qty
                });
                // Update item total quantity
                await mbhrDb.pharmacy_items.update(chosenItem.id, {
                    onHandQty: Math.max(0, chosenItem.onHandQty - chosenLine.qty),
                    updatedAt: now
                });
                // Record stock movement
                await mbhrDb.stock_moves_rx.add({
                    id: ulid(),
                    itemId: chosenLine.itemId,
                    batchId: batch.id,
                    qtyDelta: -chosenLine.qty,
                    reason: 'dispense',
                    createdAt: now
                });
                // Mark prescription as dispensed
                await mbhrDb.prescriptions.update(chosen.id, { status: 'dispensed' });
            });
            alert('✅ Medication dispensed successfully!');
            setSelected('');
            await loadData(); // Refresh data
        }
        catch (error) {
            console.error('Error dispensing medication:', error);
            alert('❌ Failed to dispense medication');
        }
        finally {
            setLoading(false);
        }
    }
    return (_jsxs("div", { className: "p-4 space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(BeakerIcon, { className: "h-8 w-8 text-primary" }), _jsx("h2", { className: "text-2xl font-bold text-gray-900", children: "Dispense Medication" })] }), _jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-2 gap-6", children: [_jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Open Prescriptions" }), rx.length === 0 ? (_jsxs("div", { className: "text-center py-8 text-gray-500", children: [_jsx(DocumentTextIcon, { className: "h-12 w-12 mx-auto mb-4 opacity-50" }), _jsx("p", { children: "No open prescriptions" })] })) : (_jsx("div", { className: "space-y-3", children: rx.map(r => {
                                    const line = r.lines[0];
                                    const item = items.find(i => i.id === line?.itemId);
                                    return (_jsx("div", { className: `p-3 border rounded-lg cursor-pointer transition-colors ${selected === r.id
                                            ? 'border-primary bg-primary/5'
                                            : 'border-gray-200 hover:border-gray-300'}`, onClick: () => setSelected(r.id), children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsxs("div", { className: "font-medium text-gray-900", children: ["Rx #", r.id.slice(-6)] }), _jsxs("div", { className: "text-sm text-gray-600", children: [item?.medName, " ", item?.strength, " \u00D7 ", line?.qty] }), _jsxs("div", { className: "text-xs text-gray-500", children: [line?.dosage, " \u2022 ", line?.frequency] })] }), selected === r.id && (_jsx(CheckCircleIcon, { className: "h-5 w-5 text-primary" }))] }) }, r.id));
                                }) }))] }), _jsxs("div", { className: "card", children: [_jsx("h3", { className: "text-lg font-semibold text-gray-900 mb-4", children: "Dispense Details" }), !chosen ? (_jsx("div", { className: "text-center py-8 text-gray-500", children: _jsx("p", { children: "Select a prescription to dispense" }) })) : (_jsxs("div", { className: "space-y-4", children: [_jsx("div", { className: "bg-gray-50 p-4 rounded-lg", children: _jsxs("div", { className: "grid grid-cols-2 gap-4 text-sm", children: [_jsxs("div", { children: [_jsx("span", { className: "font-medium", children: "Patient:" }), " ", chosen.patientId] }), _jsxs("div", { children: [_jsx("span", { className: "font-medium", children: "Prescriber:" }), " ", chosen.prescriberId] }), _jsxs("div", { children: [_jsx("span", { className: "font-medium", children: "Medication:" }), " ", chosenItem?.medName, " ", chosenItem?.strength] }), _jsxs("div", { children: [_jsx("span", { className: "font-medium", children: "Quantity:" }), " ", chosenLine?.qty, " ", chosenItem?.unit] })] }) }), _jsxs("div", { children: [_jsx("h4", { className: "font-medium text-gray-900 mb-2", children: "Available Batches (FEFO)" }), availableBatches.length === 0 ? (_jsx("div", { className: "bg-red-50 border border-red-200 rounded-lg p-3", children: _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(ExclamationTriangleIcon, { className: "h-5 w-5 text-red-600" }), _jsx("span", { className: "text-sm text-red-800", children: "No available batches" })] }) })) : (_jsx("div", { className: "space-y-2", children: availableBatches.slice(0, 3).map((batch, index) => {
                                                    const isExpired = new Date(batch.expiryDate) < new Date();
                                                    const isExpiringSoon = new Date(batch.expiryDate) < new Date(Date.now() + 6 * 30 * 24 * 60 * 60 * 1000);
                                                    return (_jsx("div", { className: `p-3 border rounded-lg ${index === 0 ? 'border-green-200 bg-green-50' : 'border-gray-200'}`, children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsxs("div", { className: "text-sm font-medium", children: ["Lot: ", batch.lotNumber, index === 0 && _jsx("span", { className: "ml-2 text-green-600", children: "(Next to dispense)" })] }), _jsxs("div", { className: "text-xs text-gray-600", children: ["Expires: ", new Date(batch.expiryDate).toLocaleDateString(), " \u2022 Available: ", batch.qtyOnHand] })] }), _jsxs("div", { className: "flex flex-col space-y-1", children: [isExpired && (_jsx("span", { className: "px-2 py-1 bg-red-100 text-red-800 text-xs rounded-full", children: "Expired" })), !isExpired && isExpiringSoon && (_jsx("span", { className: "px-2 py-1 bg-yellow-100 text-yellow-800 text-xs rounded-full", children: "Expiring Soon" }))] })] }) }, batch.id));
                                                }) }))] }), _jsx("div", { className: "pt-4 border-t", children: _jsx("button", { className: "btn-primary w-full", disabled: !selected || availableBatches.length === 0 || loading, onClick: doDispense, children: loading ? 'Dispensing...' : 'Dispense Medication' }) })] }))] })] })] }));
}
