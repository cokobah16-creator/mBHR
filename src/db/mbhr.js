// src/db/mbhr.ts
import Dexie from 'dexie';
import { ulid as _ulid } from 'ulid';
class MBHRDB extends Dexie {
    constructor() {
        super('mbhr');
        // Keep indexes minimal and compatible with the screens we added
        this.version(1).stores({
            tickets: 'id, number, currentStage, state, createdAt',
            inventory_nm: 'id, itemName, updatedAt, reorderThreshold',
            pharmacy_items: 'id, medName, updatedAt',
            pharmacy_batches: 'id, itemId, expiryDate',
            gamification: 'id, volunteerId, updatedAt',
            queue_metrics: 'id, stage, updatedAt',
            daily_counters: 'id, siteId, dateStr, category',
            stock_moves_nm: 'id, itemId, createdAt',
            stock_moves_rx: 'id, itemId, batchId, createdAt',
            prescriptions: 'id, patientId, status, createdAt',
            dispenses: 'id, prescriptionId, patientId, dispensedAt'
        });
    }
}
export const db = new MBHRDB();
// small helper passthrough so other files can do `import { ulid } from '@/db/mbhr'`
export const ulid = () => _ulid();
// ✅ add alias export so `import { mbhrDb } ...` works
export const mbhrDb = db;
export default db;
