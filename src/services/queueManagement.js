import { db, generateId, epochDay } from '@/db';
import { supabase } from '@/lib/supabase';
import logger from '@/lib/logger';
const DEFAULT_CONFIG = {
    enablePriority: true,
    urgentThreshold: 5,
    maxWaitTime: 60
};
export class QueueManagement {
    constructor(config = {}) {
        this.subscribers = new Map();
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    async addToQueue(patientId, stage, priority = 'normal', createdBy) {
        const now = new Date();
        // Validate patient exists
        const patient = await db.patients.get(patientId);
        if (!patient) {
            throw new Error(`Patient ${patientId} not found`);
        }
        // Check if patient already in queue
        const existing = await db.queue
            .where('patientId').equals(patientId)
            .and(item => item.status !== 'done')
            .first();
        if (existing) {
            logger.warn(`Patient ${patientId} already in queue at stage ${existing.stage}`);
            throw new Error(`Patient is already in queue at ${existing.stage} stage`);
        }
        // Calculate position based on priority
        const position = await this.calculatePosition(stage, priority);
        const queueItem = {
            id: generateId(),
            patientId,
            stage,
            position,
            status: 'waiting',
            priority,
            createdBy,
            queuedAt: now,
            updatedAt: now,
            _dirty: 1
        };
        await db.queue.add(queueItem);
        // Reorder queue to accommodate new item
        await this.reorderQueue(stage);
        // Notify subscribers
        this.notifySubscribers(stage);
        logger.log(`Added patient ${patientId} to ${stage} queue at position ${position} with priority ${priority}`);
        return queueItem;
    }
    async calculatePosition(stage, priority) {
        const waitingItems = await db.queue
            .where('stage').equals(stage)
            .and(item => item.status === 'waiting')
            .toArray();
        if (priority === 'urgent') {
            // Urgent patients go to front, but after other urgent patients
            const urgentCount = waitingItems.filter(item => {
                // Assume items created recently with low position are urgent
                return item.position <= 10;
            }).length;
            return urgentCount + 1;
        }
        // Normal and low priority go to back
        return waitingItems.length + 1;
    }
    async moveToNextStage(patientId) {
        const currentItem = await db.queue
            .where('patientId').equals(patientId)
            .and(item => item.status !== 'done')
            .first();
        if (!currentItem) {
            throw new Error(`Patient ${patientId} not found in queue`);
        }
        // Mark current stage as done
        await db.queue.update(currentItem.id, {
            status: 'done',
            updatedAt: new Date(),
            _dirty: 1
        });
        // Determine next stage
        const nextStage = this.getNextStage(currentItem.stage);
        if (nextStage) {
            // Add to next stage
            await this.addToQueue(patientId, nextStage, 'normal');
        }
        // Reorder current stage
        await this.reorderQueue(currentItem.stage);
        // Notify both stages
        this.notifySubscribers(currentItem.stage);
        if (nextStage) {
            this.notifySubscribers(nextStage);
        }
    }
    getNextStage(currentStage) {
        const stages = ['registration', 'vitals', 'consult', 'pharmacy'];
        const currentIndex = stages.indexOf(currentStage);
        if (currentIndex === -1 || currentIndex === stages.length - 1) {
            return null;
        }
        return stages[currentIndex + 1];
    }
    async startService(queueItemId) {
        await db.queue.update(queueItemId, {
            status: 'in_progress',
            updatedAt: new Date(),
            _dirty: 1
        });
        const item = await db.queue.get(queueItemId);
        if (item) {
            this.notifySubscribers(item.stage);
        }
    }
    async completeService(queueItemId) {
        const item = await db.queue.get(queueItemId);
        if (!item)
            return;
        await db.queue.update(queueItemId, {
            status: 'done',
            updatedAt: new Date(),
            _dirty: 1
        });
        await this.reorderQueue(item.stage);
        this.notifySubscribers(item.stage);
    }
    async skipQueue(patientId, reason = 'urgent') {
        const item = await db.queue
            .where('patientId').equals(patientId)
            .and(i => i.status === 'waiting')
            .first();
        if (!item) {
            throw new Error(`Patient ${patientId} not found in waiting queue`);
        }
        // Move to position 1
        await db.queue.update(item.id, {
            position: 1,
            updatedAt: new Date(),
            _dirty: 1
        });
        await this.reorderQueue(item.stage);
        this.notifySubscribers(item.stage);
        logger.log(`Patient ${patientId} moved to front of ${item.stage} queue: ${reason}`);
    }
    async reorderQueue(stage) {
        const items = await db.queue
            .where('stage').equals(stage)
            .and(item => item.status === 'waiting')
            .sortBy('position');
        // Reassign positions sequentially
        for (let i = 0; i < items.length; i++) {
            if (items[i].position !== i + 1) {
                await db.queue.update(items[i].id, {
                    position: i + 1,
                    updatedAt: new Date(),
                    _dirty: 1
                });
            }
        }
    }
    async getQueueForStage(stage) {
        return await db.queue
            .where('stage').equals(stage)
            .and(item => item.status !== 'done')
            .sortBy('position');
    }
    async getQueueWithPatients(stage) {
        const queueItems = await this.getQueueForStage(stage);
        const withPatients = await Promise.all(queueItems.map(async (item) => {
            const patient = await db.patients.get(item.patientId);
            return { queueItem: item, patient: patient };
        }));
        return withPatients.filter(item => item.patient);
    }
    async getQueueStats(stage) {
        const items = await db.queue.where('stage').equals(stage).toArray();
        const waiting = items.filter(i => i.status === 'waiting').length;
        const inProgress = items.filter(i => i.status === 'in_progress').length;
        const done = items.filter(i => i.status === 'done').length;
        // Calculate average wait time for completed items today
        const today = epochDay(new Date());
        const completedToday = items.filter(i => i.status === 'done' &&
            epochDay(i.updatedAt) === today);
        let averageWaitTime = 0;
        if (completedToday.length > 0) {
            const totalWait = completedToday.reduce((sum) => {
                // Estimate wait time (would need actual timestamps to calculate precisely)
                const waitMinutes = 5; // Default estimate
                return sum + waitMinutes;
            }, 0);
            averageWaitTime = Math.floor(totalWait / completedToday.length);
        }
        return {
            stage,
            waiting,
            inProgress,
            done,
            averageWaitTime
        };
    }
    async getAllQueueStats() {
        const stages = ['registration', 'vitals', 'consult', 'pharmacy'];
        return await Promise.all(stages.map(stage => this.getQueueStats(stage)));
    }
    async removeFromQueue(patientId) {
        const items = await db.queue
            .where('patientId').equals(patientId)
            .and(item => item.status !== 'done')
            .toArray();
        for (const item of items) {
            await db.queue.update(item.id, {
                status: 'done',
                updatedAt: new Date(),
                _dirty: 1
            });
            await this.reorderQueue(item.stage);
            this.notifySubscribers(item.stage);
        }
        logger.log(`Removed patient ${patientId} from all queue stages`);
    }
    async checkStaleQueues() {
        const now = Date.now();
        const maxWaitMs = this.config.maxWaitTime * 60 * 1000;
        const staleItems = await db.queue
            .where('status').equals('waiting')
            .filter(item => {
            const waitTime = now - item.updatedAt.getTime();
            return waitTime > maxWaitMs;
        })
            .toArray();
        for (const item of staleItems) {
            logger.warn(`Stale queue item detected: Patient ${item.patientId} waiting ${Math.floor((now - item.updatedAt.getTime()) / 60000)} minutes`);
            // Auto-escalate to front of queue
            await this.skipQueue(item.patientId, 'auto-escalation due to long wait');
        }
    }
    subscribe(stage, callback) {
        const key = `${stage}-${Date.now()}`;
        this.subscribers.set(key, callback);
        // Return unsubscribe function
        return () => {
            this.subscribers.delete(key);
        };
    }
    async notifySubscribers(stage) {
        const items = await this.getQueueForStage(stage);
        this.subscribers.forEach((callback, key) => {
            if (key.startsWith(stage)) {
                callback(items);
            }
        });
    }
    async setupRealtimeSync(stage) {
        if (!supabase)
            return;
        const channel = supabase
            .channel(`queue:${stage}`)
            .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'queue',
            filter: `stage=eq.${stage}`
        }, async (payload) => {
            logger.log('Queue update received from Supabase', payload);
            // Reload queue from local DB (which will have synced)
            this.notifySubscribers(stage);
        })
            .subscribe();
        logger.log(`Realtime sync enabled for ${stage} queue`);
    }
    async exportQueueData(stage) {
        const stages = stage ? [stage] : ['registration', 'vitals', 'consult', 'pharmacy'];
        const data = [];
        for (const s of stages) {
            const items = await this.getQueueWithPatients(s);
            for (const { queueItem, patient } of items) {
                data.push({
                    stage: s,
                    position: queueItem.position,
                    status: queueItem.status,
                    patientName: `${patient.givenName} ${patient.familyName}`,
                    patientPhone: patient.phone,
                    updatedAt: queueItem.updatedAt.toISOString()
                });
            }
        }
        return JSON.stringify(data, null, 2);
    }
}
export const queueManagement = new QueueManagement();
