import Dexie from 'dexie';
import { ulid } from 'ulid';
import { metaphone } from 'metaphone';
// Helper functions for date handling
export const epochDay = (d) => Math.floor(d.getTime() / 86400000);
export const normPhone = (s) => s.replace(/\D/g, '');
export const nameKeyOf = (first, last) => `${metaphone(first || '')}-${metaphone(last || '')}`;
// Database name - bumped to avoid incompatible older store
export const DB_NAME = 'mbhr_v5';
// Database class
export class MBHRDatabase extends Dexie {
    constructor() {
        super(DB_NAME);
        // v1 — Initial schema with stable PKs
        this.version(1).stores({
            patients: 'id, familyName, phone, state, lga, createdAt, updatedAt',
            vitals: 'id, patientId, visitId, takenAt, systolic, diastolic',
            consultations: 'id, patientId, visitId, createdAt, providerName',
            dispenses: 'id, patientId, visitId, dispensedAt, itemName',
            inventory: 'id, itemName, updatedAt, onHandQty',
            visits: 'id, patientId, startedAt, status, siteName',
            queue: 'id, patientId, stage, position, status, updatedAt',
            auditLogs: 'id, actorRole, entity, entityId, at',
            users: 'id, fullName, role, email, pinHash, createdAt, updatedAt',
            sessions: 'id, userId, createdAt, lastSeenAt',
            settings: 'key'
        });
        // v2 — Add sync indexes for _dirty and _syncedAt
        this.version(2).stores({
            patients: 'id, familyName, phone, state, lga, createdAt, updatedAt, _dirty, _syncedAt',
            vitals: 'id, patientId, visitId, takenAt, systolic, diastolic, _dirty, _syncedAt',
            consultations: 'id, patientId, visitId, createdAt, providerName, _dirty, _syncedAt',
            dispenses: 'id, patientId, visitId, dispensedAt, itemName, _dirty, _syncedAt',
            inventory: 'id, itemName, updatedAt, onHandQty, _dirty, _syncedAt',
            visits: 'id, patientId, startedAt, status, siteName, _dirty, _syncedAt',
            queue: 'id, patientId, stage, position, status, updatedAt, _dirty, _syncedAt',
            auditLogs: 'id, actorRole, entity, entityId, at',
            users: 'id, fullName, role, email, pinHash, createdAt, updatedAt',
            sessions: 'id, userId, createdAt, lastSeenAt',
            settings: 'key'
        });
        // v3 — Add isActive index to users table
        this.version(3).stores({
            patients: 'id, familyName, phone, state, lga, createdAt, updatedAt, _dirty, _syncedAt',
            vitals: 'id, patientId, visitId, takenAt, systolic, diastolic, _dirty, _syncedAt',
            consultations: 'id, patientId, visitId, createdAt, providerName, _dirty, _syncedAt',
            dispenses: 'id, patientId, visitId, dispensedAt, itemName, _dirty, _syncedAt',
            inventory: 'id, itemName, updatedAt, onHandQty, _dirty, _syncedAt',
            visits: 'id, patientId, startedAt, status, siteName, _dirty, _syncedAt',
            queue: 'id, patientId, stage, position, status, updatedAt, _dirty, _syncedAt',
            auditLogs: 'id, actorRole, entity, entityId, at',
            users: 'id, fullName, role, email, pinHash, pinSalt, isActive, createdAt, updatedAt',
            sessions: 'id, userId, createdAt, lastSeenAt',
            settings: 'key'
        }).upgrade(async (tx) => {
            // Set default isActive = true for existing users that lack this field
            await tx.table('users').toCollection().modify(user => {
                if (typeof user.isActive === 'undefined') {
                    user.isActive = 1;
                }
            });
        });
        // v4 — Convert isActive boolean to numeric (0/1) for IndexedDB compatibility
        this.version(4).stores({
            patients: 'id, familyName, phone, state, lga, createdAt, updatedAt, _dirty, _syncedAt',
            vitals: 'id, patientId, visitId, takenAt, systolic, diastolic, _dirty, _syncedAt',
            consultations: 'id, patientId, visitId, createdAt, providerName, _dirty, _syncedAt',
            dispenses: 'id, patientId, visitId, dispensedAt, itemName, _dirty, _syncedAt',
            inventory: 'id, itemName, updatedAt, onHandQty, _dirty, _syncedAt',
            visits: 'id, patientId, startedAt, status, siteName, _dirty, _syncedAt',
            queue: 'id, patientId, stage, position, status, updatedAt, _dirty, _syncedAt',
            auditLogs: 'id, actorRole, entity, entityId, at',
            users: 'id, fullName, role, email, pinHash, pinSalt, isActive, createdAt, updatedAt',
            sessions: 'id, userId, createdAt, lastSeenAt',
            settings: 'key'
        }).upgrade(async (tx) => {
            // Convert boolean isActive values to numeric (0/1)
            await tx.table('users').toCollection().modify(user => {
                if (typeof user.isActive === 'boolean') {
                    user.isActive = user.isActive ? 1 : 0;
                }
            });
        });
        // v5 — Add adminAccess and adminPermanent fields for Supabase integration
        this.version(5).stores({
            patients: 'id, familyName, phone, state, lga, createdAt, updatedAt, _dirty, _syncedAt',
            vitals: 'id, patientId, visitId, takenAt, systolic, diastolic, _dirty, _syncedAt',
            consultations: 'id, patientId, visitId, createdAt, providerName, _dirty, _syncedAt',
            dispenses: 'id, patientId, visitId, dispensedAt, itemName, _dirty, _syncedAt',
            inventory: 'id, itemName, updatedAt, onHandQty, _dirty, _syncedAt',
            visits: 'id, patientId, startedAt, status, siteName, _dirty, _syncedAt',
            queue: 'id, patientId, stage, position, status, updatedAt, _dirty, _syncedAt',
            auditLogs: 'id, actorRole, entity, entityId, at',
            users: 'id, fullName, role, email, pinHash, pinSalt, isActive, adminAccess, adminPermanent, createdAt, updatedAt',
            sessions: 'id, userId, createdAt, lastSeenAt',
            settings: 'key'
        }).upgrade(async (tx) => {
            // Set default values for new adminAccess and adminPermanent fields
            await tx.table('users').toCollection().modify(user => {
                if (typeof user.adminAccess === 'undefined') {
                    // Set adminAccess based on role - admins get true, others get false
                    user.adminAccess = user.role === 'admin';
                }
                if (typeof user.adminPermanent === 'undefined') {
                    // Set adminPermanent = true for Kristopher Okobah, false for others
                    user.adminPermanent = user.fullName === 'Kristopher Okobah';
                }
            });
        });
        // v6 — Add gamification tables
        this.version(8).stores({
            patients: 'id, familyName, phone, state, lga, createdAt, updatedAt, _dirty, _syncedAt',
            vitals: 'id, patientId, visitId, takenAt, systolic, diastolic, _dirty, _syncedAt',
            consultations: 'id, patientId, visitId, createdAt, providerName, _dirty, _syncedAt',
            dispenses: 'id, patientId, visitId, dispensedAt, itemName, _dirty, _syncedAt',
            inventory: 'id, itemName, updatedAt, onHandQty, _dirty, _syncedAt',
            visits: 'id, patientId, startedAt, status, siteName, _dirty, _syncedAt',
            queue: 'id, patientId, stage, position, status, updatedAt, _dirty, _syncedAt',
            auditLogs: 'id, actorRole, entity, entityId, at',
            users: 'id, fullName, role, email, pinHash, pinSalt, isActive, adminAccess, adminPermanent, createdAt, updatedAt',
            sessions: 'id, userId, createdAt, lastSeenAt',
            settings: 'key',
            gameSessions: 'id, type, volunteerId, startedAt, finishedAt, committed_idx, _dirty, _syncedAt',
            gamificationWallets: 'volunteerId, tokens, level, streakDays, updatedAt, _dirty, _syncedAt',
            vitalsRanges: 'id, sex, metric, ageMin, ageMax, updatedAt',
            quizQuestions: 'id, topic, difficulty, updatedAt',
            triageSamples: 'id, createdAt, createdBy',
            inventoryDiscrepancies: 'id, itemId, createdAt, resolvedAt, _dirty, _syncedAt',
            outboundMessages: 'id, patientId, status, channel, to, createdAt, scheduledFor, _dirty, _syncedAt',
            messageTemplates: 'key, locale, channel',
            stockBatches: 'id, drugId, expiryDate, updatedAt, _dirty, _syncedAt',
            careTasks: 'id, patientId, status, dueDate, createdAt, _dirty, _syncedAt'
        }).upgrade(async (tx) => {
            // Normalize date fields to ISO strings and ensure committed is boolean
            const table = tx.table('gameSessions');
            await table.toCollection().modify((obj) => {
                // Ensure committed is boolean
                if (typeof obj.committed !== 'boolean') {
                    obj.committed = false;
                }
                // Normalize createdAt to ISO string if it's a Date object
                if (obj.createdAt instanceof Date) {
                    obj.createdAt = obj.createdAt.toISOString();
                }
                if (obj.startedAt instanceof Date) {
                    obj.startedAt = obj.startedAt.toISOString();
                }
                if (obj.finishedAt instanceof Date) {
                    obj.finishedAt = obj.finishedAt.toISOString();
                }
            });
        });
        // v9 — Add dedupe and analytics tables with epochDay indexes
        this.version(9).stores({
            patients: 'id, familyName, phone, state, lga, createdAt, updatedAt, _dirty, _syncedAt, phoneN, nameKey, dobDay, createdDay, updatedDay, mergeInto',
            vitals: 'id, patientId, visitId, takenAt, systolic, diastolic, _dirty, _syncedAt',
            consultations: 'id, patientId, visitId, createdAt, providerName, _dirty, _syncedAt',
            dispenses: 'id, patientId, visitId, dispensedAt, itemName, _dirty, _syncedAt',
            inventory: 'id, itemName, updatedAt, onHandQty, _dirty, _syncedAt',
            visits: 'id, patientId, startedAt, status, siteName, _dirty, _syncedAt',
            queue: 'id, patientId, stage, position, status, updatedAt, _dirty, _syncedAt',
            auditLogs: 'id, actorRole, entity, entityId, at',
            users: 'id, fullName, role, email, pinHash, pinSalt, isActive, adminAccess, adminPermanent, createdAt, updatedAt',
            sessions: 'id, userId, createdAt, lastSeenAt',
            settings: 'key',
            meta: 'key',
            gameSessions: 'id, type, volunteerId, startedAt, finishedAt, committed_idx, _dirty, _syncedAt',
            gamificationWallets: 'volunteerId, tokens, level, streakDays, updatedAt, _dirty, _syncedAt',
            vitalsRanges: 'id, sex, metric, ageMin, ageMax, updatedAt',
            quizQuestions: 'id, topic, difficulty, updatedAt',
            triageSamples: 'id, createdAt, createdBy',
            inventoryDiscrepancies: 'id, itemId, createdAt, resolvedAt, _dirty, _syncedAt',
            outboundMessages: 'id, patientId, status, channel, to, createdAt, scheduledFor, _dirty, _syncedAt',
            messageTemplates: 'key, locale, channel',
            stockBatches: 'id, drugId, expiryDate, updatedAt, _dirty, _syncedAt',
            careTasks: 'id, patientId, status, dueDate, createdAt, _dirty, _syncedAt',
            patientMerges: 'id, winnerId, loserId, createdDay',
            dailyCounts: 'day, registrations, vitals, consultations, dispenses, visits',
            conflictResolutions: 'id, patientId, conflictType, status, resolvedAt'
        }).upgrade(async (tx) => {
            // Migrate existing patients to new schema
            await tx.table('patients').toCollection().modify((patient) => {
                if (!patient.phoneN) {
                    patient.phoneN = normPhone(patient.phone || '');
                }
                if (!patient.nameKey) {
                    patient.nameKey = nameKeyOf(patient.givenName || '', patient.familyName || '');
                }
                if (!patient.dobDay && patient.dob) {
                    patient.dobDay = epochDay(new Date(patient.dob));
                }
                if (!patient.createdDay && patient.createdAt) {
                    patient.createdDay = epochDay(patient.createdAt);
                }
                if (!patient.updatedDay && patient.updatedAt) {
                    patient.updatedDay = epochDay(patient.updatedAt);
                }
                patient.mergeInto = null;
            });
        });
        // v10 — Add patient allergies and preferences tables
        this.version(10).stores({
            patients: 'id, familyName, phone, state, lga, createdAt, updatedAt, _dirty, _syncedAt, phoneN, nameKey, dobDay, createdDay, updatedDay, mergeInto',
            vitals: 'id, patientId, visitId, takenAt, systolic, diastolic, _dirty, _syncedAt',
            consultations: 'id, patientId, visitId, createdAt, providerName, _dirty, _syncedAt',
            dispenses: 'id, patientId, visitId, dispensedAt, itemName, _dirty, _syncedAt',
            inventory: 'id, itemName, updatedAt, onHandQty, _dirty, _syncedAt',
            visits: 'id, patientId, startedAt, status, siteName, _dirty, _syncedAt',
            queue: 'id, patientId, stage, position, status, updatedAt, _dirty, _syncedAt',
            auditLogs: 'id, actorRole, entity, entityId, at',
            users: 'id, fullName, role, email, pinHash, pinSalt, isActive, adminAccess, adminPermanent, createdAt, updatedAt',
            sessions: 'id, userId, createdAt, lastSeenAt',
            settings: 'key',
            meta: 'key',
            gameSessions: 'id, type, volunteerId, startedAt, finishedAt, committed_idx, _dirty, _syncedAt',
            gamificationWallets: 'volunteerId, tokens, level, streakDays, updatedAt, _dirty, _syncedAt',
            vitalsRanges: 'id, sex, metric, ageMin, ageMax, updatedAt',
            quizQuestions: 'id, topic, difficulty, updatedAt',
            triageSamples: 'id, createdAt, createdBy',
            inventoryDiscrepancies: 'id, itemId, createdAt, resolvedAt, _dirty, _syncedAt',
            outboundMessages: 'id, patientId, status, channel, to, createdAt, scheduledFor, _dirty, _syncedAt',
            messageTemplates: 'key, locale, channel',
            stockBatches: 'id, drugId, expiryDate, updatedAt, _dirty, _syncedAt',
            careTasks: 'id, patientId, status, dueDate, createdAt, _dirty, _syncedAt',
            triageRecords: 'id, patientId, visitId, priority, createdAt, createdBy, _dirty, _syncedAt',
            patientMerges: 'id, winnerId, loserId, createdDay',
            dailyCounts: 'day, registrations, vitals, consultations, dispenses, visits',
            conflictResolutions: 'id, patientId, conflictType, status, resolvedAt',
            patientAllergies: 'id, patientId, allergen, allergyType, severity, isActive, createdAt, updatedAt, _dirty, _syncedAt',
            patientPreferences: 'id, patientId, createdAt, updatedAt, _dirty, _syncedAt'
        });
    }
}
export const db = new MBHRDatabase();
// Helper functions
export const generateId = () => ulid();
// Patient dedupe and conflict resolution
export const createPatientDraft = async (p) => {
    const now = new Date();
    const dobDay = epochDay(p.dob);
    const phoneN = normPhone(p.phone || '');
    const nameKey = nameKeyOf(p.givenName, p.familyName);
    const rec = {
        id: generateId(),
        givenName: p.givenName,
        familyName: p.familyName,
        sex: p.sex,
        dob: p.dob.toISOString().split('T')[0],
        phone: p.phone || '',
        address: p.address,
        state: p.state,
        lga: p.lga,
        createdAt: now,
        updatedAt: now,
        _dirty: 1
    };
    // Find potential duplicates
    const candidates = await db.patients
        .where('dobDay').equals(dobDay)
        .and(x => !x.mergeInto && ((phoneN && x.phoneN === phoneN) ||
        x.nameKey === nameKey))
        .toArray();
    return { rec, candidates };
};
// Merge patients (winner absorbs loser's data)
export const mergePatients = async (winnerId, loserId, mergedBy) => {
    await db.transaction('rw', db.patients, db.patientMerges, async () => {
        const now = new Date();
        const day = epochDay(now);
        // Mark loser as merged
        await db.patients.update(loserId, {
            mergeInto: winnerId,
            updatedAt: now,
            _dirty: 1
        });
        // Record merge
        await db.patientMerges.add({
            id: generateId(),
            winnerId,
            loserId,
            mergedBy,
            createdDay: day,
            reason: 'duplicate_resolution'
        });
        // Update winner's updatedAt
        await db.patients.update(winnerId, {
            updatedAt: now,
            _dirty: 1
        });
    });
};
// Daily count helpers
export const bumpDailyCount = async (day, metric) => {
    try {
        const existing = await db.dailyCounts.where('day').equals(day).first();
        if (existing) {
            await db.dailyCounts.update(existing.day, {
                [metric]: (existing[metric] || 0) + 1
            });
        }
        else {
            const newCount = {
                day,
                registrations: 0,
                vitals: 0,
                consultations: 0,
                dispenses: 0,
                visits: 0
            };
            newCount[metric] = 1;
            await db.dailyCounts.add(newCount);
        }
    }
    catch (error) {
        console.warn('Failed to bump daily count:', error);
    }
};
export const createAuditLog = async (actorRole, action, entity, entityId) => {
    await db.auditLogs.add({
        id: generateId(),
        actorRole,
        action,
        entity,
        entityId,
        at: new Date()
    });
};
