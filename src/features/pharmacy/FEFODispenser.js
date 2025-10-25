// @ts-nocheck
import { useEffect, useState } from 'react';
import { formatNigerianDate } from '@/utils/dateFormat';
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
    if (selectedMedication) {
        loadBatchesForMedication(selectedMedication);
    }
}
[selectedMedication];
if (selectedMedication && requestedQty > 0) {
    calculateFEFOAllocation();
}
[selectedMedication, requestedQty, batches];
const loadMedications = async () => {
    try {
        const items = await db.inventory.where('onHandQty').above(0).toArray();
        setMedications(items);
    }
    catch (error) {
        console.error('Error loading medications:', error);
    }
    const loadBatchesForMedication = async (medicationId) => {
        const stockBatches = await db.stockBatches
            .where('drugId')
            .equals(medicationId)
            .and(batch => batch.qtyOnHand > 0)
            .toArray();
        setBatches(stockBatches);
        console.error('Error loading batches:', error);
        setBatches([]);
        const calculateFEFOAllocation = () => {
            if (!batches.length || requestedQty <= 0) {
                setAllocation([]);
                return;
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
                    setAllocation(allocations);
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
                            const canDispense = () => {
                                return selectedMedication &&
                                    requestedQty > 0 &&
                                    allocation.length > 0 &&
                                    allocation.reduce((sum, a) => sum + a.qty, 0) >= requestedQty &&
                                    dosage.trim() &&
                                    directions.trim();
                                const handleDispense = async () => {
                                    if (!canDispense())
                                        return;
                                    setLoading(true);
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
                                        // Update total inventory
                                        await db.inventory.update(selectedMedication, {
                                            onHandQty: medication.onHandQty - requestedQty,
                                            updatedAt: new Date()
                                            // Queue medication reminder for tomorrow
                                            ,
                                            // Queue medication reminder for tomorrow
                                            try: {
                                                const: messageService = getMessageService(),
                                                const: reminderDate = new Date(),
                                                reminderDate, : .setDate(reminderDate.getDate() + 1),
                                                reminderDate, : .setHours(9, 0, 0, 0) // 9 AM tomorrow
                                                , // 9 AM tomorrow
                                                await: messageService.queueMedicationReminder(patientId, medication.itemName, dosage, directions, reminderDate)
                                            }, catch(error) {
                                                console.warn('Failed to queue reminder:', error);
                                                onSuccess?.();
                                                console.error('Error dispensing medication:', error);
                                                alert('Failed to dispense medication');
                                            }, finally: {
                                                const: totalAvailable = allocation.reduce((sum, a) => sum + a.qty, 0),
                                                const: isShortfall = totalAvailable < requestedQty
                                            }
                                        });
                                    }
                                };
                            };
                        }
                    };
                }
            }
        };
    };
};
