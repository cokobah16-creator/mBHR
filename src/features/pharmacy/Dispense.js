import { useEffect, useMemo, useState } from 'react';
import { formatNigerianDate } from '@/utils/dateFormat';
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
            if (new Date(batch.expiryDate) < new Date()) {
                alert('❌ Selected batch has expired');
                if (batch.qtyOnHand < chosenLine.qty) {
                    alert(`❌ Insufficient stock. Available: ${batch.qtyOnHand}, Required: ${chosenLine.qty}`);
                    setLoading(true);
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
                            // Update item total quantity
                            ,
                            // Update item total quantity
                            await: mbhrDb.pharmacy_items.update(chosenItem.id, {
                                onHandQty: Math.max(0, chosenItem.onHandQty - chosenLine.qty),
                                updatedAt: now
                                // Record stock movement
                                ,
                                // Record stock movement
                                await: mbhrDb.stock_moves_rx.add({
                                    id: ulid(),
                                    itemId: chosenLine.itemId,
                                    batchId: batch.id,
                                    qtyDelta: -chosenLine.qty,
                                    reason: 'dispense',
                                    createdAt: now
                                    // Mark prescription as dispensed
                                    ,
                                    // Mark prescription as dispensed
                                    await: mbhrDb.prescriptions.update(chosen.id, { status: 'dispensed' })
                                }),
                                await: loadData() // Refresh data
                                , // Refresh data
                                console, : .error('Error dispensing medication:', error)
                            }), finally: {}
                        });
                    });
                }
            }
        }
    }
}
