// @ts-nocheck
import { create } from 'zustand';
import { db as mbhrDb, ulid } from '@/db/mbhr';
const ALPHA = 0.2; // EMA smoothing
const prefixFor = (category) => {
    switch (category) {
        case 'adult': return 'A';
        case 'child': return 'B';
        case 'antenatal': return 'C';
        default: return 'Z';
    }
};
async function nextSequence(siteId, dateStr, category) {
    const id = `${siteId}:${dateStr}:${category}`;
    const row = await mbhrDb.daily_counters.get(id);
    const next = (row?.seq ?? 0) + 1;
    if (row)
        await mbhrDb.daily_counters.update(id, { seq: next });
    else
        await mbhrDb.daily_counters.add({ id, siteId, dateStr, category, seq: next });
    return next;
}
export const useQueue = create(() => ({
    issueTicket: async ({ siteId, category, priority = 'normal', patientId, stage = 'registration' }) => {
        const dateStr = new Date().toISOString().slice(0, 10);
        const seq = await nextSequence(siteId, dateStr, category);
        const number = `${prefixFor(category)}-${String(seq).padStart(3, '0')}`;
        const t = {
            id: ulid(),
            number,
            patientId,
            category,
            priority,
            createdAt: new Date().toISOString(),
            siteId,
            state: 'waiting',
            currentStage: stage
        };
        await mbhrDb.tickets.add(t);
        return t;
    },
    callNext: async (stage) => {
        const candidates = await mbhrDb.tickets
            .where('currentStage')
            .equals(stage)
            .toArray();
        // Prioritize urgent -> normal -> low; then FIFO by createdAt
        const priorityRank = { urgent: 0, normal: 1, low: 2 };
        const next = candidates
            .filter(t => t.state === 'waiting')
            .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] ||
            a.createdAt.localeCompare(b.createdAt))[0];
        if (!next)
            return null;
        await mbhrDb.tickets.update(next.id, { state: 'in_progress' });
        return { ...next, state: 'in_progress' };
    },
    completeCurrent: async (stage, secondsSpent) => {
        const all = await mbhrDb.tickets.where('currentStage').equals(stage).toArray();
        const current = all.find(t => t.state === 'in_progress');
        if (current)
            await mbhrDb.tickets.update(current.id, { state: 'done' });
        const metricId = `m-${stage}`;
        const m = await mbhrDb.queue_metrics.get(metricId);
        const prev = m?.avgServiceSec ?? 240;
        const avgServiceSec = Math.max(30, Math.round(ALPHA * secondsSpent + (1 - ALPHA) * prev));
        const updatedAt = new Date().toISOString();
        if (m)
            await mbhrDb.queue_metrics.update(metricId, { avgServiceSec, updatedAt });
        else
            await mbhrDb.queue_metrics.add({ id: metricId, stage, avgServiceSec, updatedAt });
    },
    estimateTailMinutes: async (stage) => {
        const all = await mbhrDb.tickets.where('currentStage').equals(stage).toArray();
        const waiting = all.filter(t => t.state === 'waiting').length;
        const m = await mbhrDb.queue_metrics.get(`m-${stage}`);
        const avg = m?.avgServiceSec ?? 240;
        return Math.round((waiting * avg) / 60);
    },
}));
