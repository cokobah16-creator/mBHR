import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// @ts-nocheck
import { useEffect, useState } from 'react';
import { useT } from '@/hooks/useT';
import { useAuthStore } from '@/stores/auth';
import { db, generateId } from '@/db';
import { getMessageService } from '@/services/messaging';
import { can } from '@/auth/roles';
import { BeakerIcon, ExclamationTriangleIcon, ClockIcon, CheckCircleIcon, XCircleIcon, ShieldExclamationIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
export default function EnhancedPharmacy({ patientId, visitId, onSuccess, onCancel }) {
    const { t } = useT();
    const { currentUser } = useAuthStore();
    const [medications, setMedications] = useState([]);
    const [batches, setBatches] = useState([]);
    const [selectedMedication, setSelectedMedication] = useState('');
    const [requestedQty, setRequestedQty] = useState(1);
    const [allocation, setAllocation] = useState([]);
    const [dosage, setDosage] = useState('');
    const [directions, setDirections] = useState('');
    const [patientAllergies, setPatientAllergies] = useState([]);
    const [currentMedications, setCurrentMedications] = useState([]);
    const [interactions, setInteractions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showCounseling, setShowCounseling] = useState(false);
    // Drug interaction database (simplified)
    const interactionDatabase = [
        {
            drug1: 'Warfarin',
            drug2: 'Aspirin',
            severity: 'major',
            description: 'Increased bleeding risk',
            action: 'Monitor INR closely, consider alternative'
        },
        {
            drug1: 'ACE Inhibitor',
            drug2: 'Potassium',
            severity: 'moderate',
            description: 'Risk of hyperkalemia',
            action: 'Monitor potassium levels'
        },
        {
            drug1: 'NSAID',
            drug2: 'ACE Inhibitor',
            severity: 'moderate',
            description: 'Reduced antihypertensive effect',
            action: 'Monitor blood pressure'
        }
    ];
    // Only pharmacists and admins can access
    if (!currentUser || !can(currentUser.role, 'dispense')) {
        return (_jsxs("div", { className: "text-center py-12", children: [_jsx(ExclamationTriangleIcon, { className: "h-12 w-12 mx-auto text-gray-400 mb-4" }), _jsx("h3", { className: "text-lg font-medium text-gray-900 mb-2", children: "Access Restricted" }), _jsx("p", { className: "text-gray-600", children: "Only pharmacists and administrators can access enhanced pharmacy features." })] }));
    }
    useEffect(() => {
        loadData();
    }, []);
    useEffect(() => {
        if (selectedMedication) {
            loadBatchesForMedication(selectedMedication);
            checkInteractions();
        }
    }, [selectedMedication, currentMedications]);
    useEffect(() => {
        if (selectedMedication && requestedQty > 0) {
            calculateFEFOAllocation();
        }
    }, [selectedMedication, requestedQty, batches]);
    const loadData = async () => {
        try {
            const [medicationsData, patientData, recentDispenses] = await Promise.all([
                db.inventory.where('onHandQty').above(0).toArray(),
                db.patients.get(patientId),
                db.dispenses.where('patientId').equals(patientId).reverse().limit(10).toArray()
            ]);
            setMedications(medicationsData);
            // Extract current medications from recent dispenses (last 30 days)
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const recentMeds = recentDispenses
                .filter(d => d.dispensedAt > thirtyDaysAgo)
                .map(d => d.itemName);
            setCurrentMedications([...new Set(recentMeds)]);
            // TODO: Load patient allergies from patient record
            setPatientAllergies([]); // Placeholder
        }
        catch (error) {
            console.error('Error loading pharmacy data:', error);
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
            const daysUntilExpiry = Math.ceil((new Date(batch.expiryDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
            allocations.push({
                batchId: batch.id,
                lotNumber: batch.lotNumber,
                qty: allocateQty,
                expiryDate: batch.expiryDate,
                daysUntilExpiry
            });
            remaining -= allocateQty;
        }
        setAllocation(allocations);
    };
    const checkInteractions = () => {
        if (!selectedMedication) {
            setInteractions([]);
            return;
        }
        const selectedMed = medications.find(m => m.id === selectedMedication);
        if (!selectedMed)
            return;
        const foundInteractions = interactionDatabase.filter(interaction => {
            const medName = selectedMed.itemName.toLowerCase();
            return currentMedications.some(currentMed => {
                const currentName = currentMed.toLowerCase();
                return ((interaction.drug1.toLowerCase().includes(medName.split(' ')[0]) &&
                    interaction.drug2.toLowerCase().includes(currentName.split(' ')[0])) ||
                    (interaction.drug2.toLowerCase().includes(medName.split(' ')[0]) &&
                        interaction.drug1.toLowerCase().includes(currentName.split(' ')[0])));
            });
        });
        setInteractions(foundInteractions);
    };
    const getExpiryStatus = (daysUntilExpiry) => {
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
    const getInteractionSeverityColor = (severity) => {
        switch (severity) {
            case 'major':
                return 'bg-red-100 text-red-800 border-red-200';
            case 'moderate':
                return 'bg-yellow-100 text-yellow-800 border-yellow-200';
            case 'minor':
                return 'bg-blue-100 text-blue-800 border-blue-200';
        }
    };
    const canDispense = () => {
        const hasExpiredBatches = allocation.some(a => a.daysUntilExpiry < 0);
        const hasMajorInteractions = interactions.some(i => i.severity === 'major');
        return selectedMedication &&
            requestedQty > 0 &&
            allocation.length > 0 &&
            allocation.reduce((sum, a) => sum + a.qty, 0) >= requestedQty &&
            dosage.trim() &&
            directions.trim() &&
            !hasExpiredBatches &&
            !hasMajorInteractions;
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
                id: generateId(),
                patientId,
                visitId,
                itemName: medication.itemName,
                qty: requestedQty,
                dosage,
                directions,
                dispensedBy: currentUser?.fullName || 'Unknown',
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
            setShowCounseling(true);
        }
        catch (error) {
            console.error('Error dispensing medication:', error);
            alert(t('error.dispenseFailed'));
        }
        finally {
            setLoading(false);
        }
    };
    const completeCounseling = () => {
        setShowCounseling(false);
        onSuccess?.();
    };
    if (showCounseling) {
        return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(InformationCircleIcon, { className: "h-8 w-8 text-primary" }), _jsxs("div", { children: [_jsx("h2", { className: "text-2xl font-bold text-gray-900", children: "Patient Counseling" }), _jsx("p", { className: "text-gray-600", children: "Review medication instructions with patient" })] })] }), _jsx("div", { className: "card max-w-2xl mx-auto", children: _jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "bg-blue-50 border border-blue-200 rounded-lg p-4", children: [_jsx("h3", { className: "font-medium text-blue-800 mb-2", children: "Medication Dispensed" }), _jsxs("p", { className: "text-blue-700", children: [_jsx("strong", { children: medications.find(m => m.id === selectedMedication)?.itemName }), " \u00D7 ", requestedQty] }), _jsxs("p", { className: "text-blue-700", children: [_jsx("strong", { children: "Dosage:" }), " ", dosage] }), _jsxs("p", { className: "text-blue-700", children: [_jsx("strong", { children: "Instructions:" }), " ", directions] })] }), _jsxs("div", { className: "space-y-4", children: [_jsx("h3", { className: "text-lg font-medium text-gray-900", children: "Counseling Checklist" }), _jsx("div", { className: "space-y-3", children: [
                                            'Explained how to take the medication',
                                            'Reviewed dosage and timing',
                                            'Discussed potential side effects',
                                            'Confirmed patient understanding',
                                            'Provided written instructions',
                                            'Scheduled follow-up reminder'
                                        ].map((item, index) => (_jsxs("label", { className: "flex items-center space-x-3", children: [_jsx("input", { type: "checkbox", className: "h-5 w-5 text-primary focus:ring-primary border-gray-300 rounded" }), _jsx("span", { className: "text-gray-700", children: item })] }, index))) })] }), _jsx("div", { className: "bg-green-50 border border-green-200 rounded-lg p-4", children: _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(CheckCircleIcon, { className: "h-5 w-5 text-green-600" }), _jsx("span", { className: "text-green-800 font-medium", children: "SMS reminder scheduled for tomorrow at 9:00 AM" })] }) }), _jsx("button", { onClick: completeCounseling, className: "btn-primary w-full", children: "Complete Dispensing" })] }) })] }));
    }
    const totalAvailable = allocation.reduce((sum, a) => sum + a.qty, 0);
    const isShortfall = totalAvailable < requestedQty;
    const hasExpiredBatches = allocation.some(a => a.daysUntilExpiry < 0);
    const hasMajorInteractions = interactions.some(i => i.severity === 'major');
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "flex items-center space-x-3", children: [_jsx(BeakerIcon, { className: "h-8 w-8 text-primary" }), _jsxs("div", { children: [_jsx("h2", { className: "text-2xl font-bold text-gray-900", children: "Enhanced Pharmacy" }), _jsx("p", { className: "text-gray-600", children: "FEFO dispensing with interaction checking" })] })] }), currentMedications.length > 0 && (_jsxs("div", { className: "bg-blue-50 border border-blue-200 rounded-lg p-4", children: [_jsxs("div", { className: "flex items-center space-x-2 mb-2", children: [_jsx(InformationCircleIcon, { className: "h-5 w-5 text-blue-600" }), _jsx("h3", { className: "font-medium text-blue-800", children: "Current Medications" })] }), _jsx("div", { className: "flex flex-wrap gap-2", children: currentMedications.map((med, index) => (_jsx("span", { className: "px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-sm", children: med }, index))) })] })), interactions.length > 0 && (_jsx("div", { className: "space-y-3", children: interactions.map((interaction, index) => (_jsxs("div", { className: `border rounded-lg p-4 ${getInteractionSeverityColor(interaction.severity)}`, children: [_jsxs("div", { className: "flex items-center space-x-2 mb-2", children: [_jsx(ShieldExclamationIcon, { className: "h-5 w-5" }), _jsxs("h3", { className: "font-medium", children: [interaction.severity.toUpperCase(), " Drug Interaction"] })] }), _jsx("p", { className: "text-sm mb-2", children: interaction.description }), _jsxs("p", { className: "text-sm font-medium", children: ["Action: ", interaction.action] })] }, index))) })), _jsx("div", { className: "card", children: _jsxs("div", { className: "space-y-6", children: [_jsxs("div", { children: [_jsxs("label", { className: "block text-lg font-medium text-gray-700 mb-3", children: [t('pharmacy.medication'), " *"] }), _jsxs("select", { value: selectedMedication, onChange: (e) => setSelectedMedication(e.target.value), className: "input-field text-lg", children: [_jsx("option", { value: "", children: t('simple.selectMedication') }), medications.map((med) => (_jsxs("option", { value: med.id, children: [med.itemName, " (", med.onHandQty, " ", med.unit, " ", t('common.available'), ")"] }, med.id)))] })] }), _jsxs("div", { children: [_jsxs("label", { className: "block text-lg font-medium text-gray-700 mb-3", children: [t('pharmacy.quantity'), " *"] }), _jsxs("div", { className: "flex items-center justify-center space-x-4", children: [_jsx("button", { type: "button", onClick: () => setRequestedQty(Math.max(1, requestedQty - 1)), className: "w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center hover:bg-red-200 touch-target-large", children: _jsx("span", { className: "text-xl font-bold", children: "\u2212" }) }), _jsxs("div", { className: "text-center", children: [_jsx("input", { type: "number", value: requestedQty, onChange: (e) => setRequestedQty(Math.max(1, parseInt(e.target.value) || 1)), min: "1", className: "w-24 text-3xl font-bold text-center border-2 border-gray-300 rounded-lg py-2" }), requestedQty <= 10 && (_jsx("div", { className: "flex justify-center gap-1 mt-2", children: Array.from({ length: requestedQty }, (_, i) => (_jsx("div", { className: "w-3 h-3 bg-primary rounded-full" }, i))) }))] }), _jsx("button", { type: "button", onClick: () => setRequestedQty(requestedQty + 1), className: "w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center hover:bg-green-200 touch-target-large", children: _jsx("span", { className: "text-xl font-bold", children: "+" }) })] })] }), allocation.length > 0 && (_jsxs("div", { children: [_jsx("h3", { className: "text-lg font-medium text-gray-700 mb-3", children: "FEFO Batch Allocation" }), isShortfall && (_jsx("div", { className: "bg-red-50 border border-red-200 rounded-lg p-4 mb-4", children: _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(ExclamationTriangleIcon, { className: "h-5 w-5 text-red-600" }), _jsxs("span", { className: "text-sm text-red-800", children: ["Insufficient stock: ", totalAvailable, " available, ", requestedQty, " requested"] })] }) })), hasExpiredBatches && (_jsx("div", { className: "bg-red-50 border border-red-200 rounded-lg p-4 mb-4", children: _jsxs("div", { className: "flex items-center space-x-2", children: [_jsx(XCircleIcon, { className: "h-5 w-5 text-red-600" }), _jsx("span", { className: "text-sm text-red-800", children: "Cannot dispense: Some batches have expired" })] }) })), _jsx("div", { className: "space-y-3", children: allocation.map((alloc, index) => {
                                        const expiryStatus = getExpiryStatus(alloc.daysUntilExpiry);
                                        const StatusIcon = expiryStatus.icon;
                                        return (_jsx("div", { className: "border rounded-lg p-4", children: _jsxs("div", { className: "flex items-center justify-between", children: [_jsxs("div", { children: [_jsxs("div", { className: "font-medium text-gray-900", children: ["Batch ", index + 1, ": ", alloc.lotNumber] }), _jsxs("div", { className: "text-sm text-gray-600", children: ["Quantity: ", alloc.qty, " \u2022 Expires: ", new Date(alloc.expiryDate).toLocaleDateString(), "(", alloc.daysUntilExpiry, " days)"] })] }), _jsxs("span", { className: `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${expiryStatus.color}`, children: [_jsx(StatusIcon, { className: "h-3 w-3 mr-1" }), expiryStatus.status] })] }) }, alloc.batchId));
                                    }) })] })), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-6", children: [_jsxs("div", { children: [_jsxs("label", { className: "block text-lg font-medium text-gray-700 mb-3", children: [t('pharmacy.dosage'), " *"] }), _jsx("input", { type: "text", value: dosage, onChange: (e) => setDosage(e.target.value), className: "input-field text-lg", placeholder: t('simple.dosageExample') })] }), _jsxs("div", { children: [_jsxs("label", { className: "block text-lg font-medium text-gray-700 mb-3", children: [t('pharmacy.directions'), " *"] }), _jsx("textarea", { value: directions, onChange: (e) => setDirections(e.target.value), className: "input-field text-lg", rows: 3, placeholder: t('simple.directionsExample') })] })] }), (hasExpiredBatches || hasMajorInteractions) && (_jsxs("div", { className: "bg-red-50 border border-red-200 rounded-lg p-4", children: [_jsxs("div", { className: "flex items-center space-x-2 mb-2", children: [_jsx(ShieldExclamationIcon, { className: "h-5 w-5 text-red-600" }), _jsx("h3", { className: "font-medium text-red-800", children: "Safety Alert" })] }), _jsxs("ul", { className: "text-sm text-red-700 space-y-1", children: [hasExpiredBatches && _jsx("li", { children: "\u2022 Cannot dispense expired medication" }), hasMajorInteractions && _jsx("li", { children: "\u2022 Major drug interaction detected" })] })] })), _jsxs("div", { className: "flex space-x-4 pt-6", children: [_jsx("button", { onClick: handleDispense, disabled: !canDispense() || loading, className: "btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed", children: loading ? t('pharmacy.dispensing') : 'Dispense & Counsel' }), onCancel && (_jsx("button", { onClick: onCancel, className: "btn-secondary", children: t('action.cancel') }))] })] }) })] }));
}
