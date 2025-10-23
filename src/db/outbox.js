// Outbox pattern for offline messaging
import Dexie from 'dexie';
import { ulid } from 'ulid';
// Extend main database with outbox tables
export class OutboxDB extends Dexie {
    constructor() {
        super('mbhr_outbox');
        this.version(1).stores({
            outboundMessages: 'id, patientId, status, channel, to, createdAt, scheduledFor, _dirty, _syncedAt',
            messageTemplates: 'key, locale, channel'
        });
    }
}
export const outboxDb = new OutboxDB();
// Message queue functions
export class MessageQueue {
    // Queue a message for delivery
    static async queueMessage(patientId, to, templateKey, payload, options = {}) {
        const message = {
            id: ulid(),
            patientId,
            to: this.formatPhone(to),
            channel: options.channel || 'sms',
            locale: options.locale || 'en',
            templateKey,
            payload,
            status: 'queued',
            createdAt: new Date().toISOString(),
            scheduledFor: options.scheduledFor?.toISOString(),
            attempts: 0,
            _dirty: 1
        };
        await outboxDb.outboundMessages.add(message);
        console.log('📤 Queued message:', message.id);
        return message.id;
    }
    // Get pending messages ready to send
    static async getPendingMessages(limit = 50) {
        const now = new Date().toISOString();
        return outboxDb.outboundMessages
            .where('status')
            .equals('queued')
            .and(msg => !msg.scheduledFor || msg.scheduledFor <= now)
            .limit(limit)
            .toArray();
    }
    // Mark message as sent
    static async markSent(messageId) {
        await outboxDb.outboundMessages.update(messageId, {
            status: 'sent',
            lastAttemptAt: new Date().toISOString(),
            _dirty: 1
        });
    }
    // Mark message as failed
    static async markFailed(messageId, error) {
        const message = await outboxDb.outboundMessages.get(messageId);
        if (!message)
            return;
        const attempts = message.attempts + 1;
        const maxAttempts = 3;
        await outboxDb.outboundMessages.update(messageId, {
            status: attempts >= maxAttempts ? 'failed' : 'queued',
            attempts,
            lastAttemptAt: new Date().toISOString(),
            errorMessage: error,
            _dirty: 1
        });
    }
    // Format phone number to E.164
    static formatPhone(phone) {
        const digits = phone.replace(/\D/g, '');
        if (digits.startsWith('234')) {
            return `+${digits}`;
        }
        else if (digits.startsWith('0') && digits.length === 11) {
            return `+234${digits.slice(1)}`;
        }
        else if (digits.length === 10) {
            return `+234${digits}`;
        }
        return phone;
    }
    // Render template with payload
    static renderTemplate(template, payload) {
        return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
            return String(payload[key] || match);
        });
    }
    // Get message statistics
    static async getStats() {
        const [queued, sent, failed, delivered] = await Promise.all([
            outboxDb.outboundMessages.where('status').equals('queued').count(),
            outboxDb.outboundMessages.where('status').equals('sent').count(),
            outboxDb.outboundMessages.where('status').equals('failed').count(),
            outboxDb.outboundMessages.where('status').equals('delivered').count()
        ]);
        return { queued, sent, failed, delivered };
    }
}
// Seed default message templates
export async function seedMessageTemplates() {
    const templateCount = await outboxDb.messageTemplates.count();
    if (templateCount > 0)
        return;
    const templates = [
        // English templates
        {
            key: 'followup.medication',
            locale: 'en',
            channel: 'sms',
            body: 'Hello {{patientName}}! Remember to take your {{medicationName}} {{dosage}} {{frequency}}. From {{clinicName}}',
            maxLength: 160
        },
        {
            key: 'appointment.reminder',
            locale: 'en',
            channel: 'sms',
            body: 'Hi {{patientName}}! Your follow-up appointment is on {{date}} at {{time}}. From {{clinicName}}',
            maxLength: 160
        },
        // Hausa templates
        {
            key: 'followup.medication',
            locale: 'ha',
            channel: 'sms',
            body: 'Sannu {{patientName}}! Ka tuna da shan maganin ka {{medicationName}} {{dosage}} {{frequency}}. Daga {{clinicName}}',
            maxLength: 160
        },
        // Pidgin templates
        {
            key: 'followup.medication',
            locale: 'pcm',
            channel: 'sms',
            body: 'Hello {{patientName}}! No forget to take your medicine {{medicationName}} {{dosage}} {{frequency}}. From {{clinicName}}',
            maxLength: 160
        }
    ];
    await outboxDb.messageTemplates.bulkAdd(templates);
    console.log('✅ Message templates seeded');
}
